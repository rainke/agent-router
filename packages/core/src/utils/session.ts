import { v4 as uuidv4 } from "uuid";
import { API_Protocol } from "./protocol";

/**
 * Protocol-aware Session Manager.
 *
 * - Anthropic: extracts sessionId from metadata.user_id._session_
 * - OpenAI Chat/Responses: reads X-Session-Id header; generates UUID v4 if absent
 * - Passthrough: returns empty string (no session tracking)
 *
 * Idempotent per-request: caches result on req._agrSessionId.
 */

/**
 * Extract or generate a session ID for the given request.
 * Returns a non-empty string for anthropic/openai-chat/openai-responses;
 * returns empty string for passthrough.
 */
export function getSessionId(req: any): string {
  // Guard: null/undefined req
  if (req == null) return "";

  // Idempotency: return cached value if already computed
  if (req._agrSessionId !== undefined) {
    return req._agrSessionId;
  }

  const protocol: API_Protocol = req?.apiProtocol ?? "passthrough";
  let sessionId = "";
  let generated = false;

  switch (protocol) {
    case "anthropic":
      sessionId = extractAnthropicSessionId(req) || "";
      break;
    case "openai-chat":
    case "openai-responses": {
      const extracted = extractOpenAISessionId(req);
      if (extracted) {
        sessionId = extracted;
      } else {
        sessionId = generateSessionId();
        generated = true;
      }
      break;
    }
    default:
      break;
  }

  req._agrSessionId = sessionId;
  req._agrSessionGenerated = generated;
  req.sessionId = sessionId;
  return sessionId;
}

/**
 * Write X-Session-Id response header when the session ID was generated
 * (not provided by the client) for OpenAI protocols.
 */
export function applySessionIdHeader(req: any, reply: any): void {
  const protocol: API_Protocol = req?.apiProtocol ?? "passthrough";
  if (protocol !== "openai-chat" && protocol !== "openai-responses") {
    return;
  }
  if (req._agrSessionGenerated && req._agrSessionId) {
    reply.header("X-Session-Id", req._agrSessionId);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

function extractAnthropicSessionId(req: any): string | undefined {
  const userId: string | undefined = req?.body?.metadata?.user_id;
  if (typeof userId !== "string") return undefined;
  const idx = userId.indexOf("_session_");
  if (idx === -1) return undefined;
  const sessionId = userId.slice(idx + "_session_".length);
  return sessionId.length > 0 ? sessionId : undefined;
}

function extractOpenAISessionId(req: any): string | undefined {
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return undefined;
  const value = getHeader(headers, "x-session-id");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function generateSessionId(): string {
  try {
    return uuidv4();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function getHeader(headers: Record<string, any>, name: string): string | undefined {
  const lower = name.toLowerCase();
  if (headers[lower] !== undefined) return headers[lower];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}
