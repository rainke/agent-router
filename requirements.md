# Requirements Document

## Introduction

本特性将 `claude-code-router` 改造为通用的终端 LLM 路由代理 `agent-router`, 使其能够同时服务三类终端 Coding Agent:

- **Claude Code** — 仅使用 Anthropic `/v1/messages` 协议
- **OpenAI Codex** — 仅使用 OpenAI Responses `/v1/responses` 协议
- **OpenCode** — 同时支持三种协议: Anthropic `/v1/messages`、OpenAI Chat Completions `/v1/chat/completions`、OpenAI Responses `/v1/responses`

改造涉及四个维度:

1. **项目标识重命名**: 包名、二进制名 (`ccr` → `agr`)、配置目录、命名空间均从 `claude-code-router` 迁移到 `agent-router`。本次迁移不提供自动向后兼容: 老用户需手动将 `~/.claude-code-router/config.json` 迁移至 `~/.agent-router/config.json`。
2. **服务器协议感知**: 将当前仅绑定在 `/v1/messages` 路径上的 hooks (路由、会话、Agent 工具拦截、流式用量追踪) 通用化, 使 `/v1/chat/completions` 与 `/v1/responses` 也能享受同等能力。
3. **客户端特定 CLI**: 新增 `agr codex`、`agr opencode` 子命令及对应的环境变量生成逻辑, 支持按客户端类型 activate。
4. **路由器通用化增强**: Session ID 获取、Subagent 模型标签提取、预设路径解析在三种协议上都能工作; Anthropic 专属特性 (Haiku background 检测) 不误伤其他协议。

Anthropic 协议自身的 API 行为 (端点 `/v1/messages`、路由结果、Agent 工具拦截、usage 追踪) 需保持与改造前语义等价, 但允许部分行为等价 (例如内部错误时流式响应的关闭方式可能略有差异), 不要求 100% 行为一致。

## Glossary

- **Agent_Router**: 本项目整体的新名称 (原 `claude-code-router`), 通用 LLM 路由代理系统。
- **AGR_CLI**: 名为 `agr` 的命令行入口 (原 `ccr`), 是用户交互的唯一 CLI。
- **Server**: 提供 HTTP API 的 Fastify 服务 (`packages/core/src/server.ts` 与 `packages/server/src/index.ts` 组合), 监听 `PORT` 并接收来自客户端的请求。
- **Router**: 位于 `packages/core/src/utils/router.ts` 的路由函数, 负责根据请求内容选择目标 `provider,model`。
- **Client_Type**: 枚举值, 可为 `claude` | `codex` | `opencode`, 标识用户要启动的终端 Coding Agent 类型。
- **Anthropic_Protocol**: 以 `/v1/messages` 结尾的 HTTP 端点所使用的 Anthropic 消息格式。
- **OpenAI_Chat_Protocol**: 以 `/v1/chat/completions` 结尾的 HTTP 端点所使用的 OpenAI Chat Completions 格式。
- **OpenAI_Responses_Protocol**: 以 `/v1/responses` 结尾的 HTTP 端点所使用的 OpenAI Responses API 格式 (Codex CLI 使用)。
- **Passthrough_Protocol**: 上述三种协议之外的任何端点 (例如 `/api/*`、`/ui/*`、`/v1/models`), 不参与路由与 Agent 流式拦截。
- **API_Protocol**: 请求装饰器 `req.apiProtocol`, 取值为 `'anthropic'` | `'openai-chat'` | `'openai-responses'` | `'passthrough'` 之一。
- **Protocol_Detector**: 负责根据 URL pathname 为每个请求计算 `API_Protocol` 的组件。
- **Request_Normalizer**: 将三种协议的请求体统一抽象为结构化接口 (Session ID、系统提示词、思考模式、工具格式、Web 搜索标记) 的组件。
- **Stream_Interceptor**: 处理流式响应中 Agent 工具调用拦截与重写的抽象接口; 具体实现为 `Anthropic_Stream_Interceptor`、`OpenAI_Chat_Stream_Interceptor` 与 `OpenAI_Responses_Stream_Interceptor`。
- **Preset**: 位于 `~/.agent-router/presets/<name>/` 的预设配置目录, 由命名空间 `/preset/<name>` 暴露。
- **Session_Manager**: 负责为每个请求获取或生成 Session ID 的组件, 存活范围贯穿单个 HTTP 请求。
- **Subagent_Model_Tag**: 系统提示词中用于指定子 agent 模型的尖括号标签, 新标签为 `<AGR-SUBAGENT-MODEL>...</AGR-SUBAGENT-MODEL>` (旧为 `<CCR-SUBAGENT-MODEL>`)。
- **Home_Dir**: 新的主目录常量 `~/.agent-router` (原 `~/.claude-code-router`)。

## Requirements

### Requirement 1: 包与命令的名称重命名

**User Story:** 作为 Agent_Router 的发布维护者, 我希望 npm 包名、CLI 二进制名和 npm workspace scope 全面迁移到 `agent-router`, 以便用户通过统一品牌安装和调用工具。

#### Acceptance Criteria

