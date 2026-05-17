import { describe, it, expect } from "vitest";
import { normalizeRequestBody, NormalizedRequest } from "../utils/normalizer";
import { API_Protocol } from "../utils/protocol";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq(
  apiProtocol: API_Protocol,
  body: any = {},
  headers: Record<string, string> = {}
): any {
  return { apiProtocol, body, headers };
}

function defaultResult(protocol: API_Protocol): NormalizedRequest {
  return {
    sessionId: undefined,
    system: [],
    thinking: undefined,
    tools: [],
    hasWebSearch: false,
    protocol,
  };
}

// ── Anthropic protocol ──────────────────────────────────────────────────

describe("normalizeRequestBody — anthropic", () => {
  describe("sessionId", () => {
    const cases: [string, string | undefined, string?][] = [
      ["user123_session_abc", "abc", "splits on first _session_"],
      ["u_session_s1_session_s2", "s1_session_s2", "splits on first occurrence only"],
      ["no-session-here", undefined, "no _session_ → undefined"],
      ["", undefined, "empty string → undefined"],
      [123 as any, undefined, "non-string user_id → undefined"],
    ];

    for (const [userId, expected, label] of cases) {
      it(`${label}`, () => {
        const result = normalizeRequestBody(
          makeReq("anthropic", { metadata: { user_id: userId } })
        );
        expect(result.sessionId).toBe(expected);
      });
    }

    it("missing metadata → undefined", () => {
      const result = normalizeRequestBody(makeReq("anthropic", {}));
      expect(result.sessionId).toBeUndefined();
    });
  });

  describe("system", () => {
    it("array → as-is", () => {
      const sys = [{ type: "text", text: "hello" }, { type: "text", text: "world" }];
      const result = normalizeRequestBody(makeReq("anthropic", { system: sys }));
      expect(result.system).toEqual(sys);
    });

    it("string → wrapped", () => {
      const result = normalizeRequestBody(makeReq("anthropic", { system: "hello" }));
      expect(result.system).toEqual([{ type: "text", text: "hello" }]);
    });

    it("undefined → empty array", () => {
      const result = normalizeRequestBody(makeReq("anthropic", {}));
      expect(result.system).toEqual([]);
    });

    it("null → empty array", () => {
      const result = normalizeRequestBody(makeReq("anthropic", { system: null }));
      expect(result.system).toEqual([]);
    });
  });

  describe("thinking", () => {
    it("defined → pass-through", () => {
      const thinking = { type: "enabled", budget_tokens: 5000 };
      const result = normalizeRequestBody(makeReq("anthropic", { thinking }));
      expect(result.thinking).toEqual(thinking);
    });

    it("undefined → undefined", () => {
      const result = normalizeRequestBody(makeReq("anthropic", {}));
      expect(result.thinking).toBeUndefined();
    });
  });

  describe("tools and hasWebSearch", () => {
    it("array → as-is", () => {
      const tools = [{ name: "tool1" }, { name: "tool2" }];
      const result = normalizeRequestBody(makeReq("anthropic", { tools }));
      expect(result.tools).toEqual(tools);
    });

    it("non-array → empty array", () => {
      const result = normalizeRequestBody(makeReq("anthropic", { tools: "not-array" }));
      expect(result.tools).toEqual([]);
    });

    it("hasWebSearch: true when tool.type starts with web_search", () => {
      const result = normalizeRequestBody(
        makeReq("anthropic", { tools: [{ type: "web_search" }] })
      );
      expect(result.hasWebSearch).toBe(true);
    });

    it("hasWebSearch: true for web_search_preview", () => {
      const result = normalizeRequestBody(
        makeReq("anthropic", { tools: [{ type: "web_search_preview" }] })
      );
      expect(result.hasWebSearch).toBe(true);
    });

    it("hasWebSearch: false when no web_search tools", () => {
      const result = normalizeRequestBody(
        makeReq("anthropic", { tools: [{ type: "text_editor" }] })
      );
      expect(result.hasWebSearch).toBe(false);
    });
  });

  it("protocol is preserved", () => {
    const result = normalizeRequestBody(makeReq("anthropic", {}));
    expect(result.protocol).toBe("anthropic");
  });
});

