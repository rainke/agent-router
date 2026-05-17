import { get_encoding } from "tiktoken";
import { sessionUsageCache, Usage } from "./cache";
import { readFile } from "fs/promises";
import { opendir, stat } from "fs/promises";
import { join } from "path";
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from "@agr/shared";
import { LRUCache } from "lru-cache";
import { ConfigService } from "../services/config";
import { TokenizerService } from "../services/tokenizer";
import { getSessionId } from "./session";
import { normalizeRequestBody, NormalizedRequest } from "./normalizer";
import { API_Protocol } from "./protocol";

// Types from @anthropic-ai/sdk
interface Tool {
  name: string;
  description?: string;
  input_schema: object;
}

interface ContentBlockParam {
  type: string;
  [key: string]: any;
}

interface MessageParam {
  role: string;
  content: string | ContentBlockParam[];
}

interface MessageCreateParamsBase {
  messages?: MessageParam[];
  system?: string | any[];
  tools?: Tool[];
  [key: string]: any;
}

const enc = get_encoding("cl100k_base");

export const calculateTokenCount = (
  messages: MessageParam[],
  system: any,
  tools: Tool[]
) => {
  let tokenCount = 0;
  if (Array.isArray(messages)) {
    messages.forEach((message) => {
      if (typeof message.content === "string") {
        tokenCount += enc.encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        message.content.forEach((contentPart: any) => {
          if (contentPart.type === "text") {
            tokenCount += enc.encode(contentPart.text).length;
          } else if (contentPart.type === "tool_use") {
            tokenCount += enc.encode(JSON.stringify(contentPart.input)).length;
          } else if (contentPart.type === "tool_result") {
            tokenCount += enc.encode(
              typeof contentPart.content === "string"
                ? contentPart.content
                : JSON.stringify(contentPart.content)
            ).length;
          }
        });
      }
    });
  }
  if (typeof system === "string") {
    tokenCount += enc.encode(system).length;
  } else if (Array.isArray(system)) {
    system.forEach((item: any) => {
      if (item.type !== "text") return;
      if (typeof item.text === "string") {
        tokenCount += enc.encode(item.text).length;
      } else if (Array.isArray(item.text)) {
        item.text.forEach((textPart: any) => {
          tokenCount += enc.encode(textPart || "").length;
        });
      }
    });
  }
  if (tools) {
    tools.forEach((tool: Tool) => {
      if (tool.description) {
        tokenCount += enc.encode(tool.name + tool.description).length;
      }
      if (tool.input_schema) {
        tokenCount += enc.encode(JSON.stringify(tool.input_schema)).length;
      }
    });
  }
  return tokenCount;
};

const getProjectSpecificRouter = async (
  req: any,
  configService: ConfigService
) => {
  // Check if there is project-specific configuration
  if (req.sessionId) {
    const project = await searchProjectBySession(req.sessionId);
    if (project) {
      const projectConfigPath = join(HOME_DIR, project, "config.json");
      const sessionConfigPath = join(
        HOME_DIR,
        project,
        `${req.sessionId}.json`
      );

      // First try to read sessionConfig file
      try {
        const sessionConfig = JSON.parse(await readFile(sessionConfigPath, "utf8"));
        if (sessionConfig && sessionConfig.Router) {
          return sessionConfig.Router;
        }
      } catch {}
      try {
        const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
        if (projectConfig && projectConfig.Router) {
          return projectConfig.Router;
        }
      } catch {}
    }
  }
  return undefined; // Return undefined to use original configuration
};

