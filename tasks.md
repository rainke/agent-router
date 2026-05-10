# Agent Router Implementation Tasks

> 使用方式: 每轮 AI 任务优先选择最靠前的未完成项。完成代码、测试和必要文档验证后，将对应 `[ ]` 改为 `[x]`，并在提交说明中注明覆盖的 Requirement 编号。

## 0. Baseline and Guardrails

- [x] 0.1 建立当前行为基线
  - Scope: 记录现有 `ccr` CLI、`/v1/messages` Anthropic 请求、preset、usage cache、agent tool stream 的关键行为。
  - Files: `packages/cli/src/**`, `packages/core/src/**`, `packages/server/src/**`, `packages/shared/src/**`.
  - Verify: 能运行现有 build/test；列出当前失败项或缺失测试，不修复无关问题。
  - Covers: R17.
  - Baseline:
    - CLI: root bin and `packages/cli` expose `ccr`; help usage is `ccr [command] [preset-name]`; version output is `claude-code-router version: <version>`; `code` auto-starts the service, injects Anthropic env from `createEnvVariables()`, writes a Claude `--settings` temp file, increments/decrements the reference count, and calls `closeService()` when the child exits.
    - Runtime paths: shared constants use `~/.claude-code-router` for config/plugins/presets/logs and `.claude-code-router.pid`; reference count is `<tmp>/claude-code-reference-count.txt`; Claude settings temp files are under `<tmp>/claude-code-router/ccr-settings-<hash>.json`.
    - Server/API: router hooks, model/provider splitting, preset extraction, agent detection, agent tool stream interception, and streaming usage cache updates are all gated by pathname suffix `/v1/messages`; OpenAI chat/responses paths are not included in these hooks.
    - Presets: namespaces are registered as `/preset/<name>` from installed preset manifests; request preset extraction removes `/v1/messages` from the pathname and does not validate the preset name at request time.
    - Router: session ID comes from Anthropic `metadata.user_id` split on `_session_`; subagent tag is `<CCR-SUBAGENT-MODEL>` in `req.body.system[1].text`; Claude Haiku/background detection is not protocol-gated because only `/v1/messages` currently reaches router.
    - Usage cache: non-stream payloads write `payload.usage`; stream payloads tee Anthropic SSE and parse `event: message_delta` usage; no OpenAI stream usage parser exists.
    - Agent stream: image agent only inspects Anthropic message content, prepends Anthropic tool definitions, intercepts Anthropic `content_block_start` / `input_json_delta` / `content_block_stop`, and replays an internal `/v1/messages` request after tool results are collected.
    - Verification: `pnpm build` first failed in non-TTY mode because pnpm wanted to purge `node_modules`; `CI=true pnpm build` needed network to restore dependencies, then failed at `packages/ui/src/components/ui/command.tsx:53` with TS2322 (`ReactNode` includes `bigint`, not assignable to `cmdk` children type). No repository `test` script or existing `*.test.*` / `*.spec.*` files were found.

- [ ] 0.2 新增可重复运行的迁移检查脚本
  - Scope: 添加脚本检查源码与 package 字段中未解析的 `@CCR/*`、旧命令入口、旧路径常量等。
  - Files: root `package.json`, package scripts, optional `scripts/**`.
  - Verify: `pnpm build` 中接入必要检查；失败时 stderr 输出引用位置。
  - Covers: R1-6, R1-7.

## 1. Package, Workspace, and CLI Rename

- [ ] 1.1 重命名根包、bin 和 workspace scope
  - Scope: 根包名改为 `@musistudio/agent-router`，bin 仅保留 `agr`; 子包 `@CCR/*` 改为 `@agr/*`; 更新所有 workspace 内部依赖。
  - Files: `package.json`, `packages/*/package.json`, TypeScript imports, build config.
  - Verify: `rg "@CCR/" packages package.json` 返回 0；`pnpm build` 通过。
  - Covers: R1-1, R1-2, R1-3, R1-6.

- [ ] 1.2 更新 CLI help/version 输出与命令入口
  - Scope: CLI usage 显示 `agr [command] [preset-name]`; version 首行显示 `agent-router version:`; 保留既有子命令集合。
  - Files: `packages/cli/src/cli.ts`, CLI utils.
  - Verify: `agr -h`, `agr help`, `agr -v`, `agr version` 输出和退出码符合要求。
  - Covers: R1-4, R1-5, R17-5.

