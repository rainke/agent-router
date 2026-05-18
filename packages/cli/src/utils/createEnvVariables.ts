import { readConfigFile } from ".";

/**
 * Valid client types for environment variable generation
 */
export type ClientType = "claude" | "codex" | "opencode";

const VALID_CLIENT_TYPES: ClientType[] = ["claude", "codex", "opencode"];

/**
 * Get environment variables for the specified client type.
 * - claude: Anthropic env vars (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL)
 * - codex: OpenAI env vars (OPENAI_API_KEY, OPENAI_BASE_URL ending with /v1)
 * - opencode: Both Anthropic and OpenAI env vars
 *
 * All client types include common variables: NO_PROXY, DISABLE_TELEMETRY,
 * DISABLE_COST_WARNINGS, API_TIMEOUT_MS.
 */
export const createEnvVariables = async (
  clientType: ClientType = "claude"
): Promise<Record<string, string | undefined>> => {
  if (!VALID_CLIENT_TYPES.includes(clientType)) {
    throw new Error(
      `invalid clientType: "${clientType}". Valid values: ${VALID_CLIENT_TYPES.join(", ")}`
    );
  }

  const config = await readConfigFile();
  const port = config.PORT || 3456;
  const apiKey = config.APIKEY || "test";

  const commonVars: Record<string, string | undefined> = {
    NO_PROXY: "127.0.0.1",
    DISABLE_TELEMETRY: "true",
    DISABLE_COST_WARNINGS: "true",
    API_TIMEOUT_MS: String(config.API_TIMEOUT_MS ?? 600000),
  };

  const anthropicVars: Record<string, string | undefined> = {
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    // Reset CLAUDE_CODE_USE_BEDROCK when running with agr
    CLAUDE_CODE_USE_BEDROCK: undefined,
  };

  const openaiVars: Record<string, string | undefined> = {
    OPENAI_API_KEY: apiKey,
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  };

  switch (clientType) {
    case "claude":
      return {
        ...anthropicVars,
        ...commonVars,
      };
    case "codex":
      return {
        ...openaiVars,
        ...commonVars,
      };
    case "opencode":
      return {
        ...anthropicVars,
        ...openaiVars,
        ...commonVars,
      };
  }
};