const getUseModel = async (
  req: any,
  normalized: NormalizedRequest,
  tokenCount: number,
  configService: ConfigService,
  lastUsage?: Usage | undefined
): Promise<{ model: string; scenarioType: RouterScenarioType }> => {
  const projectSpecificRouter = await getProjectSpecificRouter(req, configService);
  const providers = configService.get<any[]>("providers") || [];
  const Router = projectSpecificRouter || configService.get("Router");

  if (req.body.model.includes(",")) {
    const [provider, model] = req.body.model.split(",");
    const finalProvider = providers.find(
      (p: any) => p.name.toLowerCase() === provider
    );
    const finalModel = finalProvider?.models?.find(
      (m: any) => m.toLowerCase() === model
    );
    if (finalProvider && finalModel) {
      return { model: `${finalProvider.name},${finalModel}`, scenarioType: 'default' };
    }
    return { model: req.body.model, scenarioType: 'default' };
  }

  // if tokenCount is greater than the configured threshold, use the long context model
  const longContextThreshold = Router?.longContextThreshold || 60000;
  const lastUsageThreshold =
    lastUsage &&
    lastUsage.input_tokens > longContextThreshold &&
    tokenCount > 20000;
  const tokenCountThreshold = tokenCount > longContextThreshold;
  if ((lastUsageThreshold || tokenCountThreshold) && Router?.longContext) {
    req.log.info(
      `Using long context model due to token count: ${tokenCount}, threshold: ${longContextThreshold}`
    );
    return { model: Router.longContext, scenarioType: 'longContext' };
  }

  // Check for subagent model tag in normalized system prompts
  const subagentResult = extractAndRemoveSubagentTag(req, normalized);
  if (subagentResult) {
    return { model: subagentResult, scenarioType: 'default' };
  }

  // Use the background model for any Claude Haiku variant (anthropic only)
  const globalRouter = configService.get("Router");
  if (
    normalized.protocol === 'anthropic' &&
    req.body.model?.includes("claude") &&
    req.body.model?.includes("haiku") &&
    globalRouter?.background
  ) {
    req.log.info(`Using background model for ${req.body.model}`);
    return { model: globalRouter.background, scenarioType: 'background' };
  }
  // The priority of websearch must be higher than thinking.
  if (normalized.hasWebSearch && Router?.webSearch) {
    return { model: Router.webSearch, scenarioType: 'webSearch' };
  }
  // if exits thinking, use the think model
  if (normalized.thinking && Router?.think) {
    req.log.info(`Using think model for ${normalized.thinking}`);
    return { model: Router.think, scenarioType: 'think' };
  }
  return { model: Router?.default, scenarioType: 'default' };
};

/**
 * Extract <AGR-SUBAGENT-MODEL> tag from normalized system prompts and
 * atomically remove it from the original request body.
 * Returns the extracted model string, or undefined if no tag found.
 */
function extractAndRemoveSubagentTag(req: any, normalized: NormalizedRequest): string | undefined {
  const tagRegex = /<AGR-SUBAGENT-MODEL>([^<]+)<\/AGR-SUBAGENT-MODEL>/;
  const protocol = normalized.protocol;

  if (protocol === 'anthropic') {
    // Anthropic: system[1].text pattern (legacy behavior adapted for new tag)
    const system = req.body?.system;
    if (Array.isArray(system) && system.length > 1 && typeof system[1]?.text === 'string') {
      const match = system[1].text.match(tagRegex);
      if (match) {
        system[1].text = system[1].text.replace(tagRegex, '');
        return match[1];
      }
    }
    // Also check normalized system array for the tag in any element
    for (let i = 0; i < normalized.system.length; i++) {
      const item = normalized.system[i];
      if (typeof item.text === 'string') {
        const match = item.text.match(tagRegex);
        if (match) {
          // Remove from original body location
          if (Array.isArray(system) && system[i] && typeof system[i].text === 'string') {
            system[i].text = system[i].text.replace(tagRegex, '');
          }
          return match[1];
        }
      }
    }
  } else if (protocol === 'openai-chat') {
    // OpenAI Chat: search role=system messages for the tag
    const messages = req.body?.messages;
    if (Array.isArray(messages)) {
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg?.role === 'system' && typeof msg.content === 'string') {
          const match = msg.content.match(tagRegex);
          if (match) {
            messages[i].content = msg.content.replace(tagRegex, '');
            return match[1];
          }
        }
      }
    }
  } else if (protocol === 'openai-responses') {
    // OpenAI Responses: check instructions first, then input system items
    if (typeof req.body?.instructions === 'string') {
      const match = req.body.instructions.match(tagRegex);
      if (match) {
        req.body.instructions = req.body.instructions.replace(tagRegex, '');
        return match[1];
      }
    }
    const input = req.body?.input;
    if (Array.isArray(input)) {
      for (let i = 0; i < input.length; i++) {
        const item = input[i];
        if (item?.role === 'system' && typeof item.content === 'string') {
          const match = item.content.match(tagRegex);
          if (match) {
            input[i].content = item.content.replace(tagRegex, '');
            return match[1];
          }
        }
      }
    }
  }

  return undefined;
}

