import { describe, it, expect, vi, beforeEach } from "vitest";
import { router, RouterScenarioType } from "../utils/router";
import { ConfigService } from "../services/config";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeConfigService(routerConfig: any = {}, extra: Record<string, any> = {}): any {
  const store: Record<string, any> = {
    Router: routerConfig,
    providers: [],
    REWRITE_SYSTEM_PROMPT: undefined,
    CUSTOM_ROUTER_PATH: undefined,
    ...extra,
  };
  return {
    get: (key: string) => store[key],
    getAll: () => store,
  };
}

function makeContext(configService?: any, tokenizerService?: any) {
  return {
    configService: configService || makeConfigService(),
    tokenizerService: tokenizerService || null,
  };
}

function makeAnthropicReq(overrides: Record<string, any> = {}): any {
  const body: Record<string, any> = {
    model: "claude-sonnet-4-20250514",
    system: [
      { type: "text", text: "You are a helpful assistant." },
      { type: "text", text: "" },
    ],
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    metadata: { user_id: "user_session_abc123" },
    stream: true,
    ...overrides,
  };
  return {
    apiProtocol: "anthropic",
    body,
    headers: {},
    log: { info: vi.fn(), error: vi.fn() },
    _agrSessionId: undefined,
    sessionId: undefined,
    ...overrides._reqOverrides,
  };
}

function makeOpenAIChatReq(overrides: Record<string, any> = {}): any {
  const body: Record<string, any> = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ],
    tools: [],
    stream: true,
    ...overrides,
  };
  return {
    apiProtocol: "openai-chat",
    body,
    headers: { "x-session-id": "chat-session-123" },
    log: { info: vi.fn(), error: vi.fn() },
    _agrSessionId: undefined,
    sessionId: undefined,
    ...overrides._reqOverrides,
  };
}

function makeOpenAIResponsesReq(overrides: Record<string, any> = {}): any {
  const body: Record<string, any> = {
    model: "gpt-4o",
    instructions: "You are a helpful assistant.",
    input: [{ role: "user", content: "Hello" }],
    tools: [],
    stream: true,
    ...overrides,
  };
  return {
    apiProtocol: "openai-responses",
    body,
    headers: { "x-session-id": "resp-session-123" },
    log: { info: vi.fn(), error: vi.fn() },
    _agrSessionId: undefined,
    sessionId: undefined,
    ...overrides._reqOverrides,
  };
}

function makePassthroughReq(): any {
  return {
    apiProtocol: "passthrough",
    body: { model: "some-model" },
    headers: {},
    log: { info: vi.fn(), error: vi.fn() },
  };
}

// ── Passthrough protocol ────────────────────────────────────────────────

describe("router — passthrough protocol", () => {
  it("should not modify body for passthrough requests", async () => {
    const req = makePassthroughReq();
    const originalModel = req.body.model;
    const context = makeContext(makeConfigService({ default: "provider,model" }));

    await router(req, {}, context);

    expect(req.body.model).toBe(originalModel);
    expect(req.scenarioType).toBeUndefined();
  });

  it("should not set scenarioType for passthrough requests", async () => {
    const req = makePassthroughReq();
    const context = makeContext(makeConfigService({ default: "provider,model" }));

    await router(req, {}, context);

    expect(req.scenarioType).toBeUndefined();
  });
});

// ── Default routing across protocols ────────────────────────────────────

describe("router — default routing", () => {
  const routerConfig = { default: "myprovider,my-model" };

  it("anthropic: routes to default model", async () => {
    const req = makeAnthropicReq();
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("myprovider,my-model");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-chat: routes to default model", async () => {
    const req = makeOpenAIChatReq();
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("myprovider,my-model");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-responses: routes to default model", async () => {
    const req = makeOpenAIResponsesReq();
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("myprovider,my-model");
    expect(req.scenarioType).toBe("default");
  });
});

// ── Already-resolved <provider>,<model> passthrough ─────────────────────