// ── OpenAI Chat protocol ───────────────────────────────────────────────

describe("normalizeRequestBody — openai-chat", () => {
  describe("sessionId", () => {
    it("from X-Session-Id header (lowercase)", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", {}, { "x-session-id": "sess-123" })
      );
      expect(result.sessionId).toBe("sess-123");
    });

    it("from X-Session-Id header (mixed case)", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", {}, { "X-Session-Id": "sess-456" })
      );
      expect(result.sessionId).toBe("sess-456");
    });

    it("trims whitespace", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", {}, { "x-session-id": "  sess-789  " })
      );
      expect(result.sessionId).toBe("sess-789");
    });

    it("empty after trim → undefined", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", {}, { "x-session-id": "   " })
      );
      expect(result.sessionId).toBeUndefined();
    });

    it("missing header → undefined", () => {
      const result = normalizeRequestBody(makeReq("openai-chat", {}, {}));
      expect(result.sessionId).toBeUndefined();
    });
  });

  describe("system", () => {
    it("extracts role=system messages", () => {
      const messages = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
        { role: "system", content: "Be concise" },
      ];
      const result = normalizeRequestBody(makeReq("openai-chat", { messages }));
      expect(result.system).toEqual([
        { type: "text", text: "You are helpful" },
        { type: "text", text: "Be concise" },
      ]);
    });

    it("no system messages → empty array", () => {
      const messages = [{ role: "user", content: "Hi" }];
      const result = normalizeRequestBody(makeReq("openai-chat", { messages }));
      expect(result.system).toEqual([]);
    });

    it("no messages field → empty array", () => {
      const result = normalizeRequestBody(makeReq("openai-chat", {}));
      expect(result.system).toEqual([]);
    });
  });

  describe("thinking", () => {
    it("reasoning_effort non-empty string → wrapped", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", { reasoning_effort: "high" })
      );
      expect(result.thinking).toEqual({ reasoning_effort: "high" });
    });

    it("reasoning_effort empty string → undefined", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", { reasoning_effort: "" })
      );
      expect(result.thinking).toBeUndefined();
    });

    it("reasoning_effort missing → undefined", () => {
      const result = normalizeRequestBody(makeReq("openai-chat", {}));
      expect(result.thinking).toBeUndefined();
    });
  });

  describe("tools and hasWebSearch", () => {
    it("tools array → as-is", () => {
      const tools = [{ type: "function", function: { name: "fn1" } }];
      const result = normalizeRequestBody(makeReq("openai-chat", { tools }));
      expect(result.tools).toEqual(tools);
    });

    it("hasWebSearch from web_search type", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", { tools: [{ type: "web_search" }] })
      );
      expect(result.hasWebSearch).toBe(true);
    });

    it("hasWebSearch from web_search_preview type", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", { tools: [{ type: "web_search_preview" }] })
      );
      expect(result.hasWebSearch).toBe(true);
    });

    it("hasWebSearch false for non-web tools", () => {
      const result = normalizeRequestBody(
        makeReq("openai-chat", { tools: [{ type: "function" }] })
      );
      expect(result.hasWebSearch).toBe(false);
    });
  });
});

// ── OpenAI Responses protocol ───────────────────────────────────────────