export interface RouterContext {
  configService: ConfigService;
  tokenizerService?: TokenizerService;
  event?: any;
}

export type RouterScenarioType = 'default' | 'background' | 'think' | 'longContext' | 'webSearch';

export interface RouterFallbackConfig {
  default?: string[];
  background?: string[];
  think?: string[];
  longContext?: string[];
  webSearch?: string[];
}

export const router = async (req: any, _res: any, context: RouterContext) => {
  const { configService, event } = context;
  const protocol: API_Protocol = req.apiProtocol ?? 'passthrough';

  // Passthrough: do not modify body or set scenario
  if (protocol === 'passthrough') {
    return;
  }

  // Use protocol-aware session manager
  const sessionId = getSessionId(req);
  const lastMessageUsage = sessionUsageCache.get(sessionId);

  // Normalize request body for protocol-agnostic routing
  const normalized = normalizeRequestBody(req);

  // Handle REWRITE_SYSTEM_PROMPT for all protocols
  const rewritePrompt = configService.get("REWRITE_SYSTEM_PROMPT");
  if (rewritePrompt) {
    await applyRewriteSystemPrompt(req, normalized, rewritePrompt);
  }

  try {
    // Calculate token count using protocol-aware extraction
    const tokenCount = await calculateTokensForRequest(req, normalized, context);

    let model;
    const customRouterPath = configService.get("CUSTOM_ROUTER_PATH");
    if (customRouterPath) {
      try {
        const customRouter = require(customRouterPath);
        req.tokenCount = tokenCount;
        model = await customRouter(req, configService.getAll(), {
          event,
        });
      } catch (e: any) {
        req.log.error(`failed to load custom router: ${e.message}`);
      }
    }
    if (!model) {
      const result = await getUseModel(req, normalized, tokenCount, configService, lastMessageUsage);
      model = result.model;
      req.scenarioType = result.scenarioType;
    } else {
      req.scenarioType = 'default';
    }
    req.body.model = model;
  } catch (error: any) {
    req.log.error(`Error in router middleware: ${error.message}`);
    const Router = configService.get("Router");
    req.body.model = Router?.default;
    req.scenarioType = 'default';
  }
  return;
};

/**
 * Apply REWRITE_SYSTEM_PROMPT across all protocols.
 * Replaces content after <env> in system prompts with the custom prompt.
 */
async function applyRewriteSystemPrompt(req: any, normalized: NormalizedRequest, rewritePromptPath: string): Promise<void> {
  const protocol = normalized.protocol;
  const envTag = '<env>';

  try {
    const prompt = await readFile(rewritePromptPath, "utf-8");

    if (protocol === 'anthropic') {
      const system = req.body?.system;
      if (Array.isArray(system) && system.length > 1 && system[1]?.text?.includes(envTag)) {
        system[1].text = `${prompt}${envTag}${system[1].text.split(envTag).pop()}`;
      }
    } else if (protocol === 'openai-chat') {
      const messages = req.body?.messages;
      if (Array.isArray(messages)) {
        for (let i = 0; i < messages.length; i++) {
          if (messages[i]?.role === 'system' && typeof messages[i].content === 'string' && messages[i].content.includes(envTag)) {
            messages[i].content = `${prompt}${envTag}${messages[i].content.split(envTag).pop()}`;
            break;
          }
        }
      }
    } else if (protocol === 'openai-responses') {
      if (typeof req.body?.instructions === 'string' && req.body.instructions.includes(envTag)) {
        req.body.instructions = `${prompt}${envTag}${req.body.instructions.split(envTag).pop()}`;
      }
    }
  } catch (e: any) {
    // Log but don't fail the request if rewrite prompt can't be read
    req.log?.error?.(`Failed to read REWRITE_SYSTEM_PROMPT: ${e.message}`);
  }
}

