import { spawn, type StdioOptions } from "child_process";
import { readConfigFile } from ".";
import {
  decrementReferenceCount,
  incrementReferenceCount,
  closeService,
} from "./processCheck";
import { createEnvVariables, ClientType } from "./createEnvVariables";

interface ClientCommandOptions {
  clientType: ClientType;
  /** Config key for executable path override (e.g., "CODEX_PATH") */
  configPathKey: string;
  /** Environment variable name for executable path override */
  envPathKey: string;
  /** Default executable name if no override is found */
  defaultExecutable: string;
  /** Install hint message shown on ENOENT */
  installHint: string;
}

const CLIENT_OPTIONS: Record<"codex" | "opencode", ClientCommandOptions> = {
  codex: {
    clientType: "codex",
    configPathKey: "CODEX_PATH",
    envPathKey: "CODEX_PATH",
    defaultExecutable: "codex",
    installHint:
      "Make sure Codex CLI is installed: npm install -g @openai/codex",
  },
  opencode: {
    clientType: "opencode",
    configPathKey: "OPENCODE_PATH",
    envPathKey: "OPENCODE_PATH",
    defaultExecutable: "opencode",
    installHint:
      "Make sure opencode is installed. Visit https://github.com/opencode-ai/opencode for installation instructions.",
  },
};

/**
 * Execute a client command (codex or opencode).
 * - Auto-starts server if not running
 * - Injects appropriate environment variables
 * - Manages reference count and cleanup on exit
 * - Does NOT pass --settings or write statusLine config
 */
export async function executeClientCommand(
  client: "codex" | "opencode",
  args: string[] = []
): Promise<void> {
  const options = CLIENT_OPTIONS[client];
  const config = await readConfigFile();

  // Resolve executable path: config > env > default
  const executablePath =
    config[options.configPathKey] ||
    process.env[options.envPathKey] ||
    options.defaultExecutable;

  // Generate environment variables for this client type
  const envVars = await createEnvVariables(options.clientType);

  // Increment reference count when command starts
  incrementReferenceCount();

  // Spawn the client process
  const clientProcess = spawn(executablePath, args, {
    env: {
      ...process.env,
      ...envVars,
    },
    stdio: "inherit",
  });

  clientProcess.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      process.stderr.write(
        `Failed to start ${client}: executable "${executablePath}" not found.\n` +
        `${options.installHint}\n`
      );
    } else {
      process.stderr.write(
        `Failed to start ${client} command: ${error.message}\n`
      );
    }
    decrementReferenceCount();
    process.exit(1);
  });

  clientProcess.on("close", (code) => {
    decrementReferenceCount();
    closeService();
    process.exit(code || 0);
  });
}

export { CLIENT_OPTIONS };