- [ ] 1.3 保持 `agr code` 与旧 `ccr code` 语义等价
  - Scope: Claude 可执行文件启动、settings 临时文件、引用计数、服务清理逻辑迁移到 `agr` 命名。
  - Files: `packages/cli/src/utils/codeCommand.ts`, `packages/cli/src/utils/statusline.ts`, process utils.
  - Verify: `agr code [args...]` 使用 Anthropic env 与 settings 文件，子进程退出后执行清理。
  - Covers: R17-6.

## 2. Runtime Paths, Init, Logging, and No Legacy Migration

- [ ] 2.1 统一 Home_Dir 与运行态路径
  - Scope: `HOME_DIR` 改为 `~/.agent-router`; `CONFIG_FILE`, `PID_FILE`, presets, plugins, logs 都从 `HOME_DIR` 派生；引用计数文件改为 tmp 下 `agent-router-reference-count.txt`。
  - Files: `packages/shared/src/constants.ts`, CLI/server path consumers.
  - Verify: 不存在硬编码 `~/.claude-code-router` 运行时读取路径；路径单测通过。
  - Covers: R2-1, R2-2, R2-3, R2-4, R3-1.

- [ ] 2.2 更新目录初始化与默认配置写入
  - Scope: `initDir()` 创建 `~/.agent-router`, `plugins`, `presets`, `logs`; 缺失配置写入最小默认配置 `{ PORT: 3456, Providers: [], Router: {} }`; I/O 失败非零退出并输出错误。
  - Files: shared/config init code, CLI/server startup paths.
  - Verify: 使用临时 HOME 覆盖成功/失败路径；不会读取或拷贝旧目录。
  - Covers: R3-2, R3-3, R3-4, R3-5.

- [ ] 2.3 更新日志和临时 settings 文件路径
  - Scope: server rolling log 写到 `~/.agent-router/logs/agr-YYYYMMDD-HHmmss.log`; 创建失败 3 秒内 stderr + 非零退出；Claude settings 临时文件写入 `<tmp>/agent-router/agr-settings-<hash>.json`。
  - Files: `packages/server/src/**`, `packages/cli/src/utils/**`.
  - Verify: 日志文件名格式测试；tmp settings hash 长度与字符集测试；目录不存在时递归创建。
  - Covers: R2-5, R2-6, R2-7, R2-8.

## 3. Preset and Schema Rename

- [ ] 3.1 将 preset schema 从 `ccrVersion` 迁移到 `agrVersion`
  - Scope: export/install/read/schema validation/UI 统一写入 `agrVersion`; 取根版本号；不再写 `ccrVersion`。
  - Files: `packages/shared/src/preset/**`, `packages/cli/src/utils/preset/**`, `packages/ui/src/**`.
  - Verify: 导出的 manifest 只有 `agrVersion`; `ccrVersion` 出现次数在 preset 源码中只允许出现在拒绝旧 schema 的错误处理。
  - Covers: R4-2.

- [ ] 3.2 拒绝仅含旧 schema 的 preset
  - Scope: 读取 preset 时如果只有 `ccrVersion` 且无 `agrVersion`，拒绝应用，不修改配置；UI 显示错误横幅，HTTP 返回 4xx 和迁移提示。
  - Files: shared preset validation, server config API, UI preset flow.
  - Verify: CLI/server/UI 测试覆盖旧 manifest 拒绝路径。
  - Covers: R4-3.

- [ ] 3.3 实现三协议 preset 命名空间解析
  - Scope: 识别 `/preset/<name>/v1/messages`, `/preset/<name>/v1/chat/completions`, `/preset/<name>/v1/responses`; preset 名仅允许 `[a-zA-Z0-9_-]` 长度 1-64；非法名称不访问文件系统。
  - Files: `packages/core/src/server.ts`, `packages/core/src/api/routes.ts`, namespace registration.
  - Verify: 合法三路径进入同一 preset namespace；非法名称 404；不存在 preset 404 且提示 `preset not found`。
  - Covers: R8.

## 4. Protocol Detection and Request Normalization

