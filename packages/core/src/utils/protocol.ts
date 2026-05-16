/**
 * API protocol type representing the detected request format.
 */
export type API_Protocol = 'anthropic' | 'openai-chat' | 'openai-responses' | 'passthrough';

/**
 * Detect the API protocol from a URL pathname.
 *
 * Priority: anthropic -> openai-chat -> openai-responses -> passthrough.
 * Trailing slashes are allowed. Responses does not match strict sub-paths.
 * Any input (null, undefined, empty, very long) returns passthrough without throwing.
 */
export function detectApiProtocol(pathname: string | null | undefined): API_Protocol {
  if (typeof pathname !== 'string') return 'passthrough';

  // Match exact paths with optional trailing slash
  // Anthropic: /v1/messages or /v1/messages/
  if (pathname === '/v1/messages' || pathname === '/v1/messages/') return 'anthropic';
  // OpenAI Chat: /v1/chat/completions or /v1/chat/completions/
  if (pathname === '/v1/chat/completions' || pathname === '/v1/chat/completions/') return 'openai-chat';
  // OpenAI Responses: /v1/responses or /v1/responses/ only (not /v1/responses/*)
  if (pathname === '/v1/responses' || pathname === '/v1/responses/') return 'openai-responses';

  return 'passthrough';
}
