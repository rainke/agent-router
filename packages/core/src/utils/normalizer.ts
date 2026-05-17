import { API_Protocol } from "./protocol";

/**
 * Normalized request body structure, protocol-agnostic.
 */
export interface NormalizedRequest {
  sessionId?: string;
  system: Array<{ type: string; text?: string }>;
  thinking?: any;
  tools: any[];
  hasWebSearch: boolean;
  protocol: API_Protocol;
}

/**
 * Normalize a Fastify request body into a protocol-agnostic structure.
 *
 * Extracts sessionId, system, thinking, tools, hasWebSearch from three protocol
 * formats (anthropic, openai-chat, openai-responses). Never throws — malformed
 * or unknown-protocol inputs yield default values.
 */
export function normalizeRequestBody(req: any): NormalizedRequest {
  const protocol: API_Protocol = req?.apiProtocol ?? "passthrough";
  const body = req?.body;

  // Guard: body must be a non-null object
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      sessionId: undefined,
      system: [],
      thinking: undefined,
      tools: [],
      hasWebSearch: false,
      protocol,
    };
  }

  switch (protocol) {
    case "anthropic":
      return normalizeAnthropic(body, protocol);
    case "openai-chat":
      return normalizeOpenAIChat(req, body, protocol);
    case "openai-responses":
      return normalizeOpenAIResponses(req, body, protocol);
    default:
      return {
        sessionId: undefined,
        system: [],
        thinking: undefined,
        tools: [],
        hasWebSearch: false,
        protocol,
      };
  }
}

function normalizeAnthropic(body: any, protocol: API_Protocol): NormalizedRequest {
  // Session ID from metadata.user_id split on first _session_
  let sessionId: string | undefined;
  const userId: string | undefined = body.metadata?.user_id;
  if (typeof userId === "string") {
    const idx = userId.indexOf("_session_");
    if (idx !== -1) {
      sessionId = userId.slice(idx + "_session_".length);
    }
  }

  // System: array → as-is; string → wrap; undefined/null → empty
  let system: Array<{ type: string; text?: string }>;
  const rawSystem = body.system;
  if (Array.isArray(rawSystem)) {
    system = rawSystem;
  } else if (typeof rawSystem === "string") {
    system = [{ type: "text", text: rawSystem }];
  } else {
    system = [];
  }

  // Thinking: pass-through if defined
  const thinking = body.thinking;

  // Tools: array → as-is; else empty
  const tools = Array.isArray(body.tools) ? body.tools : [];

  // hasWebSearch: any tool.type starts with "web_search"
  const hasWebSearch = tools.some(
    (t: any) => typeof t?.type === "string" && t.type.startsWith("web_search")
  );

  return { sessionId, system, thinking, tools, hasWebSearch, protocol };
}

function normalizeOpenAIChat(req: any, body: any, protocol: API_Protocol): NormalizedRequest {
  // Session ID from X-Session-Id header (case-insensitive)
  let sessionId: string | undefined;
  const headers = req?.headers;
  if (headers && typeof headers === "object") {
    const sessionIdHeader = getHeader(headers, "x-session-id");
    if (typeof sessionIdHeader === "string") {
      const trimmed = sessionIdHeader.trim();
      if (trimmed.length > 0) {
        sessionId = trimmed;
      }
    }
  }

  // System: extract role=system messages
  let system: Array<{ type: string; text?: string }> = [];
  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg?.role === "system") {
        const text = typeof msg.content === "string"
          ? msg.content
          : msg.content != null ? String(msg.content) : "";
        system.push({ type: "text", text });
      }
    }
  }

  // Thinking: reasoning_effort
  let thinking: any;
  if (typeof body.reasoning_effort === "string" && body.reasoning_effort.length > 0) {
    thinking = { reasoning_effort: body.reasoning_effort };
  }

  // Tools
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const hasWebSearch = tools.some(
    (t: any) => typeof t?.type === "string" && t.type.startsWith("web_search")
  );

  return { sessionId, system, thinking, tools, hasWebSearch, protocol };
}

function normalizeOpenAIResponses(req: any, body: any, protocol: API_Protocol): NormalizedRequest {
  // Session ID from X-Session-Id header (case-insensitive)
  let sessionId: string | undefined;
  const headers = req?.headers;
  if (headers && typeof headers === "object") {
    const sessionIdHeader = getHeader(headers, "x-session-id");
    if (typeof sessionIdHeader === "string") {
      const trimmed = sessionIdHeader.trim();
      if (trimmed.length > 0) {
        sessionId = trimmed;
      }
    }
  }

  // System: instructions + system-role input items
  let system: Array<{ type: string; text?: string }> = [];
  if (typeof body.instructions === "string") {
    system.push({ type: "text", text: body.instructions });
  }
  const input = body.input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item?.role === "system") {
        const text = typeof item.content === "string"
          ? item.content
          : item.content != null ? String(item.content) : "";
        system.push({ type: "text", text });
      }
    }
  }

  // Thinking: reasoning.effort
  let thinking: any;
  if (typeof body.reasoning?.effort === "string" && body.reasoning.effort.length > 0) {
    thinking = { effort: body.reasoning.effort };
  }

  // Tools
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const hasWebSearch = tools.some(
    (t: any) => typeof t?.type === "string" && t.type.startsWith("web_search")
  );

  return { sessionId, system, thinking, tools, hasWebSearch, protocol };
}

/**
 * Case-insensitive header lookup.
 * Fastify lowercases all header keys, but this handles both cases.
 */
function getHeader(headers: Record<string, any>, name: string): string | undefined {
  const lower = name.toLowerCase();
  // Try exact match first (Fastify normalizes to lowercase)
  if (headers[lower] !== undefined) return headers[lower];
  // Fallback: search keys case-insensitively
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}