- [ ] 4.1 新增 `API_Protocol` 类型和请求装饰器
  - Scope: 为 Fastify request 增加 `req.apiProtocol`; 在 `preHandler` 且早于 router 前完成检测，生命周期内不修改。
  - Files: `packages/server/src/types.d.ts`, `packages/core/src/**` type declarations and hooks.
  - Verify: 三种 API 路径和 passthrough 路径都能观察到正确协议。
  - Covers: R5-1, R5-8.

- [ ] 4.2 实现纯函数 `detectApiProtocol(pathname)`
  - Scope: 匹配 `/v1/messages`, `/v1/chat/completions`, `/v1/responses` 及尾斜杠；Responses 不匹配严格子路径；优先级 anthropic -> chat -> responses；异常输入返回 passthrough。
  - Files: new utility under `packages/core/src/utils/**` or shared utility if needed.
  - Verify: 表驱动测试 + 属性测试覆盖 0-8192 字符、确定性和四选一输出。
  - Covers: R5-2, R5-3, R5-4, R5-5, R5-6, R5-7, R5-9, R18-1.

- [ ] 4.3 实现 `normalizeRequestBody(req)`
  - Scope: 统一提取 `sessionId`, `system`, `thinking`, `tools`, `hasWebSearch`, `protocol`; 对畸形 body 和未知协议不抛错。
  - Files: new normalizer utility, associated types.
  - Verify: 三协议表驱动测试；属性测试覆盖幂等和畸形输入不抛异常。
  - Covers: R6, R18-2.

- [ ] 4.4 实现协议感知 Session_Manager
  - Scope: Anthropic 保留 metadata `_session_` 逻辑；OpenAI Chat/Responses 使用 `X-Session-Id`，缺失时生成 UUID v4 并回写响应头；同请求幂等；UUID 失败有回退。
  - Files: session utility/hook, router integration.
  - Verify: 单测和属性测试覆盖三协议、全域性、幂等性、响应头回写。
  - Covers: R15, R18-5.

## 5. Router Protocol Generalization

- [ ] 5.1 将 router 改为基于 normalizer 的协议无关逻辑
  - Scope: 对 anthropic/openai-chat/openai-responses 同步 await router；passthrough 不修改 body 和 scenario；已有 `<provider>,<model>` 原样保留。
  - Files: `packages/core/src/utils/router.ts`, namespace preHandler.
  - Verify: 三协议均可完成 default/think/longContext/webSearch 路由；passthrough 不产生副作用。
  - Covers: R7-1, R7-2, R7-3, R7-8, R16-3, R16-4.

- [ ] 5.2 替换 Subagent 模型标签为 `<AGR-SUBAGENT-MODEL>`
  - Scope: 三协议系统提示词中提取新标签并原子移除首个匹配；旧 `<CCR-SUBAGENT-MODEL>` 不识别、不移除。
  - Files: router utility and tests.
  - Verify: Anthropic/Chat/Responses 往返属性测试；旧标签保留测试。
  - Covers: R7-4, R7-5, R7-6, R7-9, R18-3, R17-3.

- [ ] 5.3 为 Anthropic 专属启发式加协议门控
  - Scope: Claude Haiku/background 自动降级仅在 `req.apiProtocol === 'anthropic'` 运行；webSearch 支持 `web_search` 和 `web_search_preview`。
  - Files: `packages/core/src/utils/router.ts`.
  - Verify: OpenAI 模型名含 haiku 不触发 background；三协议 webSearch 场景测试通过。
  - Covers: R7-7, R16-1, R16-2.

## 6. Multi-Client CLI Support

- [ ] 6.1 泛化 `createEnvVariables(clientType)`
  - Scope: 支持 `claude`, `codex`, `opencode`; Claude 输出 Anthropic env；Codex 输出 OpenAI env 且 base URL 以 `/v1` 结尾；OpenCode 同时输出两组；保留通用变量；非法类型抛错。
  - Files: `packages/cli/src/utils/createEnvVariables.ts`, CLI tests.
  - Verify: 属性测试覆盖幂等和非法输入；快照测试覆盖三种 clientType。
  - Covers: R11, R18-4.

