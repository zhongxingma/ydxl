# 开发规范

本文档是 `ydxl` 项目的编码与工程规范，与 [CONTRIBUTING.md](../CONTRIBUTING.md)（贡献流程：commit / 分支 / PR）配合使用。规则均源自项目现有配置与约定，新增代码必须遵守，代码评审以此为准。

## 1. TypeScript 规范

编译器严格选项全开（`tsconfig.app.json` / `server/tsconfig.json`），**任何新代码不得弱化**：

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `strict` | `true` | 严格模式基线 |
| `noUnusedLocals` / `noUnusedParameters` | `true` | 未使用变量/参数报错（下划线 `_` 前缀豁免，与 ESLint 规则一致） |
| `noImplicitReturns` | `true` | 函数所有分支必须显式 return |
| `noFallthroughCasesInSwitch` | `true` | 禁止 switch 贯穿 |
| `noUncheckedSideEffectImports` | `true` | 副作用导入必须显式 |
| `target` / 构建目标 | `ES2020` | 前后端一致 |

类型书写约定：

- 优先 `interface`，联合类型/工具类型场景用 `type`。
- 禁用 `any`；确需放宽时使用 `unknown` + 类型守卫。
- 跨模块共享的业务类型统一定义在 `src/shared/types/index.ts`，feature 私有类型放在各自 `types.ts`。
- 路径别名：`@/*` → `src/*`（前端）；后端使用 `.js` 后缀的 ESM 相对导入（`import { db } from './db.js'`）。

## 2. 命名约定

| 对象 | 约定 | 示例 |
| --- | --- | --- |
| 组件文件 | `PascalCase.tsx` | `ArticleView.tsx` |
| 其他源文件 | `camelCase.ts` | `articleService.ts` |
| 组件 / 类型 / 接口 / 类 | `PascalCase` | `ReviewSessionView` |
| 变量 / 函数 / hook | `camelCase`，hook 以 `use` 开头 | `useArticleSpeech` |
| 常量 | `UPPER_SNAKE_CASE` | `MAX_RETRIES` |
| CSS 类名 | Tailwind utility 优先，自定义 `kebab-case` | `review-animations.css` |
| 数据库字段 | camelCase（`updated_at` 除外） | `nextReview` |
| localStorage key | `ydxl-` 前缀 | `ydxl-ai-usage`、`ydxl-ai-token-stats` |

## 3. 目录与模块边界

- `src/features/<domain>/`：按业务域垂直拆分（reading / wordbook / review / mastered / vocabulary / phrases / stats / profile），每个模块自包含 `components / pages / services / hooks / store / types`。
- **模块对外只经 `index.ts` 桶文件导出公共 API**；feature 之间禁止互相引用内部文件。
- 跨 feature 复用的代码一律下沉到 `src/shared/`（components / hooks / services / utils / types / i18n）。
- `server/` 为独立 npm 子包，前端不得直接 import 后端代码；两端共享的契约（字段命名、错误码结构）以文档与测试约束（见 `src/shared/services/ai/__tests__/ai-proxy-contract.test.ts` 模式）。

## 4. React 组件与 Hooks 规范

- 函数组件 + Hooks，禁止 class 组件（唯一例外：`ErrorBoundary`，React 目前无 hook 替代）。
- **useEffect 必须返回清理函数**（事件解绑、定时器清除、AbortController 中断、订阅取消），防止内存泄漏与组件卸载后 setState——这是项目硬性规则，评审重点检查。
- 组件内异步操作使用 AbortController / 挂载标记，卸载后不得更新状态。
- 公共 hook 放 `src/shared/hooks/`，feature 专属 hook 放模块 `hooks/` 目录。
- 状态管理：局部状态用 useState；跨组件共享用 Zustand store（`store.ts`，如 wordbook / review）；服务端数据经 Repository 层获取，不复制进 store。

## 5. 数据层规范

- **服务器为唯一权威数据源**：业务写入一律走 `localApi` → Express → SQLite；Dexie 仅作离线只读缓存，**禁止反向同步**。
- 数据访问必须通过 Repository 抽象（`src/shared/services/repositories.ts`），UI 组件禁止直接操作 Dexie 表或裸写 fetch。
- **查询必须走索引**：新增高频查询前先在 Dexie schema / SQLite 中补索引，禁止全表扫描后内存过滤（数据量大时不可接受）。
- 敏感数据（用户笔记等）入库必须走加密通道（服务端 AES-256-GCM `ENCRYPTED_COLUMNS`）；前端密钥经 `secureStorage` 加密存浏览器。
- 离线降级：fetch 失败回退 Dexie 缓存并触发 `ydxl:offline` 事件，禁止让离线错误冒泡成白屏。

## 6. 错误处理规范

- **禁止静默吞错**：catch 块要么处理（降级/重试/用户提示），要么 `console.warn/error` 记录后继续；空 catch 不允许。开发环境必须输出告警日志便于调试。
- 服务端：已知业务错误在路由内返回结构化 JSON（`{ error: { code, message } }`）；未知异常由全局错误处理中间件兜底，生产环境 message 脱敏。
- 前端 AI 调用错误统一抛 `AIError`（携带 code/status），由业务层决定降级路径（兜底素材库等），保证核心功能始终可用。

## 7. AI Provider 规范