1. THE Agent_Router SHALL 在根 `package.json` 中使用 `@musistudio/agent-router` 作为包名, 且根 `package.json` 的 `name` 字段 SHALL NOT 出现子串 `claude-code-router`。
2. THE Agent_Router SHALL 在根 `package.json` 的 `bin` 字段中仅暴露 `agr` 可执行文件 (指向 `dist/cli.js`), 且 `bin` 字段 SHALL NOT 保留名为 `ccr` 的入口。
3. THE Agent_Router SHALL 将所有 workspace 子包的 `name` 字段由 `@CCR/*` 迁移为 `@agr/*` (对应 `@agr/cli`、`@agr/server`、`@agr/shared`、`@agr/ui`), 且所有子包的 `dependencies`、`devDependencies`、`peerDependencies` 字段中对工作区内部包的引用 SHALL 全部使用 `@agr/*` 前缀。
4. WHEN AGR_CLI 被调用并传入 `-h` 或 `help`, THE AGR_CLI SHALL 在 stdout 的 `Usage` 行中显示 `agr [command] [preset-name]` 字符串, 并以退出码 0 正常退出。
5. WHEN AGR_CLI 被调用并传入 `-v` 或 `version`, THE AGR_CLI SHALL 在 stdout 输出首行以 `agent-router version:` 起始的版本字符串, 并以退出码 0 正常退出。
6. WHEN 构建脚本执行 `pnpm build`, THE Agent_Router SHALL 以退出码 0 完成所有子包的 TypeScript 编译, 且工作区内任何 `.ts`/`.tsx`/`.js`/`.json` 源文件中的 `@CCR/` 出现次数 SHALL 为 0。
7. IF 构建过程中检测到任何未解析的 `@CCR/*` 引用 (来自 import/require 语句或 package.json 字段), THEN THE Agent_Router SHALL 以非零退出码终止构建并在 stderr 输出对应引用位置。

### Requirement 2: 配置目录、日志与 PID 文件重命名

**User Story:** 作为 Agent_Router 的运行时使用者, 我希望配置、日志和运行态文件均位于统一的 `~/.agent-router` 目录下, 以便维护和清理。

#### Acceptance Criteria

1. THE Agent_Router SHALL 使用 `~/.agent-router` 作为 Home_Dir 常量 (`HOME_DIR`), 且该常量 SHALL 通过 `HOME_DIR` 拼接而非硬编码字符串传入所有下游文件路径常量。
2. THE Agent_Router SHALL 使用 `~/.agent-router/config.json` 作为主配置文件路径 (`CONFIG_FILE`)。
3. THE Agent_Router SHALL 使用 `~/.agent-router/.agent-router.pid` 作为 PID 文件路径 (`PID_FILE`)。
4. THE Agent_Router SHALL 使用 `<os.tmpdir()>/agent-router-reference-count.txt` 作为引用计数文件路径 (`REFERENCE_COUNT_FILE`), 其中 `os.tmpdir()` 为 Node.js 运行期解析结果。
5. WHEN Server 启动并需要创建滚动日志文件, THE Server SHALL 将日志写入 `~/.agent-router/logs/agr-<timestamp>.log` 路径, 其中 `<timestamp>` SHALL 为 `YYYYMMDD-HHmmss` 格式的本地时间字符串 (仅包含数字与单个连字符)。
6. IF Server 启动期无法创建日志文件 (EACCES、ENOSPC 等 I/O 错误), THEN THE Server SHALL 在 3 秒内向 stderr 输出一条包含错误原因的消息并以非零退出码 (1-255) 退出, 不静默降级到无日志模式。
7. WHEN AGR_CLI 创建 Claude Code settings 临时文件, THE AGR_CLI SHALL 将其写入 `<os.tmpdir()>/agent-router/agr-settings-<hash>.json` 路径, 其中 `<hash>` SHALL 为长度 8-64、字符集 `[a-f0-9]` 的十六进制字符串。
8. WHEN Server 或 AGR_CLI 首次需要写入 `~/.agent-router/logs/`、`~/.agent-router/`、`<os.tmpdir()>/agent-router/` 任一目录且该目录不存在, THE 对应进程 SHALL 以 `recursive: true` 创建该目录后再写入目标文件。

### Requirement 3: 不提供旧目录向后兼容迁移

**User Story:** 作为 Agent_Router 的维护者, 我希望不为旧 `~/.claude-code-router` 目录提供任何自动迁移、符号链接、硬链接或拷贝兼容, 以避免维护复杂度; 老用户需要手动迁移配置。

#### Acceptance Criteria

1. THE Agent_Router SHALL 不读取 `~/.claude-code-router` 目录下的任何文件 (包含 `config.json`、`plugins/`、`presets/`、`logs/`、`.ccr.pid`) 作为运行时配置源或状态源。
2. THE Agent_Router SHALL 不创建从 `~/.agent-router` 指向 `~/.claude-code-router` 的符号链接、硬链接, 也不在启动期将旧目录内容自动拷贝到 `~/.agent-router`。
3. WHEN `~/.agent-router` 不存在且进程需要读取该目录, THE Agent_Router SHALL 按既有 `initDir()` 流程创建 `~/.agent-router`、`~/.agent-router/plugins`、`~/.agent-router/presets`、`~/.agent-router/logs` 子目录。
4. WHEN `~/.agent-router/config.json` 不存在, THE Agent_Router SHALL 写入一份包含 `PORT: 3456`、`Providers: []`、`Router: {}` 最小字段的默认配置文件。
5. IF `initDir()` 或默认配置文件写入失败 (EACCES、ENOSPC 等 I/O 错误), THEN THE Agent_Router SHALL 以非零退出码 (1-255) 退出并在 stderr 输出错误原因, 不进入降级模式。
6. THE Agent_Router SHALL 在 `README.md` 与 `README_zh.md` 的升级说明段落中, 明确列出以下三项迁移要点: (a) 配置文件路径从 `~/.claude-code-router/config.json` 改为 `~/.agent-router/config.json`; (b) 预设 schema 字段从 `ccrVersion` 改为 `agrVersion`; (c) CLI 命令从 `ccr` 改为 `agr`。