describe("normalizeRequestBody — openai-responses", () => {
  describe("sessionId", () => {
    it("from X-Session-Id header", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", {}, { "x-session-id": "resp-session" })
      );
      expect(result.sessionId).toBe("resp-session");
    });

    it("missing header → undefined", () => {
      const result = normalizeRequestBody(makeReq("openai-responses", {}, {}));
      expect(result.sessionId).toBeUndefined();
    });
  });

  describe("system", () => {
    it("instructions as single element", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", { instructions: "You are helpful" })
      );
      expect(result.system).toEqual([{ type: "text", text: "You are helpful" }]);
    });

    it("system-role input items appended after instructions", () => {
      const input = [
        { role: "system", content: "Rule 1" },
        { role: "user", content: "Hi" },
        { role: "system", content: "Rule 2" },
      ];
      const result = normalizeRequestBody(
        makeReq("openai-responses", { instructions: "Main", input })
      );
      expect(result.system).toEqual([
        { type: "text", text: "Main" },
        { type: "text", text: "Rule 1" },
        { type: "text", text: "Rule 2" },
      ]);
    });

    it("no instructions or input → empty array", () => {
      const result = normalizeRequestBody(makeReq("openai-responses", {}));
      expect(result.system).toEqual([]);
    });

    it("only input with system items, no instructions", () => {
      const input = [{ role: "system", content: "Rule" }];
      const result = normalizeRequestBody(
        makeReq("openai-responses", { input })
      );
      expect(result.system).toEqual([{ type: "text", text: "Rule" }]);
    });
  });

  describe("thinking", () => {
    it("reasoning.effort non-empty string → wrapped", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", { reasoning: { effort: "medium" } })
      );
      expect(result.thinking).toEqual({ effort: "medium" });
    });

    it("reasoning.effort empty string → undefined", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", { reasoning: { effort: "" } })
      );
      expect(result.thinking).toBeUndefined();
    });

    it("reasoning missing → undefined", () => {
      const result = normalizeRequestBody(makeReq("openai-responses", {}));
      expect(result.thinking).toBeUndefined();
    });
  });

  describe("tools and hasWebSearch", () => {
    it("hasWebSearch from web_search type", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", { tools: [{ type: "web_search" }] })
      );
      expect(result.hasWebSearch).toBe(true);
    });

    it("hasWebSearch from web_search_preview type", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", { tools: [{ type: "web_search_preview" }] })
      );
      expect(result.hasWebSearch).toBe(true);
    });

    it("hasWebSearch false for function tools", () => {
      const result = normalizeRequestBody(
        makeReq("openai-responses", { tools: [{ type: "function", name: "fn" }] })
      );
      expect(result.hasWebSearch).toBe(false);
    });
  });
});

// ── Passthrough and malformed input ─────────────────────────────────────

describe("normalizeRequestBody — passthrough and malformed", () => {
  it("passthrough returns defaults", () => {
    const result = normalizeRequestBody(makeReq("passthrough", { model: "gpt-4" }));
    expect(result).toEqual(defaultResult("passthrough"));
  });

  it("undefined apiProtocol defaults to passthrough", () => {
    const result = normalizeRequestBody({ body: {} });
    expect(result.protocol).toBe("passthrough");
  });

  it("null body returns defaults", () => {
    const result = normalizeRequestBody({ apiProtocol: "anthropic", body: null });
    expect(result).toEqual(defaultResult("anthropic"));
  });

  it("undefined body returns defaults", () => {
    const result = normalizeRequestBody({ apiProtocol: "openai-chat", body: undefined });
    expect(result).toEqual(defaultResult("openai-chat"));
  });

  it("array body returns defaults", () => {
    const result = normalizeRequestBody({ apiProtocol: "anthropic", body: [1, 2, 3] });
    expect(result).toEqual(defaultResult("anthropic"));
  });

  it("string body returns defaults", () => {
    const result = normalizeRequestBody({ apiProtocol: "openai-chat", body: "not-json" });
    expect(result).toEqual(defaultResult("openai-chat"));
  });

  it("number body returns defaults", () => {
    const result = normalizeRequestBody({ apiProtocol: "openai-responses", body: 42 });
    expect(result).toEqual(defaultResult("openai-responses"));
  });

  it("null req returns defaults with passthrough", () => {
    const result = normalizeRequestBody(null);
    expect(result).toEqual(defaultResult("passthrough"));
  });

  it("undefined req returns defaults with passthrough", () => {
    const result = normalizeRequestBody(undefined);
    expect(result).toEqual(defaultResult("passthrough"));
  });
});

// ── Property tests ──────────────────────────────────────────────────────

