#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const buildMode = process.argv.includes("--build");
const scriptPath = path.resolve(__filename);

const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".json5",
  ".mjs",
  ".ts",
  ".tsx",
]);

const ignoredDirs = new Set([
  ".git",
  "dist",
  "node_modules",
]);

const issueGroups = [];

function addIssue(rule, filePath, message, index) {
  const location = index === undefined
    ? relativePath(filePath)
    : `${relativePath(filePath)}:${getLineColumn(readFile(filePath), index)}`;
  issueGroups.push({ rule, location, message });
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function getLineColumn(content, index) {
  const prefix = content.slice(0, index);
  const line = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  const column = index - lastNewline;
  return `${line}:${column}`;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;

    const filePath = path.join(dir, entry.name);
    if (filePath === scriptPath) continue;

    if (entry.isDirectory()) {
      walk(filePath, files);
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }

  return files;
}

function collectSourceFiles() {
  const files = [path.join(rootDir, "package.json")];
  for (const dirName of ["packages", "scripts"]) {
    const dir = path.join(rootDir, dirName);
    if (fs.existsSync(dir)) {
      walk(dir, files);
    }
  }
  return files;
}

function findMatches(files, rule, pattern) {
  for (const filePath of files) {
    const content = readFile(filePath);
    for (const match of content.matchAll(pattern)) {
      addIssue(rule, filePath, `found ${JSON.stringify(match[0])}`, match.index);
    }
  }
}

function checkPackageFields() {
  const packageJsonPaths = [
    path.join(rootDir, "package.json"),
    ...fs.readdirSync(path.join(rootDir, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(rootDir, "packages", entry.name, "package.json"))
      .filter((filePath) => fs.existsSync(filePath)),
  ];

  for (const filePath of packageJsonPaths) {
    const pkg = JSON.parse(readFile(filePath));

    if (typeof pkg.name === "string" && pkg.name.includes("claude-code-router")) {
      addIssue(
        "legacy package name",
        filePath,
        `package name must not include claude-code-router: ${pkg.name}`
      );
    }

    if (typeof pkg.name === "string" && pkg.name.startsWith("@CCR/")) {
      addIssue(
        "legacy workspace scope",
        filePath,
        `workspace package name must not use @CCR scope: ${pkg.name}`
      );
    }

    if (pkg.bin && Object.prototype.hasOwnProperty.call(pkg.bin, "ccr")) {
      addIssue(
        "legacy CLI bin",
        filePath,
        "bin field must not expose the old ccr command"
      );
    }

    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (!deps || typeof deps !== "object") continue;

      for (const depName of Object.keys(deps)) {
        if (depName.startsWith("@CCR/")) {
          addIssue(
            "legacy workspace dependency",
            filePath,
            `${field} must not reference ${depName}`
          );
        }
      }
    }
  }
}

function run() {
  const sourceFiles = collectSourceFiles();

  checkPackageFields();
  findMatches(sourceFiles, "unresolved @CCR reference", /@CCR\/[A-Za-z0-9_-]+/g);

  if (!buildMode) {
    findMatches(
      sourceFiles,
      "legacy runtime path",
      /\.claude-code-router|claude-code-reference-count\.txt|ccr-settings-|\.ccr\.pid/g
    );
  }

  if (issueGroups.length === 0) {
    console.log("Migration check passed.");
    return;
  }

  console.error(`Migration check failed with ${issueGroups.length} issue(s):`);
  for (const issue of issueGroups) {
    console.error(`- [${issue.rule}] ${issue.location}`);
    console.error(`  ${issue.message}`);
  }
  process.exitCode = 1;
}

run();