- 所有 AI 调用统一经 `src/shared/services/ai/index.ts` 导出的 `aiProvider` 动态 Proxy 出口，**禁止绕过抽象直连供应商**。
- DeepSeek 模型使用 `deepseek-v4-pro` / `deepseek-v4-flash`（旧 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用）。
- JSON Output 模式必须同时显式设置 `response_format: { type: 'json_object' }` 与 `max_tokens`。
- **数组响应场景**（练习题、语法填空、词汇、短语、emoji 助记）必须跳过 `response_format`（部分平台不兼容导致 JSON 数组解析失败），对应缓存 key 追加 `:array` 变体隔离；custom 供应商 `jsonModeSupportsArray()` 固定返回 `false`。
- 降级链：自定义 API 优先，失败（网络/HTTP/超时/结果校验失败）自动回退 DeepSeek；**流式响应已输出 chunk 后禁止降级**（避免前端内容重复）。
- 使用记录必须带 `platform` 字段标记实际调用平台，各 provider 在自己的调用点记录。
- custom 的端点 / 模型与兜底供应商在 `config/ai-providers.json` 声明；内置供应商默认元数据在 `server/src/aiConfig.ts` 的 `DEFAULT_PROVIDERS`（JSON 的 `providers` 段可选覆盖）；内置供应商默认 / 轻量模型由 `AI_PROVIDER_META` 维护；密钥值只写服务端 `.env`，JSON 中只存变量名（`keyEnv`）。
- 自定义代理节点 SSRF 防护：服务端 `/v1/ai-proxy/custom` 只信任服务端 env 的 `CUSTOM_API_ENDPOINT`，**前端请求体不得透传任何 URL**；用户在个人中心自填的端点由浏览器直连，不经代理。

## 8. 服务端规范

- 表名 / 列名一律白名单校验（表名不可参数化），SQL 值一律参数化查询。
- 中间件顺序：CORS → JSON 解析（10mb）→ 全局限流（60/min/IP，豁免 `/api/health`）→ 路由（AI 代理独立限流 20/min/IP）→ 全局错误处理。
- AI 代理上游：超时 150s，网络错误与 5xx/429 指数退避重试（1s/2s，最多 2 次，优先 `Retry-After`，上限 30s）；所有响应禁用 HTTP 缓存头。
- 数据库变更遵守 `server/src/db.ts` 的「CREATE TABLE + PRAGMA 迁移」双写规范（见 [DATABASE.md](./DATABASE.md#38-迁移机制)）。

## 9. 环境变量与密钥

- 前端可见变量必须以 `VITE_` 前缀，**任何密钥不得使用 `VITE_` 前缀**（会打进公开 bundle）。
- 生产 `.env` 中 `VITE_CUSTOM_API_KEY` / `VITE_DEEPSEEK_API_KEY` 必须留空；密钥一律配置在服务端 `.env`。
- 新增环境变量必须同步更新 `.env.example` 注释与 README「环境变量说明」。

## 10. 性能要求

| 指标 | 目标 |
| --- | --- |
| 阅读界面响应 | ≤ 0.5s |
| 页面加载 | ≤ 3s |
| 交互响应 | ≤ 1s |

支撑手段（已有，勿破坏）：路由级 lazy loading + manualChunks 分包（recharts 独立 chunk）、PWA 预缓存、Dexie 缓存命中、SQLite WAL + updated_at 索引。AI 生成文章篇幅 200-300 词（初中水平，词汇不超中考大纲）。

## 11. i18n 与 UX

- 所有面向用户的文案使用 `useTranslation` + `zh-CN.json` / `en-US.json` 字典，**禁止硬编码中文字符串到组件**。
- 双语字典键必须同步维护，新增键两个语言文件都要补。
- 主题样式基于 Tailwind `darkMode: 'class'`，新组件需同时验证日/夜两种主题。

## 12. 测试规范

- 框架：vitest（前端 jsdom + Testing Library；后端 node 环境）。
- 测试文件放 `__tests__/` 目录，命名 `*.test.ts(x)`，路径与被测文件对应。
- 用例命名使用中文描述行为；一个用例只验证一个行为；`afterEach` 恢复 fetch mock。
- 前端 fetch mock 统一用 `src/test/setup.ts` 的 `installFetchMock` / `installFetchMockSequence` / `restoreFetch`。
- 提交前必须通过：`npm run typecheck`、`npm run lint`、`npm test`（前端）、`npm --prefix server test`（后端）、`npm run build`。
- 当前规模基线：前端 184 个测试文件 / 1613 用例，后端 22 个测试文件 / 216 用例——**新增功能必须带对应测试**，回归不得破坏既有用例。

## 13. 文档同步

代码行为变更时同步更新对应文档，避免文档与代码漂移：

| 变更类型 | 需更新 |
| --- | --- |
| 数据库表/字段/索引/迁移 | `docs/DATABASE.md`、`docs/ER_DIAGRAM.md` |
| REST / AI 代理端点 | `docs/API_REFERENCE.md` |
| 新 feature / 模块结构 | `docs/ARCHITECTURE.md`、README 项目结构 |
| 环境变量 | `.env.example`、README、`docs/DEPLOYMENT.md` |
| AI 供应商配置 | `config/ai-providers.json`、`docs/AI_API_CONFIGURATION.md` |
| 用户可感知功能 | `docs/USER_GUIDE.md`、README 功能特性 |
| 测试规模变化 | `docs/TESTING.md`、`CONTRIBUTING.md` |

## 相关文档

- [CONTRIBUTING.md](../CONTRIBUTING.md)：commit / 分支 / PR / Git hooks 流程
- [架构文档](./ARCHITECTURE.md)：分层架构与 AI Provider 抽象层设计
- [数据库设计](./DATABASE.md)：表结构与迁移规范
- [测试策略](./TESTING.md)：三层测试详解