describe("normalizeRequestBody — property tests", () => {
  describe("property: idempotent (same input → same output)", () => {
    const reqs = [
      makeReq("anthropic", {
        metadata: { user_id: "u_session_s1" },
        system: [{ type: "text", text: "hello" }],
        thinking: { type: "enabled" },
        tools: [{ type: "web_search" }],
      }),
      makeReq("openai-chat", {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
        reasoning_effort: "high",
        tools: [{ type: "function" }],
      }, { "x-session-id": "s1" }),
      makeReq("openai-responses", {
        instructions: "main",
        input: [{ role: "system", content: "rule" }],
        reasoning: { effort: "low" },
        tools: [{ type: "web_search_preview" }],
      }, { "x-session-id": "s2" }),
      makeReq("passthrough", { model: "gpt-4" }),
    ];

    for (const req of reqs) {
      it(`idempotent for protocol=${req.apiProtocol}`, () => {
        const first = normalizeRequestBody(req);
        const second = normalizeRequestBody(req);
        expect(first).toEqual(second);
      });
    }
  });

  describe("property: never throws on any input", () => {
    const edgeCases: any[] = [
      null,
      undefined,
      {},
      { body: null },
      { body: undefined },
      { body: "string" },
      { body: 42 },
      { body: true },
      { body: [] },
      { apiProtocol: "anthropic", body: { metadata: null } },
      { apiProtocol: "anthropic", body: { system: null } },
      { apiProtocol: "anthropic", body: { tools: null } },
      { apiProtocol: "openai-chat", body: { messages: null } },
      { apiProtocol: "openai-chat", body: { messages: [null] } },
      { apiProtocol: "openai-responses", body: { input: null } },
      { apiProtocol: "openai-responses", body: { input: [null] } },
      { apiProtocol: "openai-responses", body: { reasoning: null } },
      { apiProtocol: "unknown-protocol" as any, body: {} },
      // Fuzz: random objects
      ...Array.from({ length: 20 }, () => ({
        apiProtocol: ["anthropic", "openai-chat", "openai-responses", "passthrough"][
          Math.floor(Math.random() * 4)
        ],
        body: { random: Math.random() },
        headers: {},
      })),
    ];

    for (const input of edgeCases) {
      it(`${JSON.stringify(input)?.slice(0, 80)} does not throw`, () => {
        expect(() => normalizeRequestBody(input)).not.toThrow();
        const result = normalizeRequestBody(input);
        // Verify structure
        expect(result).toHaveProperty("sessionId");
        expect(result).toHaveProperty("system");
        expect(result).toHaveProperty("thinking");
        expect(result).toHaveProperty("tools");
        expect(result).toHaveProperty("hasWebSearch");
        expect(result).toHaveProperty("protocol");
        expect(Array.isArray(result.system)).toBe(true);
        expect(Array.isArray(result.tools)).toBe(true);
        expect(typeof result.hasWebSearch).toBe("boolean");
      });
    }
  });

  describe("property: hasWebSearch depends on tools", () => {
    it("no tools → hasWebSearch false for all protocols", () => {
      for (const protocol of ["anthropic", "openai-chat", "openai-responses"] as API_Protocol[]) {
        const result = normalizeRequestBody(makeReq(protocol, {}));
        expect(result.hasWebSearch).toBe(false);
      }
    });

    it("web_search tool → hasWebSearch true for all protocols", () => {
      for (const protocol of ["anthropic", "openai-chat", "openai-responses"] as API_Protocol[]) {
        const result = normalizeRequestBody(
          makeReq(protocol, { tools: [{ type: "web_search" }] })
        );
        expect(result.hasWebSearch).toBe(true);
      }
    });

    it("web_search_preview tool → hasWebSearch true for all protocols", () => {
      for (const protocol of ["anthropic", "openai-chat", "openai-responses"] as API_Protocol[]) {
        const result = normalizeRequestBody(
          makeReq(protocol, { tools: [{ type: "web_search_preview" }] })
        );
        expect(result.hasWebSearch).toBe(true);
      }
    });
  });
});