### Requirement 4: Docker 镜像与 UI/预设 schema 重命名

**User Story:** 作为通过 Docker 或 UI 使用 Agent_Router 的运维人员, 我希望镜像名与预设 schema 字段也与新品牌一致, 以便平滑升级。

#### Acceptance Criteria

1. THE Agent_Router SHALL 将 CI 发布的 Docker 镜像 tag 由 `musistudio/claude-code-router:*` 全部替换为 `musistudio/agent-router:*`, 涉及 `latest` 与 semver 标签; CI workflow 文件中 SHALL NOT 保留对旧镜像名的 push 指令。
2. THE Agent_Router SHALL 在 UI 预设 schema 中使用 `agrVersion` 字段 (字符串类型, 取值来自根 `package.json` 的 `version` 字段) 记录兼容的 Agent_Router 版本, 且 SHALL NOT 同时写入 `ccrVersion` 字段。
3. IF UI 或 Server 读取预设文件时仅发现 `ccrVersion` 字段而缺少 `agrVersion`, THEN THE Agent_Router SHALL 拒绝应用该预设、不修改当前配置, 并向调用方返回包含迁移提示的错误响应 (UI 场景显示错误横幅, HTTP 场景返回 4xx 状态)。
4. THE Agent_Router SHALL 更新 `README.md`、`README_zh.md`、`docs/docs/**/*.md` 下所有用户可见文档, 将命令示例中的 `ccr` 字面量替换为 `agr`, 且所有用户可见文档文件中 `ccr ` (带空格) 与 `claude-code-router` 两类子串的出现次数 SHALL 各自为 0。
5. THE Agent_Router SHALL 在 `README.md` 与 `README_zh.md` 的升级说明段落内包含以下必含要素: 旧配置文件路径、新配置文件路径、旧 CLI 名、新 CLI 名、旧 schema 字段名、新 schema 字段名, 以及 "不提供自动迁移" 的显式声明。

### Requirement 5: 服务器 API 协议检测装饰器

**User Story:** 作为 Server 的开发者, 我希望每个请求都具备一个稳定的协议标识, 以便所有 hooks 不再依赖路径字符串判断来区分三种 API 格式。

#### Acceptance Criteria

1. WHEN Fastify 接收到一个 HTTP 请求且进入 `onRequest`/`preHandler` 生命周期, THE Server SHALL 为该请求设置 `req.apiProtocol` 装饰器, 类型为 `'anthropic' | 'openai-chat' | 'openai-responses' | 'passthrough'`, 且在该请求生命周期内后续 hook SHALL NOT 修改该装饰器的值。
2. WHEN 请求 URL 去除 query 与 fragment 后的 pathname (大小写敏感) 以 `/v1/messages` 或 `/v1/messages/` 结尾, THE Protocol_Detector SHALL 设置 `req.apiProtocol = 'anthropic'`。
3. WHEN 该 pathname 以 `/v1/chat/completions` 或 `/v1/chat/completions/` 结尾, THE Protocol_Detector SHALL 设置 `req.apiProtocol = 'openai-chat'`。
4. WHEN 该 pathname 以 `/v1/responses` 或 `/v1/responses/` 结尾 (但不属于 `/v1/responses/*` 的严格子路径), THE Protocol_Detector SHALL 设置 `req.apiProtocol = 'openai-responses'`。
5. IF 该 pathname 不匹配上述三种模式之一 (包括空字符串、`/`、`null`、`undefined`), THEN THE Protocol_Detector SHALL 设置 `req.apiProtocol = 'passthrough'`。
6. THE Protocol_Detector SHALL 对任意长度在 0 到 8192 字符之间的 pathname 字符串输入返回 `{'anthropic', 'openai-chat', 'openai-responses', 'passthrough'}` 中恰好一个值且不抛出异常。
7. THE Protocol_Detector SHALL 在同一进程内对相同 pathname 输入两次调用返回相同结果 (确定性, 可通过属性测试验证)。
8. THE Server SHALL 在 `preHandler` 阶段、早于路由 hook (`registerNamespace` 中的 `router()` 调用) 之前完成协议检测。
9. IF 某个 pathname 同时匹配 `/v1/messages` 与 `/v1/chat/completions` 两种后缀 (理论不可能, 但需保证确定性), THEN THE Protocol_Detector SHALL 按 `anthropic` → `openai-chat` → `openai-responses` 的优先级返回第一个命中的值。

### Requirement 6: 协议感知的请求体归一化

**User Story:** 作为 Router 的开发者, 我希望对三种请求体以相同的抽象接口读取 Session ID、系统提示词、思考模式、工具列表和 Web 搜索标记, 以便后续路由逻辑统一处理。

#### Acceptance Criteria

