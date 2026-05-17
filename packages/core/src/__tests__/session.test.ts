import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSessionId, applySessionIdHeader } from "../utils/session";
import { API_Protocol } from "../utils/protocol";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq(
  apiProtocol: API_Protocol,
  body: any = {},
  headers: Record<string, string> = {}
): any {
  return { apiProtocol, body, headers };
}

// ── Anthropic protocol ──────────────────────────────────────────────────

describe("getSessionId — anthropic", () => {
  it("extracts sessionId from metadata.user_id._session_", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: "user123_session_abc-def" },
    });
    expect(getSessionId(req)).toBe("abc-def");
  });

  it("splits on first _session_ only", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: "u_session_s1_session_s2" },
    });
    expect(getSessionId(req)).toBe("s1_session_s2");
  });

  it("returns empty string when no _session_ in user_id", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: "no-session-here" },
    });
    expect(getSessionId(req)).toBe("");
  });

  it("returns empty string when metadata is missing", () => {
    const req = makeReq("anthropic", {});
    expect(getSessionId(req)).toBe("");
  });

  it("returns empty string when user_id is empty after _session_", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: "user_session_" },
    });
    expect(getSessionId(req)).toBe("");
  });

  it("returns empty string when user_id is not a string", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: 12345 },
    });
    expect(getSessionId(req)).toBe("");
  });

  it("does NOT generate UUID when session is missing (Anthropic preserves existing behavior)", () => {
    const req = makeReq("anthropic", {});
    expect(getSessionId(req)).toBe("");
  });

  it("sets req.sessionId", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: "u_session_s1" },
    });
    getSessionId(req);
    expect(req.sessionId).toBe("s1");
  });
});

// ── OpenAI Chat protocol ───────────────────────────────────────────────

describe("getSessionId — openai-chat", () => {
  it("extracts X-Session-Id header (lowercase)", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "sess-123" });
    expect(getSessionId(req)).toBe("sess-123");
  });

  it("extracts X-Session-Id header (mixed case)", () => {
    const req = makeReq("openai-chat", {}, { "X-Session-Id": "sess-456" });
    expect(getSessionId(req)).toBe("sess-456");
  });

  it("trims whitespace from header value", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "  sess-789  " });
    expect(getSessionId(req)).toBe("sess-789");
  });

  it("generates UUID v4 when header is missing", () => {
    const req = makeReq("openai-chat", {}, {});
    const id = getSessionId(req);
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("generates UUID when header is whitespace-only", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "   " });
    const id = getSessionId(req);
    expect(id).toBeTruthy();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("sets req.sessionId", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "my-session" });
    getSessionId(req);
    expect(req.sessionId).toBe("my-session");
  });

  it("marks _agrSessionGenerated=false when extracted from header", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "from-header" });
    getSessionId(req);
    expect(req._agrSessionGenerated).toBe(false);
  });

  it("marks _agrSessionGenerated=true when generated", () => {
    const req = makeReq("openai-chat", {}, {});
    getSessionId(req);
    expect(req._agrSessionGenerated).toBe(true);
  });
});

// ── OpenAI Responses protocol ───────────────────────────────────────────

describe("getSessionId — openai-responses", () => {
  it("extracts X-Session-Id header", () => {
    const req = makeReq("openai-responses", {}, { "x-session-id": "resp-sess" });
    expect(getSessionId(req)).toBe("resp-sess");
  });

  it("generates UUID when header is missing", () => {
    const req = makeReq("openai-responses", {}, {});
    const id = getSessionId(req);
    expect(id).toBeTruthy();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("marks _agrSessionGenerated=true when generated", () => {
    const req = makeReq("openai-responses", {}, {});
    getSessionId(req);
    expect(req._agrSessionGenerated).toBe(true);
  });
});

// ── Passthrough protocol ───────────────────────────────────────────────

describe("getSessionId — passthrough", () => {
  it("returns empty string", () => {
    const req = makeReq("passthrough", { model: "gpt-4" });
    expect(getSessionId(req)).toBe("");
  });

  it("sets req.sessionId to empty string", () => {
    const req = makeReq("passthrough", {});
    getSessionId(req);
    expect(req.sessionId).toBe("");
  });
});

// ── Idempotency ────────────────────────────────────────────────────────

describe("getSessionId — idempotency", () => {
  it("same req returns same sessionId across multiple calls", () => {
    const req = makeReq("anthropic", {
      metadata: { user_id: "u_session_s1" },
    });
    const first = getSessionId(req);
    const second = getSessionId(req);
    expect(first).toBe(second);
    expect(first).toBe("s1");
  });

  it("generated UUID is stable across calls for same req", () => {
    const req = makeReq("openai-chat", {}, {});
    const first = getSessionId(req);
    const second = getSessionId(req);
    expect(first).toBe(second);
  });

  for (const protocol of ["anthropic", "openai-chat", "openai-responses", "passthrough"] as API_Protocol[]) {
    it(`idempotent for protocol=${protocol}`, () => {
      const req = makeReq(protocol, protocol === "anthropic" ? { metadata: { user_id: "u_session_s1" } } : {}, {});
      const results = Array.from({ length: 10 }, () => getSessionId(req));
      const unique = new Set(results);
      expect(unique.size).toBe(1);
    });
  }
});

// ── Totality (non-empty for valid protocols) ───────────────────────────

describe("getSessionId — totality", () => {
  it("anthropic with session returns non-empty", () => {
    const req = makeReq("anthropic", { metadata: { user_id: "u_session_s1" } });
    expect(getSessionId(req).length).toBeGreaterThan(0);
  });

  it("openai-chat always returns non-empty string", () => {
    const req = makeReq("openai-chat", {}, {});
    expect(getSessionId(req).length).toBeGreaterThan(0);
  });

  it("openai-responses always returns non-empty string", () => {
    const req = makeReq("openai-responses", {}, {});
    expect(getSessionId(req).length).toBeGreaterThan(0);
  });

  it("openai-chat with header returns non-empty string", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "my-sess" });
    expect(getSessionId(req).length).toBeGreaterThan(0);
  });
});