- [ ] 6.2 新增 `agr codex [args...]`
  - Scope: 加入 `KNOWN_COMMANDS`; 自动启动 server; 使用 `CODEX_PATH` 优先级 `config` > env > `codex`; 注入 codex env；不传 `--settings`，不写 statusLine 临时配置；退出后清理引用计数和服务。
  - Files: `packages/cli/src/cli.ts`, new or existing command utility.
  - Verify: spawn mock 测试覆盖 env、path 优先级、server 超时、清理逻辑。
  - Covers: R12.

- [ ] 6.3 新增 `agr opencode [args...]`
  - Scope: 加入 `KNOWN_COMMANDS`; 自动启动 server; `OPENCODE_PATH` 优先级 `config` > env > `opencode`; 注入 opencode env；ENOENT/spawn 失败输出安装提示并非零退出。
  - Files: `packages/cli/src/cli.ts`, command utility.
  - Verify: spawn mock 测试覆盖 env、path 优先级、server 启动、ENOENT 错误。
  - Covers: R13.

- [ ] 6.4 扩展 `agr activate` / `agr env`
  - Scope: `activate` 默认 claude；支持 `activate claude|codex|opencode`; unknown 输出帮助并非零退出；`env` 作为完全一致的别名。
  - Files: `packages/cli/src/utils/activateCommand.ts`, CLI parser.
  - Verify: 输出 export/unset 语句符合三种 clientType；`agr env codex` 与 `agr activate codex` 一致。
  - Covers: R14.

## 7. Stream Interceptors and Agent Tool Flow

- [ ] 7.1 定义 `Stream_Interceptor` 抽象接口
  - Scope: 定义 `onToolCallStart`, `onToolCallArgsDelta`, `onToolCallEnd`, `onMessageDelta`; 统一 toolCallId 非空校验和参数累积模型。
  - Files: `packages/core/src/utils/sse/**`, agent stream modules.
  - Verify: 类型测试或单测覆盖回调调用契约。
  - Covers: R9-1.

- [ ] 7.2 实现 Anthropic stream interceptor 适配
  - Scope: 将现有 Anthropic SSE tool_use 拦截迁移到新接口，保持外部行为等价。
  - Files: `packages/core/src/utils/sse/**`, agent hook code.
  - Verify: 现有 Anthropic agent 工具流测试继续通过。
  - Covers: R9-2, R17-3.

- [ ] 7.3 实现 OpenAI Chat stream interceptor
  - Scope: 处理 `choices[0].delta.tool_calls[]`, 按 index 累积 arguments，`finish_reason === 'tool_calls'` 触发结束；JSON parse 失败走协议错误事件。
  - Files: stream interceptor modules.
  - Verify: 多分片、多 tool call、parse error、premature close 测试。
  - Covers: R9-3, R9-8, R9-9, R9-11.

- [ ] 7.4 实现 OpenAI Responses stream interceptor
  - Scope: 处理 `response.output_item.added`, `response.function_call_arguments.delta`, `response.output_item.done`, `response.output_text.delta`; 错误事件按 Responses 协议输出。
  - Files: stream interceptor modules.
  - Verify: function_call 生命周期、多分片、parse error、premature close 测试。
  - Covers: R9-4, R9-8, R9-9, R9-11.

- [ ] 7.5 在 `onSend` 中按协议注入 stream interceptor
  - Scope: 仅当 content-type 为 `text/event-stream` 且 `req.agents` 非空时注入；协议缺失或非法则原样透传并记录告警。
  - Files: server/core response hooks.
  - Verify: 三协议注入测试；passthrough 和无 agents 原样透传测试。
  - Covers: R9-5, R9-6.

- [ ] 7.6 统一内部 LLM 请求与错误/取消模型
  - Scope: tool call 结束后发起内部 LLM 请求并将流按顺序回写；30 秒连接超时、非 2xx、读取异常写入协议对应错误事件并关闭；下游关闭时 abort 且不再写入。
  - Files: stream interceptor shared base, agent request code.
  - Verify: 三协议相同 agent 输入生成等价内部请求 body；错误和 abort 测试覆盖。
  - Covers: R9-7, R9-8, R9-9, R9-10.

## 8. OpenAI Streaming Usage Tracking

- [ ] 8.1 为 OpenAI Chat/Responses 流式响应添加 usage tee
  - Scope: 当 `req.apiProtocol` 为 OpenAI 且 `req.sessionId` 非空时 tee ReadableStream，后台解析 SSE，不影响主响应流。
  - Files: response hooks, `sessionUsageCache` integration.
  - Verify: 无 sessionId 时不 tee；主流正常透传。
  - Covers: R10-1, R10-4.