describe("router — already-resolved model", () => {
  it("anthropic: preserves <provider>,<model> format", async () => {
    const req = makeAnthropicReq({ model: "existing,provider-model" });
    const context = makeContext(makeConfigService({ default: "other,model" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("existing,provider-model");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-chat: preserves <provider>,<model> format", async () => {
    const req = makeOpenAIChatReq({ model: "existing,provider-model" });
    const context = makeContext(makeConfigService({ default: "other,model" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("existing,provider-model");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-responses: preserves <provider>,<model> format", async () => {
    const req = makeOpenAIResponsesReq({ model: "existing,provider-model" });
    const context = makeContext(makeConfigService({ default: "other,model" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("existing,provider-model");
    expect(req.scenarioType).toBe("default");
  });
});

// ── Long context routing across protocols ───────────────────────────────

describe("router — longContext scenario", () => {
  const routerConfig = { default: "p,default-m", longContext: "p,long-m", longContextThreshold: 10 };

  it("anthropic: routes to longContext when token count exceeds threshold", async () => {
    // Use a large body to ensure token count > 10
    const longContent = "x".repeat(1000);
    const req = makeAnthropicReq({
      messages: [{ role: "user", content: longContent }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,long-m");
    expect(req.scenarioType).toBe("longContext");
  });

  it("openai-chat: routes to longContext when token count exceeds threshold", async () => {
    const longContent = "x".repeat(1000);
    const req = makeOpenAIChatReq({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: longContent },
      ],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,long-m");
    expect(req.scenarioType).toBe("longContext");
  });

  it("openai-responses: routes to longContext when token count exceeds threshold", async () => {
    const longContent = "x".repeat(1000);
    const req = makeOpenAIResponsesReq({
      instructions: "sys",
      input: [{ role: "user", content: longContent }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,long-m");
    expect(req.scenarioType).toBe("longContext");
  });
});

// ── Think routing across protocols ──────────────────────────────────────

describe("router — think scenario", () => {
  const routerConfig = { default: "p,default-m", think: "p,think-m" };

  it("anthropic: routes to think when thinking is set", async () => {
    const req = makeAnthropicReq({ thinking: { type: "enabled", budget_tokens: 10000 } });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,think-m");
    expect(req.scenarioType).toBe("think");
  });

  it("openai-chat: routes to think when reasoning_effort is set", async () => {
    const req = makeOpenAIChatReq({ reasoning_effort: "high" });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,think-m");
    expect(req.scenarioType).toBe("think");
  });

  it("openai-responses: routes to think when reasoning.effort is set", async () => {
    const req = makeOpenAIResponsesReq({ reasoning: { effort: "high" } });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,think-m");
    expect(req.scenarioType).toBe("think");
  });
});

// ── WebSearch routing across protocols ──────────────────────────────────

describe("router — webSearch scenario", () => {
  const routerConfig = { default: "p,default-m", webSearch: "p,web-m" };

  it("anthropic: routes to webSearch when tool type is web_search", async () => {
    const req = makeAnthropicReq({
      tools: [{ type: "web_search", name: "web_search" }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });

  it("anthropic: routes to webSearch when tool type is web_search_preview", async () => {
    const req = makeAnthropicReq({
      tools: [{ type: "web_search_preview", name: "web_search" }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });

  it("openai-chat: routes to webSearch when tool type is web_search", async () => {
    const req = makeOpenAIChatReq({
      tools: [{ type: "web_search", name: "web_search" }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });

  it("openai-chat: routes to webSearch when tool type is web_search_preview", async () => {
    const req = makeOpenAIChatReq({
      tools: [{ type: "web_search_preview", name: "web_search" }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });

  it("openai-responses: routes to webSearch when tool type is web_search", async () => {
    const req = makeOpenAIResponsesReq({
      tools: [{ type: "web_search", name: "web_search" }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });

  it("openai-responses: routes to webSearch when tool type is web_search_preview", async () => {
    const req = makeOpenAIResponsesReq({
      tools: [{ type: "web_search_preview", name: "web_search" }],
    });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });
});

// ── Background (Haiku) — anthropic only ─────────────────────────────────

describe("router — background scenario (anthropic only)", () => {
  const routerConfig = { default: "p,default-m", background: "p,bg-m" };

  it("anthropic: routes haiku models to background", async () => {
    const req = makeAnthropicReq({ model: "claude-haiku-4-20250514" });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,bg-m");
    expect(req.scenarioType).toBe("background");
  });

  it("openai-chat: does NOT route haiku-named models to background", async () => {
    const req = makeOpenAIChatReq({ model: "claude-haiku-4-20250514" });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    // Should fall through to default, not background
    expect(req.body.model).toBe("p,default-m");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-responses: does NOT route haiku-named models to background", async () => {
    const req = makeOpenAIResponsesReq({ model: "claude-haiku-4-20250514" });
    const context = makeContext(makeConfigService(routerConfig));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,default-m");
    expect(req.scenarioType).toBe("default");
  });
});

// ── Subagent model tag extraction ───────────────────────────────────────

describe("router — AGR-SUBAGENT-MODEL tag extraction", () => {
  it("anthropic: extracts tag from system[1].text and removes it", async () => {
    const req = makeAnthropicReq({
      model: "claude-sonnet-4-20250514",
      system: [
        { type: "text", text: "Main system prompt" },
        { type: "text", text: "<AGR-SUBAGENT-MODEL>my-provider,my-model</AGR-SUBAGENT-MODEL>Extra text" },
      ],
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("my-provider,my-model");
    expect(req.body.system[1].text).toBe("Extra text");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-chat: extracts tag from system message and removes it", async () => {
    const req = makeOpenAIChatReq({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "<AGR-SUBAGENT-MODEL>my-provider,my-model</AGR-SUBAGENT-MODEL>System instructions" },
        { role: "user", content: "Hello" },
      ],
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("my-provider,my-model");
    expect(req.body.messages[0].content).toBe("System instructions");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-responses: extracts tag from instructions and removes it", async () => {
    const req = makeOpenAIResponsesReq({
      model: "gpt-4o",
      instructions: "<AGR-SUBAGENT-MODEL>my-provider,my-model</AGR-SUBAGENT-MODEL>System instructions",
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("my-provider,my-model");
    expect(req.body.instructions).toBe("System instructions");
    expect(req.scenarioType).toBe("default");
  });

  it("openai-responses: extracts tag from input system role", async () => {
    const req = makeOpenAIResponsesReq({
      model: "gpt-4o",
      instructions: "Main instructions",
      input: [
        { role: "system", content: "<AGR-SUBAGENT-MODEL>my-provider,my-model</AGR-SUBAGENT-MODEL>System hint" },
        { role: "user", content: "Hello" },
      ],
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("my-provider,my-model");
    expect(req.body.input[0].content).toBe("System hint");
  });

  it("does NOT recognize old CCR-SUBAGENT-MODEL tag (anthropic)", async () => {
    const req = makeAnthropicReq({
      model: "claude-sonnet-4-20250514",
      system: [
        { type: "text", text: "Main system prompt" },
        { type: "text", text: "<CCR-SUBAGENT-MODEL>my-provider,my-model</CCR-SUBAGENT-MODEL>" },
      ],
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    // Old tag should NOT be extracted; should fall through to default
    expect(req.body.model).toBe("p,default-m");
    // Old tag should NOT be removed from the text
    expect(req.body.system[1].text).toContain("<CCR-SUBAGENT-MODEL>");
  });

  it("does NOT recognize old CCR-SUBAGENT-MODEL tag (openai-chat)", async () => {
    const req = makeOpenAIChatReq({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "<CCR-SUBAGENT-MODEL>my-provider,my-model</CCR-SUBAGENT-MODEL>" },
        { role: "user", content: "Hello" },
      ],
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,default-m");
    expect(req.body.messages[0].content).toContain("<CCR-SUBAGENT-MODEL>");
  });

  it("does NOT recognize old CCR-SUBAGENT-MODEL tag (openai-responses instructions)", async () => {
    const req = makeOpenAIResponsesReq({
      model: "gpt-4o",
      instructions: "<CCR-SUBAGENT-MODEL>my-provider,my-model</CCR-SUBAGENT-MODEL>",
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,default-m");
    expect(req.body.instructions).toContain("<CCR-SUBAGENT-MODEL>");
  });

  it("does NOT recognize old CCR-SUBAGENT-MODEL tag (openai-responses input system)", async () => {
    const req = makeOpenAIResponsesReq({
      model: "gpt-4o",
      instructions: "Main instructions",
      input: [
        { role: "system", content: "<CCR-SUBAGENT-MODEL>my-provider,my-model</CCR-SUBAGENT-MODEL>" },
        { role: "user", content: "Hello" },
      ],
    });
    const context = makeContext(makeConfigService({ default: "p,default-m" }));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,default-m");
    expect(req.body.input[0].content).toContain("<CCR-SUBAGENT-MODEL>");
  });
});

// ── Subagent tag round-trip property tests ──────────────────────────────

describe("router — AGR-SUBAGENT-MODEL round-trip properties", () => {
  // R7-9: For all system prompts containing exactly one tag
  // <AGR-SUBAGENT-MODEL>m</AGR-SUBAGENT-MODEL> where m contains no '<',
  // after extraction the new system prompt shall not contain the tag substring,
  // and the returned model equals m.

  const models = [
    "provider,model",
    "openai,gpt-4o",
    "anthropic,claude-opus-4-20250514",
    "my-provider,my-model",
    "a,b",
    "deepseek,deepseek-r1",
  ];

  describe("anthropic round-trip", () => {
    for (const m of models) {
      it(`model="${m}" — tag removed, model extracted`, async () => {
        const prefix = "Some prefix text ";
        const suffix = " some suffix";
        const tagText = `<AGR-SUBAGENT-MODEL>${m}</AGR-SUBAGENT-MODEL>`;
        const fullText = `${prefix}${tagText}${suffix}`;

        const req = makeAnthropicReq({
          model: "claude-sonnet-4-20250514",
          system: [
            { type: "text", text: "Main prompt" },
            { type: "text", text: fullText },
          ],
        });
        const context = makeContext(makeConfigService({ default: "p,default-m" }));

        await router(req, {}, context);

        expect(req.body.model).toBe(m);
        expect(req.body.system[1].text).not.toContain("<AGR-SUBAGENT-MODEL>");
        expect(req.body.system[1].text).toBe(`${prefix}${suffix}`);
      });
    }
  });

  describe("openai-chat round-trip", () => {
    for (const m of models) {
      it(`model="${m}" — tag removed, model extracted`, async () => {
        const prefix = "System prefix ";
        const suffix = " system suffix";
        const tagText = `<AGR-SUBAGENT-MODEL>${m}</AGR-SUBAGENT-MODEL>`;
        const fullContent = `${prefix}${tagText}${suffix}`;

        const req = makeOpenAIChatReq({
          model: "gpt-4o",
          messages: [
            { role: "system", content: fullContent },
            { role: "user", content: "Hello" },
          ],
        });
        const context = makeContext(makeConfigService({ default: "p,default-m" }));

        await router(req, {}, context);

        expect(req.body.model).toBe(m);
        expect(req.body.messages[0].content).not.toContain("<AGR-SUBAGENT-MODEL>");
        expect(req.body.messages[0].content).toBe(`${prefix}${suffix}`);
      });
    }
  });

  describe("openai-responses instructions round-trip", () => {
    for (const m of models) {
      it(`model="${m}" — tag removed from instructions, model extracted`, async () => {
        const prefix = "Instructions prefix ";
        const suffix = " instructions suffix";
        const tagText = `<AGR-SUBAGENT-MODEL>${m}</AGR-SUBAGENT-MODEL>`;
        const fullInstructions = `${prefix}${tagText}${suffix}`;

        const req = makeOpenAIResponsesReq({
          model: "gpt-4o",
          instructions: fullInstructions,
        });
        const context = makeContext(makeConfigService({ default: "p,default-m" }));

        await router(req, {}, context);

        expect(req.body.model).toBe(m);
        expect(req.body.instructions).not.toContain("<AGR-SUBAGENT-MODEL>");
        expect(req.body.instructions).toBe(`${prefix}${suffix}`);
      });
    }
  });

  describe("openai-responses input system round-trip", () => {
    for (const m of models) {
      it(`model="${m}" — tag removed from input system, model extracted`, async () => {
        const prefix = "System hint prefix ";
        const suffix = " system hint suffix";
        const tagText = `<AGR-SUBAGENT-MODEL>${m}</AGR-SUBAGENT-MODEL>`;
        const fullContent = `${prefix}${tagText}${suffix}`;

        const req = makeOpenAIResponsesReq({
          model: "gpt-4o",
          instructions: "Main instructions",
          input: [
            { role: "system", content: fullContent },
            { role: "user", content: "Hello" },
          ],
        });
        const context = makeContext(makeConfigService({ default: "p,default-m" }));

        await router(req, {}, context);

        expect(req.body.model).toBe(m);
        expect(req.body.input[0].content).not.toContain("<AGR-SUBAGENT-MODEL>");
        expect(req.body.input[0].content).toBe(`${prefix}${suffix}`);
      });
    }
  });

  describe("only first match is removed (ascending index)", () => {
    it("anthropic: only first occurrence in system is extracted", async () => {
      const req = makeAnthropicReq({
        model: "claude-sonnet-4-20250514",
        system: [
          { type: "text", text: "<AGR-SUBAGENT-MODEL>first,match</AGR-SUBAGENT-MODEL>Text1" },
          { type: "text", text: "<AGR-SUBAGENT-MODEL>second,match</AGR-SUBAGENT-MODEL>Text2" },
        ],
      });
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      // First match should be extracted
      expect(req.body.model).toBe("first,match");
      // First element should have tag removed
      expect(req.body.system[0].text).not.toContain("<AGR-SUBAGENT-MODEL>");
      expect(req.body.system[0].text).toBe("Text1");
      // Second element should still contain its tag
      expect(req.body.system[1].text).toContain("<AGR-SUBAGENT-MODEL>");
    });

    it("openai-chat: only first system message with tag is extracted", async () => {
      const req = makeOpenAIChatReq({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "<AGR-SUBAGENT-MODEL>first,match</AGR-SUBAGENT-MODEL>Sys1" },
          { role: "system", content: "<AGR-SUBAGENT-MODEL>second,match</AGR-SUBAGENT-MODEL>Sys2" },
          { role: "user", content: "Hello" },
        ],
      });
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("first,match");
      expect(req.body.messages[0].content).not.toContain("<AGR-SUBAGENT-MODEL>");
      expect(req.body.messages[1].content).toContain("<AGR-SUBAGENT-MODEL>");
    });

    it("openai-responses: instructions takes priority over input system", async () => {
      const req = makeOpenAIResponsesReq({
        model: "gpt-4o",
        instructions: "<AGR-SUBAGENT-MODEL>from-instructions,model</AGR-SUBAGENT-MODEL>Instructions",
        input: [
          { role: "system", content: "<AGR-SUBAGENT-MODEL>from-input,model</AGR-SUBAGENT-MODEL>Hint" },
          { role: "user", content: "Hello" },
        ],
      });
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("from-instructions,model");
      expect(req.body.instructions).not.toContain("<AGR-SUBAGENT-MODEL>");
      // Input system tag should still be present (not removed since instructions was first)
      expect(req.body.input[0].content).toContain("<AGR-SUBAGENT-MODEL>");
    });
  });

  describe("no tag present — no side effects", () => {
    it("anthropic: body unchanged when no AGR tag", async () => {
      const req = makeAnthropicReq({
        model: "claude-sonnet-4-20250514",
        system: [
          { type: "text", text: "Main prompt" },
          { type: "text", text: "No subagent tag here" },
        ],
      });
      const originalSystem1 = req.body.system[1].text;
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("p,default-m");
      expect(req.body.system[1].text).toBe(originalSystem1);
    });

    it("openai-chat: body unchanged when no AGR tag", async () => {
      const req = makeOpenAIChatReq({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "No subagent tag here" },
          { role: "user", content: "Hello" },
        ],
      });
      const originalContent = req.body.messages[0].content;
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("p,default-m");
      expect(req.body.messages[0].content).toBe(originalContent);
    });

    it("openai-responses: body unchanged when no AGR tag", async () => {
      const req = makeOpenAIResponsesReq({
        model: "gpt-4o",
        instructions: "No subagent tag here",
      });
      const originalInstructions = req.body.instructions;
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("p,default-m");
      expect(req.body.instructions).toBe(originalInstructions);
    });
  });

  describe("old CCR tag is preserved alongside new AGR tag", () => {
    it("anthropic: AGR tag extracted, CCR tag preserved in text", async () => {
      const req = makeAnthropicReq({
        model: "claude-sonnet-4-20250514",
        system: [
          { type: "text", text: "Main prompt" },
          { type: "text", text: "<CCR-SUBAGENT-MODEL>old,model</CCR-SUBAGENT-MODEL><AGR-SUBAGENT-MODEL>new,model</AGR-SUBAGENT-MODEL>Remaining" },
        ],
      });
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("new,model");
      expect(req.body.system[1].text).toContain("<CCR-SUBAGENT-MODEL>");
      expect(req.body.system[1].text).not.toContain("<AGR-SUBAGENT-MODEL>");
    });

    it("openai-chat: AGR tag extracted, CCR tag preserved", async () => {
      const req = makeOpenAIChatReq({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "<CCR-SUBAGENT-MODEL>old,model</CCR-SUBAGENT-MODEL><AGR-SUBAGENT-MODEL>new,model</AGR-SUBAGENT-MODEL>Remaining" },
          { role: "user", content: "Hello" },
        ],
      });
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("new,model");
      expect(req.body.messages[0].content).toContain("<CCR-SUBAGENT-MODEL>");
      expect(req.body.messages[0].content).not.toContain("<AGR-SUBAGENT-MODEL>");
    });

    it("openai-responses: AGR tag extracted, CCR tag preserved", async () => {
      const req = makeOpenAIResponsesReq({
        model: "gpt-4o",
        instructions: "<CCR-SUBAGENT-MODEL>old,model</CCR-SUBAGENT-MODEL><AGR-SUBAGENT-MODEL>new,model</AGR-SUBAGENT-MODEL>Remaining",
      });
      const context = makeContext(makeConfigService({ default: "p,default-m" }));

      await router(req, {}, context);

      expect(req.body.model).toBe("new,model");
      expect(req.body.instructions).toContain("<CCR-SUBAGENT-MODEL>");
      expect(req.body.instructions).not.toContain("<AGR-SUBAGENT-MODEL>");
    });
  });
});

// ── No router config ────────────────────────────────────────────────────

describe("router — missing config", () => {
  it("anthropic: with no Router config, model becomes undefined", async () => {
    const req = makeAnthropicReq();
    const context = makeContext(makeConfigService({}));

    await router(req, {}, context);

    expect(req.body.model).toBeUndefined();
    expect(req.scenarioType).toBe("default");
  });

  it("openai-chat: with no Router config, model becomes undefined", async () => {
    const req = makeOpenAIChatReq();
    const context = makeContext(makeConfigService({}));

    await router(req, {}, context);

    expect(req.body.model).toBeUndefined();
    expect(req.scenarioType).toBe("default");
  });
});

// ── Scenario priority ──────────────────────────────────────────────────

describe("router — scenario priority", () => {
  it("longContext takes priority over think", async () => {
    const longContent = "x".repeat(1000);
    const req = makeAnthropicReq({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: longContent }],
      thinking: { type: "enabled", budget_tokens: 10000 },
    });
    const context = makeContext(makeConfigService({
      default: "p,default-m",
      longContext: "p,long-m",
      think: "p,think-m",
      longContextThreshold: 10,
    }));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,long-m");
    expect(req.scenarioType).toBe("longContext");
  });

  it("webSearch takes priority over think", async () => {
    const req = makeAnthropicReq({
      model: "claude-sonnet-4-20250514",
      thinking: { type: "enabled", budget_tokens: 10000 },
      tools: [{ type: "web_search", name: "web_search" }],
    });
    const context = makeContext(makeConfigService({
      default: "p,default-m",
      webSearch: "p,web-m",
      think: "p,think-m",
    }));

    await router(req, {}, context);

    expect(req.body.model).toBe("p,web-m");
    expect(req.scenarioType).toBe("webSearch");
  });
});