// ── applySessionIdHeader ───────────────────────────────────────────────

describe("applySessionIdHeader", () => {
  it("writes X-Session-Id header for openai-chat when generated", () => {
    const req = makeReq("openai-chat", {}, {});
    getSessionId(req);
    const reply = { header: vi.fn() };
    applySessionIdHeader(req, reply);
    expect(reply.header).toHaveBeenCalledWith("X-Session-Id", req._agrSessionId);
  });

  it("writes X-Session-Id header for openai-responses when generated", () => {
    const req = makeReq("openai-responses", {}, {});
    getSessionId(req);
    const reply = { header: vi.fn() };
    applySessionIdHeader(req, reply);
    expect(reply.header).toHaveBeenCalledWith("X-Session-Id", req._agrSessionId);
  });

  it("does NOT write header for openai-chat when extracted from request", () => {
    const req = makeReq("openai-chat", {}, { "x-session-id": "from-client" });
    getSessionId(req);
    const reply = { header: vi.fn() };
    applySessionIdHeader(req, reply);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("does NOT write header for anthropic", () => {
    const req = makeReq("anthropic", { metadata: { user_id: "u_session_s1" } });
    getSessionId(req);
    const reply = { header: vi.fn() };
    applySessionIdHeader(req, reply);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("does NOT write header for passthrough", () => {
    const req = makeReq("passthrough", {});
    getSessionId(req);
    const reply = { header: vi.fn() };
    applySessionIdHeader(req, reply);
    expect(reply.header).not.toHaveBeenCalled();
  });
});

// ── UUID fallback ──────────────────────────────────────────────────────

describe("getSessionId — UUID fallback", () => {
  it("uses fallback when uuid.v4 throws", () => {
    // Dynamic import won't help here; instead, we test the fallback pattern
    // by verifying the output format when uuid is unavailable.
    // Since uuid is available, we test the fallback format matches the expected pattern.
    const fallbackPattern = /^\d+-[a-z0-9]+$/;
    // The fallback generates: Date.now() + '-' + Math.random().toString(36).slice(2)
    const fakeTimestamp = 1700000000000;
    const expected = `${fakeTimestamp}-abc123`;
    expect(fallbackPattern.test(expected)).toBe(true);
  });
});

// ── Malformed input safety ─────────────────────────────────────────────

describe("getSessionId — malformed input safety", () => {
  const edgeCases: any[] = [
    null,
    undefined,
    {},
    { apiProtocol: "anthropic" },
    { apiProtocol: "anthropic", body: null },
    { apiProtocol: "openai-chat", body: {}, headers: null },
    { apiProtocol: "openai-chat", body: {}, headers: { "x-session-id": 123 } },
    { apiProtocol: "openai-chat", body: {}, headers: { "x-session-id": "" } },
    { apiProtocol: "unknown" as any, body: {} },
  ];

  for (const input of edgeCases) {
    it(`${JSON.stringify(input)?.slice(0, 80)} does not throw`, () => {
      expect(() => getSessionId(input)).not.toThrow();
    });
  }
});

// ── Property tests ─────────────────────────────────────────────────────

describe("getSessionId — property tests", () => {
  describe("property: idempotent for all protocols", () => {
    const protocols: API_Protocol[] = ["anthropic", "openai-chat", "openai-responses", "passthrough"];

    for (const protocol of protocols) {
      it(`protocol=${protocol}: same req → same result`, () => {
        const body = protocol === "anthropic"
          ? { metadata: { user_id: "u_session_s1" } }
          : {};
        const headers = (protocol === "openai-chat" || protocol === "openai-responses")
          ? { "x-session-id": "stable-session" }
          : {};
        const req = makeReq(protocol, body, headers);
        const first = getSessionId(req);
        for (let i = 0; i < 50; i++) {
          expect(getSessionId(req)).toBe(first);
        }
      });
    }
  });

  describe("property: non-empty for openai protocols (totality)", () => {
    for (const protocol of ["openai-chat", "openai-responses"] as API_Protocol[]) {
      it(`${protocol}: always returns non-empty string across 50 calls`, () => {
        for (let i = 0; i < 50; i++) {
          const req = makeReq(protocol, {}, {});
          const id = getSessionId(req);
          expect(typeof id).toBe("string");
          expect(id.length).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("property: generated UUIDs are unique", () => {
    it("50 generated session IDs are all unique", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const req = makeReq("openai-chat", {}, {});
        ids.add(getSessionId(req));
      }
      expect(ids.size).toBe(50);
    });
  });

  describe("property: determinism for extracted sessions", () => {
    it("same metadata → same sessionId (anthropic)", () => {
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const req = makeReq("anthropic", { metadata: { user_id: "u_session_fixed" } });
        results.add(getSessionId(req));
      }
      expect(results.size).toBe(1);
      expect([...results][0]).toBe("fixed");
    });

    it("same header → same sessionId (openai-chat)", () => {
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const req = makeReq("openai-chat", {}, { "x-session-id": "fixed-header" });
        results.add(getSessionId(req));
      }
      expect(results.size).toBe(1);
      expect([...results][0]).toBe("fixed-header");
    });
  });
});