- [ ] 8.2 提取 Chat 和 Responses usage 并写入 cache
  - Scope: Chat 从含顶层 `usage` 的 chunk 取最后一次；Responses 从 `event: response.completed` 的 `response.usage` 取值。
  - Files: usage parser utilities.
  - Verify: 多次 usage 覆盖、空 usage 忽略、Responses completed 事件测试。
  - Covers: R10-2, R10-3.

- [ ] 8.3 保持 Anthropic usage 行为不变并补充清理逻辑
  - Scope: Anthropic `message_delta` usage 写入时机和字段集合不变；OpenAI 后台解析异常时独立执行日志记录和 reader lock 释放。
  - Files: existing Anthropic usage hook, OpenAI parser cleanup.
  - Verify: Anthropic 回归测试；异常路径测试确保不影响主响应流。
  - Covers: R10-5, R10-6, R17-3.

## 9. Docker, Documentation, and User-Facing Rename

- [ ] 9.1 更新 Docker 发布镜像名
  - Scope: CI workflow 中镜像 tag 改为 `musistudio/agent-router:*`; 移除旧 `musistudio/claude-code-router:*` push。
  - Files: `.github/workflows/docker-publish.yml`, Docker docs.
  - Verify: workflow 中旧镜像 push 指令为 0。
  - Covers: R4-1.

- [ ] 9.2 更新 README 升级说明
  - Scope: `README.md` 和 `README_zh.md` 增加升级说明，明确旧/新配置路径、旧/新 CLI 名、旧/新 schema 字段名，并声明不提供自动迁移。
  - Files: `README.md`, `README_zh.md`.
  - Verify: 必含要素逐项检查。
  - Covers: R3-6, R4-5.

- [ ] 9.3 更新用户可见文档中的命令和项目名
  - Scope: `README.md`, `README_zh.md`, `docs/docs/**/*.md` 中命令示例 `ccr` 改为 `agr`; 用户可见 `claude-code-router` 改为 `agent-router`。
  - Files: docs tree and README files.
  - Verify: 用户可见文档中 `ccr ` 和 `claude-code-router` 出现次数为 0；保留历史说明只在升级段落中以路径/字段形式出现。
  - Covers: R4-4.

## 10. Property Tests, Integration Tests, and Final Verification

- [ ] 10.1 建立属性测试命令
  - Scope: 引入或配置属性测试工具，新增 `pnpm test:pbt`; 不阻塞 `pnpm build`，但可被 CI 显式触发。
  - Files: root/package scripts, test config, package deps.
  - Verify: `pnpm test:pbt` 可单独运行。
  - Covers: R18-6.

- [ ] 10.2 补齐五类关键纯函数属性测试
  - Scope: `detectApiProtocol`, `normalizeRequestBody`, Subagent 标签往返, `createEnvVariables`, `getSessionId`。
  - Files: test files colocated or test directory.
  - Verify: `pnpm test:pbt` 覆盖 R18-1 到 R18-5。
  - Covers: R18-1, R18-2, R18-3, R18-4, R18-5.

- [ ] 10.3 增加三协议 API 集成测试矩阵
  - Scope: `/v1/messages`, `/v1/chat/completions`, `/v1/responses` 覆盖路由、session、preset namespace、usage、agent stream 注入的关键路径。
  - Files: server/core integration tests.
  - Verify: 三协议至少各有一个成功路由测试和一个 passthrough/错误路径测试。
  - Covers: R5, R6, R7, R8, R9, R10, R15, R16, R17.

- [ ] 10.4 最终全仓验证
  - Scope: 运行 build、属性测试、相关单元/集成测试；检查旧命名残留；确认无旧目录自动迁移代码。
  - Commands: `pnpm build`, `pnpm test:pbt`, repository-specific test commands, `rg "@CCR/|ccr |claude-code-router|CCR-SUBAGENT-MODEL|ccrVersion"`.
  - Verify: 仅允许升级说明中必要的旧路径/字段提及；其余旧品牌残留均已处理或有明确例外说明。
  - Covers: All requirements.
