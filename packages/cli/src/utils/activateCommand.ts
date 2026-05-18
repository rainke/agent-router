import { createEnvVariables, ClientType } from "./createEnvVariables";

const VALID_CLIENT_TYPES: ClientType[] = ["claude", "codex", "opencode"];

/**
 * Execute the activate/env command.
 * Supports: agr activate [claude|codex|opencode]
 * Defaults to "claude" when no client type is specified.
 * "agr env" is a complete alias for "agr activate".
 */
export const activateCommand = async (clientArg?: string) => {
  // Determine client type
  let clientType: ClientType = "claude";

  if (clientArg) {
    if (!VALID_CLIENT_TYPES.includes(clientArg as ClientType)) {
      process.stderr.write(
        `Unknown client type: "${clientArg}"\n` +
        `Valid client types: ${VALID_CLIENT_TYPES.join(", ")}\n` +
        `\nUsage: agr activate [claude|codex|opencode]\n`
      );
      process.exit(1);
    }
    clientType = clientArg as ClientType;
  }

  const envVars = await createEnvVariables(clientType);

  // Output in shell-friendly format for eval
  for (const [key, value] of Object.entries(envVars)) {
    if (value === "") {
      console.log(`export ${key}=""`);
    } else if (value === undefined) {
      console.log(`unset ${key}`);
    } else {
      console.log(`export ${key}="${value}"`);
    }
  }
};