1. THE Request_Normalizer SHALL 提供 `normalizeRequestBody(req)` 函数, 输出结构 `{ sessionId?: string, system: Array<{type: string, text?: string}>, thinking?: any, tools: any[], hasWebSearch: boolean, protocol: API_Protocol }`; 当对应输入缺失时, `system` 与 `tools` SHALL 为长度 0 数组, `sessionId`/`thinking` SHALL 为 `undefined`, `hasWebSearch` SHALL 为 `false`, `protocol` SHALL 保留 `req.apiProtocol` 原值。
2. WHEN `req.apiProtocol === 'anthropic'` 且 `req.body.metadata.user_id` 为字符串并包含子串 `_session_`, THE Request_Normalizer SHALL 按首次出现的 `_session_` 切分并取第二段作为 `sessionId`; 否则 `sessionId` SHALL 为 `undefined`。
3. WHEN `req.apiProtocol === 'openai-chat'` 或 `req.apiProtocol === 'openai-responses'`, THE Request_Normalizer SHALL 按 HTTP 头不区分大小写的方式读取请求头 `X-Session-Id`; 若存在且去除首尾空白后长度大于 0, 其值 SHALL 作为 `sessionId`; 否则为 `undefined`。
4. WHEN `req.apiProtocol === 'anthropic'`, THE Request_Normalizer SHALL 将 `req.body.system` 归一化为 `system` 数组: 数组则按原顺序返回; 字符串则返回 `[{ type: 'text', text: <该字符串> }]`; `undefined`/`null` 则返回长度 0 数组。
5. WHEN `req.apiProtocol === 'openai-chat'`, THE Request_Normalizer SHALL 按 `req.body.messages` 数组顺序提取所有 `role === 'system'` 的消息并为每条输出 `{ type: 'text', text: <content 文本形式> }` 追加到 `system`; 若不存在则为长度 0 数组。
6. WHEN `req.apiProtocol === 'openai-responses'`, THE Request_Normalizer SHALL 将 `req.body.instructions` (字符串) 作为单一 `{ type: 'text', text: <instructions> }` 元素放入 `system` 数组; 同时按 `req.body.input` 数组顺序追加所有 `role === 'system'` 或 `type === 'message'` 且 `role === 'system'` 的条目; 若两者均缺失则为长度 0 数组。
7. WHEN `req.apiProtocol === 'anthropic'` 且 `req.body.thinking` 已定义, THE Request_Normalizer SHALL 将其原样赋值到 `thinking`; WHEN `req.apiProtocol === 'openai-chat'` 或 `'openai-responses'` 且 `req.body.reasoning_effort` (Chat) 或 `req.body.reasoning.effort` (Responses) 为非空字符串, THE Request_Normalizer SHALL 将 `thinking` 赋值为包装对象保留该原始字符串; 其余情形 `thinking` SHALL 为 `undefined`。
8. THE Request_Normalizer SHALL 将 `req.body.tools` 归一化为 `tools`: 数组按原顺序返回; 非数组类型 (含 `undefined`/`null`) 返回长度 0 数组, 对三种协议均适用。
9. THE Request_Normalizer SHALL 当且仅当归一化后的 `tools` 数组中至少一个元素的 `type` 字段为字符串且以前缀 `web_search` 起始时, 将 `hasWebSearch` 置为 `true`; 否则为 `false`, 对三种协议均适用。
10. FOR ALL 合法请求输入 `req` (在 `req` 不被修改的前提下), 连续两次调用 `normalizeRequestBody(req)` 的返回结构在 `sessionId`、`system`、`thinking`、`tools`、`hasWebSearch`、`protocol` 字段上 SHALL 按值相等 (幂等, 可通过属性测试验证)。
11. IF 请求体不是对象、JSON 解析失败、`req.apiProtocol` 不属于 `{'anthropic', 'openai-chat', 'openai-responses'}`, 或缺少上述字段, THEN THE Request_Normalizer SHALL 返回符合第 1 条默认值规定的结构且 SHALL NOT 抛出异常。

### Requirement 7: Router 协议无关化改造

**User Story:** 作为 Router 的开发者, 我希望路由逻辑不再假设输入一定是 Anthropic 请求体, 而是基于 Request_Normalizer 的统一接口运行, 并对三种协议都能解析 Subagent 模型标签。

#### Acceptance Criteria

1. WHEN `req.apiProtocol ∈ {'anthropic', 'openai-chat', 'openai-responses'}`, THE Server SHALL 在 `registerNamespace` 的 `preHandler` 钩子中同步 await 调用 `router(req, reply, context)`。
2. WHEN `req.body.model` 为字符串且不包含英文逗号 `,`, THE Router SHALL 基于 `normalizeRequestBody(req)` 的结果计算目标模型并将 `req.body.model` 重写为形如 `<provider>,<model>` 的字符串。
3. WHEN `req.body.model` 已为 `<provider>,<model>` 形式 (含至少一个 `,`), THE Router SHALL 直接保留其原值, 不再进行场景路由计算。
4. THE Router SHALL 识别标签 `<AGR-SUBAGENT-MODEL>...</AGR-SUBAGENT-MODEL>` 作为 Subagent 模型提取入口; 旧标签 `<CCR-SUBAGENT-MODEL>` SHALL NOT 被识别, 且 SHALL NOT 从消息文本中被自动移除。
5. WHEN `req.apiProtocol === 'openai-chat'` 或 `req.apiProtocol === 'openai-responses'` 且归一化后的 `system` 数组中某元素文本匹配正则 `<AGR-SUBAGENT-MODEL>([^<]+)</AGR-SUBAGENT-MODEL>`, THE Router SHALL 取该正则捕获组作为目标模型, 并在原请求体对应位置 (Chat: `messages[i].content`; Responses: `instructions` 或 `input[i].content`) 将整个标签连同标签内容原子地移除, 仅影响数组索引升序中首个匹配的元素。
6. WHEN `req.apiProtocol === 'anthropic'` 且 `req.body.system[1].text` 以 `<AGR-SUBAGENT-MODEL>` 字符串起始, THE Router SHALL 取其闭合标签前的子串作为目标模型, 并从 `req.body.system[1].text` 字面移除整个标签。
7. IF `req.apiProtocol !== 'anthropic'`, THEN THE Router SHALL 跳过基于 `req.body.model` 的 Claude Haiku/background 自动降级检测分支。
8. WHEN Router 场景匹配成功且配置存在对应目标模型, THE Router SHALL 将 `req.body.model` 设为 `<provider>,<model>`; WHEN Router 场景未匹配或配置缺失对应条目, THE Router SHALL 保留 `req.body.model` 原值不为 `null`/`undefined`。
9. FOR ALL 输入系统提示词 `s` 包含恰好一个 `<AGR-SUBAGENT-MODEL>m</AGR-SUBAGENT-MODEL>` 标签且 `m` 为不含 `<` 的字符串, Router 提取后的新系统提示词 SHALL 不再包含该标签子串, 且返回模型等于 `m` (提取-移除往返属性, 可通过属性测试验证, 覆盖三种协议输入)。