/**
 * Calculate token count for a request using protocol-aware extraction.
 */
async function calculateTokensForRequest(req: any, normalized: NormalizedRequest, context: RouterContext): Promise<number> {
  const protocol = normalized.protocol;

  // Extract messages and system from the original body based on protocol
  let messages: MessageParam[] = [];
  let system: any = normalized.system;
  let tools: Tool[] = normalized.tools as Tool[];

  if (protocol === 'anthropic') {
    messages = req.body?.messages || [];
    system = req.body?.system || [];
  } else if (protocol === 'openai-chat') {
    // For OpenAI Chat, convert messages to MessageParam format for token counting
    const rawMessages = req.body?.messages;
    if (Array.isArray(rawMessages)) {
      messages = rawMessages
        .filter((m: any) => m?.role !== 'system')
        .map((m: any) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
        }));
    }
  } else if (protocol === 'openai-responses') {
    // For OpenAI Responses, convert input to message format
    const input = req.body?.input;
    if (Array.isArray(input)) {
      messages = input
        .filter((item: any) => item?.role !== 'system')
        .map((item: any) => ({
          role: item.role || 'user',
          content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? ''),
        }));
    }
  }

  // Try to get tokenizer config for the current model
  const modelStr = req.body?.model || '';
  let tokenizerConfig: any;
  if (modelStr.includes(',')) {
    const [providerName, modelName] = modelStr.split(",");
    tokenizerConfig = context.tokenizerService?.getTokenizerConfigForModel(
      providerName,
      modelName
    );
  }

  // Use TokenizerService if available, otherwise fall back to legacy method
  if (context.tokenizerService) {
    const result = await context.tokenizerService.countTokens(
      {
        messages,
        system,
        tools,
      },
      tokenizerConfig
    );
    return result.tokenCount;
  }

  return calculateTokenCount(messages, system, tools);
}

// Memory cache for sessionId to project name mapping
// null value indicates previously searched but not found
// Uses LRU cache with max 1000 entries
const sessionProjectCache = new LRUCache<string, string>({
  max: 1000,
});

export const searchProjectBySession = async (
  sessionId: string
): Promise<string | null> => {
  // Check cache first
  if (sessionProjectCache.has(sessionId)) {
    const result = sessionProjectCache.get(sessionId);
    if (!result || result === '') {
      return null;
    }
    return result;
  }

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR);
    const folderNames: string[] = [];

    // Collect all folder names
    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        folderNames.push(dirent.name);
      }
    }

    // Concurrently check each project folder for sessionId.jsonl file
    const checkPromises = folderNames.map(async (folderName) => {
      const sessionFilePath = join(
        CLAUDE_PROJECTS_DIR,
        folderName,
        `${sessionId}.jsonl`
      );
      try {
        const fileStat = await stat(sessionFilePath);
        return fileStat.isFile() ? folderName : null;
      } catch {
        // File does not exist, continue checking next
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    // Return the first existing project directory name
    for (const result of results) {
      if (result) {
        // Cache the found result
        sessionProjectCache.set(sessionId, result);
        return result;
      }
    }

    // Cache not found result (null value means previously searched but not found)
    sessionProjectCache.set(sessionId, '');
    return null; // No matching project found
  } catch (error) {
    console.error("Error searching for project by session:", error);
    // Cache null result on error to avoid repeated errors
    sessionProjectCache.set(sessionId, '');
    return null;
  }
};
