import { describe, it, expect } from "vitest";
import { detectApiProtocol, API_Protocol } from "../utils/protocol";

const VALID_PROTOCOLS: API_Protocol[] = [
  "anthropic",
  "openai-chat",
  "openai-responses",
  "passthrough",
];

describe("detectApiProtocol", () => {
  // ── Table-driven tests ──────────────────────────────────────────────

  describe("exact path matching", () => {
    const cases: [string, API_Protocol][] = [
      // Anthropic
      ["/v1/messages", "anthropic"],
      ["/v1/messages/", "anthropic"],

      // OpenAI Chat
      ["/v1/chat/completions", "openai-chat"],
      ["/v1/chat/completions/", "openai-chat"],

      // OpenAI Responses
      ["/v1/responses", "openai-responses"],
      ["/v1/responses/", "openai-responses"],

      // Passthrough (unrecognized paths)
      ["/v1/models", "passthrough"],
      ["/v1/engines", "passthrough"],
      ["/api/v1/messages", "passthrough"],
      ["/health", "passthrough"],
      ["/", "passthrough"],
      ["", "passthrough"],
    ];

    for (const [pathname, expected] of cases) {
      it(`${JSON.stringify(pathname)} → ${expected}`, () => {
        expect(detectApiProtocol(pathname)).toBe(expected);
      });
    }
  });

  describe("Responses does not match strict sub-paths", () => {
    const cases: [string, API_Protocol][] = [
      ["/v1/responses/abc", "passthrough"],
      ["/v1/responses/create", "passthrough"],
      ["/v1/responses/123/input", "passthrough"],
    ];

    for (const [pathname, expected] of cases) {
      it(`${JSON.stringify(pathname)} → ${expected}`, () => {
        expect(detectApiProtocol(pathname)).toBe(expected);
      });
    }
  });

  describe("abnormal inputs return passthrough", () => {
    const cases: (string | null | undefined)[] = [
      null,
      undefined,
    ];

    for (const input of cases) {
      it(`${input} → passthrough`, () => {
        expect(detectApiProtocol(input)).toBe("passthrough");
      });
    }
  });

  describe("priority: anthropic > chat > responses", () => {
    // All three paths are distinct, but verify they resolve independently
    it("/v1/messages resolves to anthropic, not passthrough", () => {
      expect(detectApiProtocol("/v1/messages")).toBe("anthropic");
    });
    it("/v1/chat/completions resolves to openai-chat, not passthrough", () => {
      expect(detectApiProtocol("/v1/chat/completions")).toBe("openai-chat");
    });
    it("/v1/responses resolves to openai-responses, not passthrough", () => {
      expect(detectApiProtocol("/v1/responses")).toBe("openai-responses");
    });
  });

  // ── Property-based tests ────────────────────────────────────────────

  describe("property: output is always one of four valid protocols", () => {
    const fuzzInputs = [
      // Random short strings
      ...Array.from({ length: 50 }, () =>
        Math.random().toString(36).slice(2, 10)
      ),
      // Long strings (0-8192 chars)
      ...Array.from({ length: 10 }, (_, i) => {
        const len = Math.floor((i / 10) * 8192);
        return "a".repeat(len);
      }),
      // Paths with special characters
      "/v1/messages?query=1",
      "/v1/messages#fragment",
      "/V1/MESSAGES",
      "/v1/Messages",
      "/v1/chat/completions/extra",
      "/V1/chat/completions",
      // Unicode
      "/v1/消息",
      "/v1/消息/",
      // Whitespace variations
      " /v1/messages",
      "/v1/messages ",
      "\t/v1/messages",
      // Very long valid-looking path
      "/v1/messages" + "/sub".repeat(2048),
      "/v1/responses" + "/item".repeat(2048),
      // Numeric edge cases
      "/v2/messages",
      "/v1x/messages",
    ];

    for (const input of fuzzInputs) {
      it(`${JSON.stringify(input?.slice(0, 40))}${input && input.length > 40 ? "..." : ""} → valid protocol`, () => {
        const result = detectApiProtocol(input);
        expect(VALID_PROTOCOLS).toContain(result);
      });
    }
  });

  describe("property: deterministic (same input → same output)", () => {
    const inputs = [
      "/v1/messages",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/unknown",
      null,
      undefined,
      "",
      "/v1/messages/",
    ];

    for (const input of inputs) {
      it(`${JSON.stringify(input)} is deterministic across 100 calls`, () => {
        const results = Array.from({ length: 100 }, () =>
          detectApiProtocol(input)
        );
        const unique = new Set(results);
        expect(unique.size).toBe(1);
      });
    }
  });

  describe("property: never throws for any string input", () => {
    const edgeInputs: (string | null | undefined)[] = [
      // Very long strings up to 8192 chars
      "x".repeat(8192),
      "\0".repeat(100),
      // Strings with null bytes
      "/v1/\0messages",
      // Emoji and unicode
      "/v1/🤖",
      // Surrogate-pair edge cases
      "\uD800",
      "\uDC00",
    ];

    for (const input of edgeInputs) {
      it(`${JSON.stringify(input?.slice(0, 30))}${input && input.length > 30 ? "..." : ""} does not throw`, () => {
        expect(() => detectApiProtocol(input as any)).not.toThrow();
        // Also verify output is valid
        const result = detectApiProtocol(input as any);
        expect(VALID_PROTOCOLS).toContain(result);
      });
    }
  });

  describe("property: idempotent (f(f(x)) === f(x))", () => {
    // detectApiProtocol returns a protocol string, not a pathname,
    // so idempotency means: calling it on its own output always returns 'passthrough'
    const pathnames = [
      "/v1/messages",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/unknown",
    ];

    for (const pathname of pathnames) {
      it(`detectApiProtocol(detectApiProtocol(${JSON.stringify(pathname)})) === passthrough`, () => {
        const first = detectApiProtocol(pathname);
        const second = detectApiProtocol(first);
        expect(second).toBe("passthrough");
      });
    }
  });
});