### Requirement 8: 预设命名空间三协议路径解析

**User Story:** 作为预设使用者, 我希望通过 `/preset/<name>/v1/messages`、`/preset/<name>/v1/chat/completions`、`/preset/<name>/v1/responses` 三个路径访问同一个预设配置, 以便 Claude Code、Codex 与 OpenCode 共享同一组 Providers。

#### Acceptance Criteria

1. THE Server SHALL 仅识别字符集 `[a-zA-Z0-9_-]` 且长度 1-64 的 `<name>` 作为合法预设名; IF `<name>` 含有其他字符 (特别是 `.`、`/`、`\`), THEN THE Server SHALL 返回 404 响应且 SHALL NOT 访问文件系统。
2. WHEN 请求路径以 `/preset/<name>/v1/messages`、`/preset/<name>/v1/chat/completions` 或 `/preset/<name>/v1/responses` 开头且 `<name>` 为合法预设名, THE Server SHALL 将请求路由到名称为 `<name>` 的预设命名空间。
3. THE Server SHALL 在上述三种路径下共享同一 `configService`、`providerService`、`transformerService` 实例 (可通过同一预设名的两次并发请求观察到一致的 provider 列表与 transformer 行为)。
4. WHEN 请求路径匹配预设命名空间且进入 `preHandler`, THE Server SHALL 将 `<name>` 写入 `req.preset` 装饰器, 对三种协议均适用, 且该值 SHALL 可被下游 `router` 与 Stream_Interceptor hook 读取。
5. IF 预设名称 `<name>` 不存在于 `~/.agent-router/presets/<name>/` 目录, THEN THE Server SHALL 在路由匹配完成之后执行文件存在性检查并以 HTTP 404 状态响应, SHALL NOT 回落到默认命名空间。
6. THE 404 响应 SHALL 携带一个可观测的错误指示 (JSON body 或 header) 说明 "preset not found", 使客户端能区分 "预设不存在" 与 "路径不合法" 两种情形。

### Requirement 9: 协议感知的流式拦截器

**User Story:** 作为 Agent System 的开发者, 我希望三种格式的流式响应都能支持 Agent 工具调用拦截与回写, 以便 image agent 等特性在 Codex/OpenCode 客户端下同样生效。

#### Acceptance Criteria

1. THE Server SHALL 提供 `Stream_Interceptor` 抽象接口, 定义回调 `onToolCallStart(toolCallId, toolName)`、`onToolCallArgsDelta(toolCallId, argsChunk)`、`onToolCallEnd(toolCallId, accumulatedArgs)`、`onMessageDelta(textChunk)`, 所有回调返回值为 `void | Promise<void>`, `toolCallId` 为非空字符串。
2. THE Server SHALL 提供 `Anthropic_Stream_Interceptor` 实现, 处理 Anthropic SSE 事件 `content_block_start` (tool_use 类型触发 onToolCallStart)、`input_json_delta` (触发 onToolCallArgsDelta)、`content_block_stop` (触发 onToolCallEnd)、`message_delta` (触发 onMessageDelta)。
3. THE Server SHALL 提供 `OpenAI_Chat_Stream_Interceptor` 实现, 处理 `choices[0].delta.tool_calls[]`: 首个带 `function.name` 的分片触发 onToolCallStart; 带 `function.arguments` 文本的分片触发 onToolCallArgsDelta; `choices[0].finish_reason === 'tool_calls'` 触发 onToolCallEnd (accumulatedArgs 按 `index` 累积拼接)。
4. THE Server SHALL 提供 `OpenAI_Responses_Stream_Interceptor` 实现, 处理 Responses API SSE 事件 `response.output_item.added` (type 为 `function_call` 时触发 onToolCallStart)、`response.function_call_arguments.delta` (触发 onToolCallArgsDelta)、`response.output_item.done` (触发 onToolCallEnd)、`response.output_text.delta` (触发 onMessageDelta)。
5. WHEN `onSend` 钩子处理响应且该响应 content-type 以 `text/event-stream` 开头且 `req.agents` 为非空数组, THE Server SHALL 按 `req.apiProtocol` 值实例化对应的 Stream_Interceptor 并注入到响应流处理管道。
6. IF `req.apiProtocol` 缺失或取值不在 `{'anthropic', 'openai-chat', 'openai-responses'}` 集合内, THEN THE Server SHALL 跳过 Stream_Interceptor 注入并按原响应流原样透传, 同时在服务端日志中记录一条告警条目。
7. WHEN onToolCallEnd 触发, THE Stream_Interceptor SHALL 以拦截到的工具参数发起新的内部 LLM 请求, 并将该请求返回的流式响应原样转发至原响应流, 使客户端在单次 HTTP 连接内按时间顺序收到原响应前缀事件、拦截合并事件, 以及新请求的全部事件直到终止事件。
8. IF 内部 LLM 请求 30 秒内未建立连接、响应 HTTP 状态码非 2xx、或读取响应流时抛出异常, THEN THE Stream_Interceptor SHALL 向客户端写入一条协议对应的错误事件后关闭流, 不降级回退到原响应; Anthropic 写入 `event: error` SSE 事件 (data 为包含错误类型与说明的对象); OpenAI Chat 写入 `data:` 为含 `error` 字段的 JSON chunk 后写入 `data: [DONE]`; OpenAI Responses 写入一条 `event: error` 的 SSE 事件 (data 为含 `error` 字段的对象)。
9. IF 流式处理过程中底层 socket 抛出 `ERR_STREAM_PREMATURE_CLOSE` 或下游连接在写入时关闭, THEN THE Stream_Interceptor SHALL 立即调用关联的 AbortController.abort() 并终止后续写入尝试, 不再发送错误通知, 也不保证写入终止标志事件。
10. THE Stream_Interceptor SHALL 为三种协议提供等价的副作用模型: 对相同 agent 定义与相同 accumulatedArgs 输入, 三种实现发起的内部 LLM 请求 body SHALL 在目标模型名、消息/输入内容与顺序、temperature、tool 定义集合、agent 注入系统指令文本上完全一致, 差异仅允许出现在各协议强制要求的字段命名与结构上。
11. WHEN OpenAI Chat 或 Responses 流式响应中同一 tool call 的多个参数分片到达, THE 对应 Stream_Interceptor SHALL 按到达顺序拼接各分片文本为单一字符串并在 onToolCallEnd 前产出; IF 累积结果经 JSON.parse 抛出语法错误, THEN SHALL 按条款 8 流程返回错误事件并关闭流, 不再发起后续内部 LLM 请求。

### Requirement 10: OpenAI 流式用量追踪 (Chat + Responses)

**User Story:** 作为 Router 的维护者, 我希望 OpenAI Chat 与 Responses 流式响应中的 `usage` 字段也能被收集到 `sessionUsageCache`, 以便长上下文降级策略对 Codex/OpenCode 客户端同样生效。

#### Acceptance Criteria

1. WHEN `req.apiProtocol === 'openai-chat'` 或 `'openai-responses'` 且响应 body 为 `ReadableStream` 且 `req.sessionId` 非空, THE Server SHALL 对响应进行 tee 并在后台异步解析 SSE 流 (以 `\n\n` 为事件分隔、`data:` 行前缀), 后台任务生命周期独立于主响应流。
2. WHEN 后台解析 OpenAI Chat 流发现某 chunk 顶层或 `choices[*]` 之外存在 `usage` 字段且其值为非空对象, THE Server SHALL 调用 `sessionUsageCache.put(req.sessionId, usage)`; 若流中多次出现 usage, 以最后一次为准覆盖。
3. WHEN 后台解析 OpenAI Responses 流发现 `event: response.completed` 事件且其 data 对象的 `response.usage` 字段为非空对象, THE Server SHALL 调用 `sessionUsageCache.put(req.sessionId, usage)`。
4. IF `req.sessionId` 为空或未定义, THEN THE Server SHALL 跳过 tee 与后台解析, 不调用 `sessionUsageCache.put`, 主响应流不受影响。
5. IF 后台读取流提前关闭、抛出异常或 SSE 解析失败, THEN THE Server SHALL 触发两个彼此独立的清理动作 — 记录错误日志与释放 reader lock — 任何一个动作异常均 SHALL NOT 阻止另一个动作执行, 且 SHALL NOT 影响主响应流向客户端的写入。
6. WHERE `req.apiProtocol === 'anthropic'`, THE Server SHALL 保持既有 `message_delta` 事件 usage 提取、`sessionUsageCache.put` 写入时机与字段集合不变。

### Requirement 11: 多客户端环境变量生成

**User Story:** 作为 AGR_CLI 的使用者, 我希望 `createEnvVariables(clientType)` 函数根据客户端类型输出对应的环境变量组合, 以便我可以分别激活 Claude Code、Codex 或 OpenCode。

#### Acceptance Criteria

1. THE AGR_CLI SHALL 提供 `createEnvVariables(clientType: Client_Type): Record<string, string | undefined>` 函数。
2. WHEN `clientType === 'claude'`, THE AGR_CLI SHALL 在返回结果中包含 `ANTHROPIC_AUTH_TOKEN` 与 `ANTHROPIC_BASE_URL` (值为 `http://127.0.0.1:<port>`)。
3. WHEN `clientType === 'codex'`, THE AGR_CLI SHALL 在返回结果中包含 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL`, 且 `OPENAI_BASE_URL` 值 SHALL 以 `/v1` 结尾 (例如 `http://127.0.0.1:<port>/v1`), 使 Codex CLI 追加 `/responses` 后恰好命中 Server 的 `/v1/responses` 端点。
4. WHEN `clientType === 'opencode'`, THE AGR_CLI SHALL 同时包含 Anthropic 组 (`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`) 与 OpenAI 组 (`OPENAI_API_KEY`、`OPENAI_BASE_URL`) 环境变量, 使 OpenCode 在运行时可自由切换使用 `/v1/messages`、`/v1/chat/completions`、`/v1/responses` 三种协议之一。
5. FOR ALL 合法 `clientType` 值以及相同的配置快照, `createEnvVariables(clientType)` 的两次调用 SHALL 返回按键与值深度相等的对象 (幂等, 可通过属性测试验证)。
6. THE AGR_CLI SHALL 在任意合法 `clientType` 下保留通用变量 `NO_PROXY`、`DISABLE_TELEMETRY`、`DISABLE_COST_WARNINGS`、`API_TIMEOUT_MS`。
7. IF 调用方传入非法 `clientType` (不属于 `{'claude', 'codex', 'opencode'}`), THEN THE AGR_CLI SHALL 抛出携带 "invalid clientType" 字样及所有合法值列表的错误, 而不返回空对象或 undefined。

### Requirement 12: agr codex 子命令

**User Story:** 作为 Codex 用户, 我希望通过 `agr codex [args...]` 一键启动带有正确环境变量的 codex 进程 (向 Server 发送 `/v1/responses` 请求), 并在 Server 未运行时自动启动 Server。

#### Acceptance Criteria

1. THE AGR_CLI SHALL 识别 `codex` 作为一级子命令 (加入 `KNOWN_COMMANDS`)。
2. WHEN 用户执行 `agr codex [args...]`, THE AGR_CLI SHALL 使用 `createEnvVariables('codex')` 生成的环境变量合并到子进程环境中, 并将 stdin/stdout/stderr 直通。
3. THE AGR_CLI SHALL 按以下优先级解析 codex 可执行文件路径: `config.CODEX_PATH` > `process.env.CODEX_PATH` > 字符串 `"codex"`。
4. WHEN 用户执行 `agr codex` 且 Server 未运行 (PID 文件不存在或进程不可用), THE AGR_CLI SHALL 自动以 detached 方式启动 Server, 等待就绪后再启动 codex 进程。
5. IF Server 启动在 10 秒超时内未就绪, THEN THE AGR_CLI SHALL 向 stderr 输出错误信息并以非零退出码退出, 不启动 codex 进程。
6. THE AGR_CLI SHALL 在启动 codex 时不传入 `--settings` 标志, 也不写入或修改任何 statusLine 相关临时配置文件。
7. WHEN codex 子进程退出, THE AGR_CLI SHALL 按现有方式调用 `decrementReferenceCount()` 与 `closeService()` 完成清理。

### Requirement 13: agr opencode 子命令

**User Story:** 作为 OpenCode 用户, 我希望通过 `agr opencode [args...]` 一键启动带有三协议环境变量的 opencode 进程, 并复用 Server 自动启动逻辑。

#### Acceptance Criteria

1. THE AGR_CLI SHALL 识别 `opencode` 作为一级子命令 (加入 `KNOWN_COMMANDS`)。
2. WHEN 用户执行 `agr opencode [args...]`, THE AGR_CLI SHALL 使用 `createEnvVariables('opencode')` 同时注入 Anthropic 与 OpenAI 两组环境变量到子进程环境中, 使 opencode 可自由选择使用 `/v1/messages`、`/v1/chat/completions` 或 `/v1/responses` 三种协议之一。
3. THE AGR_CLI SHALL 按以下优先级解析 opencode 可执行文件路径: `config.OPENCODE_PATH` > `process.env.OPENCODE_PATH` > 字符串 `"opencode"`。
4. WHEN 用户执行 `agr opencode` 且 Server 未运行, THE AGR_CLI SHALL 自动以 detached 方式启动 Server, 等待就绪后再启动 opencode 进程。
5. IF opencode 可执行文件不存在 (ENOENT) 或 spawn 失败, THEN THE AGR_CLI SHALL 向 stderr 输出包含 "opencode" 安装提示的消息并以非零退出码退出。

### Requirement 14: agr activate 客户端类型参数

**User Story:** 作为 shell 用户, 我希望 `agr activate [claude|codex|opencode]` 能输出指定客户端的 shell 环境变量, 以便我可以用 `eval "$(agr activate codex)"` 在终端会话中配置 Codex。

#### Acceptance Criteria

1. WHEN 用户执行 `agr activate` 且未提供客户端参数, THE AGR_CLI SHALL 默认使用 Client_Type `claude` 并输出对应的 shell `export`/`unset` 语句到 stdout。
2. WHEN 用户执行 `agr activate claude`, THE AGR_CLI SHALL 仅输出 Anthropic 组环境变量的 `export/unset` 语句。
3. WHEN 用户执行 `agr activate codex`, THE AGR_CLI SHALL 输出 `export OPENAI_API_KEY="..."` 与 `export OPENAI_BASE_URL="..."`, 且 `OPENAI_BASE_URL` 以 `/v1` 结尾。
4. WHEN 用户执行 `agr activate opencode`, THE AGR_CLI SHALL 同时输出 Anthropic 与 OpenAI 两组 `export` 语句。
5. IF 用户执行 `agr activate <unknown>` 且 `<unknown>` 不属于 `{'claude', 'codex', 'opencode'}`, THEN THE AGR_CLI SHALL 向 stderr 输出帮助信息并以非零退出码退出。
6. THE AGR_CLI SHALL 保持 `agr env` 作为 `agr activate` 的别名, 行为完全一致。

### Requirement 15: 非 Anthropic 客户端的 Session ID 管理

**User Story:** 作为 Codex 或 OpenCode 用户, 我希望 Router 在没有 Anthropic `metadata.user_id` 的情况下也能为我的请求建立稳定的 Session ID, 以便长上下文降级、usage 累积等逻辑正常工作。

#### Acceptance Criteria

1. WHEN `req.apiProtocol === 'anthropic'`, THE Session_Manager SHALL 保留既有的 `metadata.user_id` 内 `_session_` 拆分逻辑作为 Session ID 来源。
2. WHEN `req.apiProtocol === 'openai-chat'` 或 `'openai-responses'` 且请求头 `X-Session-Id` 存在, THE Session_Manager SHALL 使用该请求头值 (去除首尾空白) 作为 Session ID。
3. WHEN `req.apiProtocol === 'openai-chat'` 或 `'openai-responses'` 且请求头 `X-Session-Id` 不存在或为空, THE Session_Manager SHALL 为本次请求生成一个 UUID v4 作为 Session ID, 并在响应头 `X-Session-Id` 中回写该值。
4. THE Session_Manager SHALL 保证 `getSessionId(req)` 对任意合法 Fastify 请求返回非空字符串 (全域函数, 可通过属性测试验证)。
5. THE Session_Manager SHALL 在同一请求生命周期内对同一 `req` 多次调用 `getSessionId(req)` 返回相同值 (幂等, 可通过属性测试验证)。
6. IF UUID 生成失败, THEN THE Session_Manager SHALL 记录错误并使用 `Date.now() + '-' + Math.random().toString(36).slice(2)` 作为回退标识符, 并在响应头 `X-Session-Id` 中回写该回退值。

### Requirement 16: Anthropic 专属路由特性门控

**User Story:** 作为 Codex/OpenCode 用户, 我不希望 Router 把我请求中的 `claude-haiku-4` 式模型名错误地当作背景任务路由; Claude 专属的路由启发式应当仅对 Anthropic 协议生效。

#### Acceptance Criteria

1. WHEN Router 判断 `req.body.model` 是否为 Claude Haiku 变体以决定使用 background 模型, THE Router SHALL 仅在 `req.apiProtocol === 'anthropic'` 时执行该检查。
2. WHEN Router 执行 webSearch 路由分支, THE Router SHALL 同时接受 Anthropic 的 `tool.type === 'web_search'` 形式与 OpenAI 的 `tool.type === 'web_search_preview'` 或 `'web_search'` 形式, 对三种协议均适用。
3. THE Router SHALL 对三种协议共享 longContext、think、default 三类场景路由。
4. IF `req.apiProtocol === 'passthrough'`, THEN THE Router SHALL 不修改 `req.body`, 也不设置 `req.scenarioType`。

### Requirement 17: 与 Anthropic 客户端行为的等价性

**User Story:** 作为既有 Claude Code 用户, 我希望在手动迁移配置到 `~/.agent-router/` 之后, Anthropic 相关的 API 语义与 CLI 用法尽可能与改造前保持等价, 允许非关键细节上的差异。

#### Acceptance Criteria

1. THE Agent_Router SHALL 不从 `~/.claude-code-router/` 读取任何运行时配置 (与 Requirement 3 一致)。
2. THE Server SHALL 继续在 `/v1/messages` 端点接受 Anthropic 格式请求。
3. THE Server SHALL 在 Anthropic 请求上保持核心行为与改造前等价: 路由选择结果、Subagent 模型提取语义 (标签由 `<CCR-SUBAGENT-MODEL>` 迁移到 `<AGR-SUBAGENT-MODEL>`)、Agent 工具拦截的外部可见效果、`sessionUsageCache` 的 usage 写入。
4. THE Server SHALL 允许非关键细节上的差异存在 (例如日志格式、错误消息文案、内部流关闭时的精确时序), 不要求 100% 字节级一致。
5. THE AGR_CLI SHALL 保留 `code`、`start`、`stop`、`restart`、`status`、`statusline`、`model`、`preset`、`install`、`activate`/`env`、`ui`、`help`、`version` 全部既有子命令。
6. WHEN 用户执行 `agr code [args...]`, THE AGR_CLI SHALL 与既有 `ccr code` 语义等价 (启动 claude 可执行文件、写入 settings 文件、管理引用计数)。

### Requirement 18: 属性测试覆盖的关键纯函数

**User Story:** 作为质量工程师, 我希望核心纯函数具备属性测试, 以便在持续集成中自动发现协议检测、归一化、标签往返、环境变量生成等基础机制的退化。

#### Acceptance Criteria

1. THE Agent_Router SHALL 为 `Protocol_Detector(pathname)` 提供属性测试, 验证输出始终属于 `{'anthropic', 'openai-chat', 'openai-responses', 'passthrough'}` 四选一且确定 (见 R5-6/R5-7)。
2. THE Agent_Router SHALL 为 `normalizeRequestBody(req)` 提供属性测试, 验证归一化结果的幂等性 (见 R6-10) 与对畸形输入的不抛异常性 (见 R6-11), 覆盖三种合法协议。
3. THE Agent_Router SHALL 为 Subagent 标签提取与移除提供往返属性测试 (见 R7-9), 覆盖 `anthropic`、`openai-chat`、`openai-responses` 三种协议输入。
4. THE Agent_Router SHALL 为 `createEnvVariables(clientType)` 提供属性测试, 验证相同输入多次调用结果深度相等 (见 R11-5) 且非法输入抛错 (见 R11-7)。
5. THE Agent_Router SHALL 为 `getSessionId(req)` 提供属性测试, 验证其对任意合法请求的全域性 (见 R15-4) 与同请求调用幂等性 (见 R15-5), 覆盖三种合法协议。
6. THE Agent_Router SHALL 在 `pnpm build` 之外提供可单独运行的属性测试命令 (例如 `pnpm test:pbt`), 使属性测试不阻塞主构建但可被 CI 显式触发。
