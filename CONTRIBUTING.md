# 贡献指南

感谢您考虑为 `ydxl` 英语学习应用贡献代码！本文档说明开发环境搭建、提交规范、分支命名、PR 流程与测试约定。

## 1. 开发环境搭建

### 环境要求

- **Node.js** >= 18（推荐 18 LTS 或 20 LTS）
- **npm** >= 9

> 版本要求与 `package.json` 的 `engines` 字段保持一致。运行 `node -v` 与 `npm -v` 查看当前版本，过低请先升级（推荐使用 [nvm](https://github.com/nvm-sh/nvm) 或 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理多版本）。

### 安装步骤

```bash
# 1. 克隆仓库
git clone <repo-url>
cd ydxl

# 2. 安装依赖
npm install

# 3. 配置环境变量（按需）
cp .env.example .env
# 编辑 .env 填入必要变量（参考 README.md「环境变量说明」章节）

# 4. 启动前端开发服务器
npm run dev
```

默认监听 `http://localhost:5173`。

### 后端服务器开发（可选）

如需修改后端 API 或数据库逻辑，可单独启动后端服务器：

```bash
# 启动 Express 服务器（监听 3001 端口，tsx 热重载）
npm run server:dev

# 或直接在 server 目录下运行
npm --prefix server run dev
```

前端 Vite 开发服务器会自动将 `/api` 请求代理到 `http://localhost:3001`，前后端可同时开发。后端代码位于 `server/` 独立子包，包含：

- `server/src/index.ts`：Express 应用入口（CORS / 限流 / 认证门 / 12 张表路由 / AI 代理 / 健康检查与登录限流）
- `server/src/routes.ts`：REST 路由工厂（`TABLES` 白名单 + `JSON_COLUMNS` 序列化 + 多用户数据隔离 + `POST /api/words/bulk` 批量端点）
- `server/src/db.ts`：SQLite 数据库初始化（12 张表 + WAL 模式 + 索引 + 增量迁移）
- `server/src/auth.ts` / `authRoutes.ts`：scrypt 密码哈希、不透明会话令牌与认证路由（登录 / 登出 / me / 改密 / 登录限流锁定 / 会话管理「我的设备」列出、移除、全端下线）
- `server/src/permissions.ts`：RBAC 权限矩阵与 requirePermission 授权中间件（P1）
- `server/src/adminRoutes.ts`：用户管理 API（users:manage）与审计日志查询/导出（logs:view）（P1/P2）
- `server/src/audit.ts`：审计日志写入/查询/CSV 渲染与 180 天归档清理（P2）
- `server/src/migrateMultiUser.ts`：单用户→多用户幂等数据迁移（备份 + 单事务 + `schema_meta` 标记）
- `server/src/ai-proxy.ts`：AI 代理端点（需登录；deepseek / openai / qwen / custom 四供应商 + `/stream` 流式变体；按 userId 计量限流 20 次/分钟/用户，`createAiProxyLimiter` 工厂，P3）
- `server/src/classStats.ts`：班级学情 SQL 聚合（`stats:class`，P3）
- `server/src/loadtest.ts`：性能压测脚本（纯 Node fetch 零依赖，`npm run loadtest`，默认 30 并发 / 300 请求，P3）
- `server/src/__tests__/`：后端测试（db / routes / 认证 / 数据隔离 / 数据迁移 / RBAC / 审计 / 限流 / CORS / 加密 / AI 代理契约 / 班级学情 / AI 配额 / 会话管理 等 16 个文件）

后端测试运行：

```bash
npm --prefix server test
```

### 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 生产构建（`tsc -b && vite build`） |
| `npm run preview` | 预览生产构建 |
| `npm run serve` | 预览生产构建（固定 4173 端口） |
| `npm run lint` | ESLint 检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 |
| `npm run typecheck` | TypeScript 类型检查（`tsc -b --noEmit`） |
| `npm test` | 运行前端测试（`vitest run`，后端见下方 `npm --prefix server test`） |
| `npm run test:watch` | 监听模式运行测试 |

## 2. Commit Message 规范

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范。每个 commit message 由 **类型**、**可选 scope**、**简短描述** 组成：

```
<type>(<scope>): <subject>
```

### 类型（type）

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `feat` | 新增功能 | `feat(reading): 支持按题材筛选文章` |
| `fix` | 错误修复 | `fix(server): 修复 SQLite 表创建字段缺失问题` |
| `docs` | 文档变更 | `docs(api): 更新 AI 代理请求体格式说明` |
| `style` | 代码格式（不影响功能） | `style(format): 统一缩进为 2 空格` |
| `refactor` | 重构（既非新增功能也非修复） | `refactor(ai): 抽取 BaseAIProvider 基类` |
| `test` | 新增 / 修改测试 | `test(server): 新增 7 张表 REST API 测试` |
| `chore` | 构建 / 工具链 / 杂项 | `chore(deps): 升级 vitest 到 4.1.9` |
| `perf` | 性能优化 | `perf(server): SQLite 启用 WAL 模式提升并发读` |

### Scope（可选）

Scope 用于说明变更影响的模块，常用值：

- `reading` / `wordbook` / `review` / `stats` / `profile` / `mastered` / `vocabulary` / `phrases`（features 模块）
- `ai`（AI Provider 抽象层，四供应商 + 降级兜底）
- `server`（后端 Express + SQLite）
- `pwa`（PWA 配置）
- `deps`（依赖升级）
- `config`（构建配置）

### 完整示例

```
feat(review): 新增顽固词徽章显示

- WordCard 显示 stubbornCount >= 3 的"顽固词"徽章
- 复习队列中顽固词优先级提升
- 新增 reviewService.getStubbornWords 方法

Closes #123
```

> 提示：详细描述（body）与 footer（如 `Closes #123`、`BREAKING CHANGE:`）为可选，简短变更可省略。

### BREAKING CHANGE 标记

破坏性变更需在 footer 显式标注：

```
feat(api)!: 重构 AI 代理端点路径为 /api/v1/ai-proxy/:provider

BREAKING CHANGE: 前端 VITE_AI_PROXY_URL 配置需更新为 /api，
旧路径 /api/ai-proxy/openai 改为 /api/v1/ai-proxy/openai
```

## 3. 分支命名

主分支为 `main`，所有开发在特性分支上进行。分支命名格式：

```
<type>/<scope>-<short-description>
```

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat/reading-topic-filter` |
| `fix` | Bug 修复 | `fix/server-table-schema` |
| `docs` | 文档 | `docs/architecture` |
| `chore` | 构建 / 依赖 / 杂项 | `chore/upgrade-vitest` |
| `refactor` | 重构 | `refactor/base-ai-provider` |
| `test` | 测试 | `test/server-routes` |

约定：

- 分支名使用小写字母、数字、连字符（kebab-case）
- 避免使用下划线、空格、中文
- 简短描述控制在 3-5 个单词
- 不要直接在 `main` 分支上提交

## 4. PR 流程

### 提交流程

1. **Fork 仓库**（如为外部贡献者）或创建本地特性分支
2. **基于最新 `main` 创建分支**：
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/<scope>-<description>
   ```
3. **编写代码**：遵循现有代码风格与目录结构约定（参考 README.md「项目结构说明」）
4. **本地验证**：确保以下检查全部通过
   ```bash
   npm run typecheck   # TypeScript 类型检查
   npm run lint        # ESLint 检查
   npm test            # 全部测试通过
   npm run build       # 生产构建成功
   ```
5. **提交变更**：按 commit message 规范提交，每个 commit 保持原子性（单一职责）
   ```bash
   git add <files>
   git commit -m "feat(<scope>): <subject>"
   ```
6. **推送分支**：
   ```bash
   git push origin feat/<scope>-<description>
   ```
7. **发起 Pull Request**：在 GitHub 上发起 PR，目标分支为 `main`
8. **填写 PR 描述**：说明变更内容、关联 issue、测试方式、破坏性变更（如有）
9. **等待 CI 通过**：[.github/workflows/ci.yml](./.github/workflows/ci.yml) 自动运行 5 个 job——前端 `typecheck` / `lint` / `test`，服务端 `build` + `test`，以及前端生产 `build`
10. **代码审查**：至少一名 reviewer 审查通过
11. **合并**：squash merge 或 rebase merge（由 maintainer 决定）

### PR 描述模板

```markdown
## 变更说明

<!-- 简要说明本 PR 做了什么、为什么 -->

## 变更类型

- [ ] feat（新功能）
- [ ] fix（Bug 修复）
- [ ] docs（文档）
- [ ] refactor（重构）
- [ ] test（测试）
- [ ] chore（构建 / 依赖）
- [ ] perf（性能）

## 关联 Issue

Closes #<issue-number>

## 测试方式

<!-- 说明如何测试本次变更 -->

## 破坏性变更

- [ ] 无破坏性变更
- [ ] 有破坏性变更（已在下方说明）

<!-- 如有破坏性变更，请说明迁移方式 -->

## 检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm test` 全部通过
- [ ] `npm run build` 成功
- [ ] 新增功能有对应测试
- [ ] 文档已更新（如需要）
```

## 5. 测试约定

### 测试框架

本项目使用 [vitest](https://vitest.dev/) 作为测试框架，配合 [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/) 与 [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) 进行组件测试。

### 运行测试

```bash
npm test                  # 一次运行前端测试（vitest）
npm --prefix server test  # 运行后端测试（server/src/__tests__）
npm run test:watch        # 监听模式（开发时使用）
```

### 测试规范

- 测试文件位于 `__tests__/` 目录下，命名 `*.test.ts` 或 `*.test.tsx`
- 使用 vitest 全局 API：`describe` / `it` / `test` / `expect` / `beforeEach` / `afterEach`（无需 import）
- 每个测试用例独立，避免共享状态；`afterEach` 自动恢复 fetch mock
- 使用 `src/test/setup.ts` 提供的 fetch mock 工具（`installFetchMock` / `installFetchMockSequence` / `restoreFetch`）

详细测试策略见 [docs/TESTING.md](./docs/TESTING.md)。

### 新增测试规范

1. 测试文件路径与被测文件对应：`src/<module>/<file>.ts` → `src/<module>/__tests__/<file>.test.ts`
2. 测试用例命名使用中文描述，清晰表达测试意图
3. 一个测试用例只验证一个行为
4. 使用 `it` 或 `test` 均可，但同一文件内保持一致
5. 异步测试使用 `async/await` 而非 Promise 链

### 测试覆盖范围

当前共 **68 个测试文件（前端 57 个 + 后端 11 个），821 个用例**，覆盖：

**前端（57 个文件）**

- AI Provider 抽象层（14 个文件）：多供应商路由/动态切换/自动兜底降级链/流式重试/JSON 数组容错（`json_object` 门控、对象包装解包）/响应缓存/Token 统计/前后端代理契约一致性
- 阅读特性（19 个文件）：文章生成与 SHA-256 去重、题目与语法填空生成、一键打印工作表（含自动补题降级）、朗读控制、词汇/短语、相关推荐、历史记录
- 五步背诵与 SM-2 加权算法、生词本服务与 store、统计与成就规则、词汇/短语/已掌握汇总
- 认证服务（authService）：登录持久化、换账号清空 Dexie 缓存、登出兜底
- 通用层：ErrorBoundary、暗色模式、在线状态、i18n、secureStorage、`CachedRemoteRepository` 离线降级、端到端业务流（e2e-flow / crossModuleFlow / offlineScenario）

**后端（11 个文件）**

- SQLite 表创建与 CRUD、REST 路由（含边界与分页）、认证（登录 / 锁定 / 会话）、多用户数据隔离、单用户→多用户数据迁移、限流、CORS 白名单、AES-256-GCM 加密
- AI 代理契约（上游转发/校验/错误映射）

完整清单见 [docs/TESTING.md](./docs/TESTING.md) 第 7 节。

## 6. lint-staged 与 husky 工作流

本项目使用 [husky](https://typicode.github.io/husky/) 管理 Git hooks，[lint-staged](https://github.com/lint-staged/lint-staged) 对暂存文件执行 lint 与格式化。

### pre-commit 钩子

每次 `git commit` 触发 `pre-commit` 钩子，自动执行 lint-staged：

```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ]
  }
}
```

执行流程：

1. `git commit` 触发 `.husky/pre-commit` 脚本
2. 脚本调用 `npx lint-staged`，对暂存的 `*.ts` / `*.tsx` 文件执行：
   - `eslint --fix`：自动修复可修复的 lint 错误
   - `prettier --write`：格式化代码
3. **钩子失败阻止 commit**：若 eslint 报错无法自动修复（如未使用变量、类型错误），commit 会被拒绝
4. 修复后重新 `git add` 与 `git commit`

### 钩子失败处理

如果 pre-commit 钩子阻止了 commit：

```bash
# 1. 查看 lint 错误
npm run lint

# 2. 自动修复
npm run lint:fix

# 3. 格式化
npm run format

# 4. 重新 add 与 commit
git add <fixed-files>
git commit -m "..."
```

### 跳过钩子（紧急情况）

> ⚠️ **不推荐**：跳过钩子可能导致代码质量下降，仅在生产环境紧急修复时使用。

```bash
git commit --no-verify -m "..."
```

### 提交前自查清单

提交前请确保：

- [ ] `npm run typecheck` 通过（TypeScript 类型检查）
- [ ] `npm run lint` 通过（ESLint 检查）
- [ ] `npm test` 全部测试通过
- [ ] `npm run build` 成功（生产构建）
- [ ] 新增功能有对应测试
- [ ] commit message 符合 Conventional Commits 规范
- [ ] 不提交 `.env` / 密钥 / 大文件

## 7. 代码风格

### TypeScript / React

- 严格模式（`strict: true`）
- 函数组件 + Hooks，避免 class 组件（ErrorBoundary 除外）
- 优先 `interface` 而非 `type`，需联合类型时使用 `type`
- 公共 API 通过 `index.ts` 桶文件导出
- 模块间不互相直接引用内部文件，通过 `index.ts` 暴露公共 API

### 命名约定

- 文件名：组件 `PascalCase.tsx`（如 `ArticleView.tsx`）、其他 `camelCase.ts` / `kebab-case.ts`
- 变量 / 函数：`camelCase`
- 类型 / 接口 / 类：`PascalCase`
- 常量：`UPPER_SNAKE_CASE`
- CSS 类名：Tailwind utility class 优先，自定义类 `kebab-case`

### 目录结构

参考 README.md「项目结构说明」章节。特性模块按业务域垂直拆分，每个模块自包含 `components / pages / services / hooks / types / store`。

## 8. 如何新增 AI Provider

AI 供应商抽象层位于 `src/shared/services/ai/`，采用**模板方法模式**：公共逻辑（并发限流、指数退避重试、缓存与请求去重、流式解析、JSON 容错、Token 统计、AI 来源追踪）全部内置于基类 `BaseAIProvider`，每个供应商只需实现差异化方法。

> **先确认是否真的需要新增**：如果目标平台是任意「OpenAI Chat Completions 兼容」端点（如 SiliconFlow、OpenRouter、各类中转站），无需写代码——现有 `custom` 供应商已支持用户在「个人中心 → AI 设置」运行时配置端点 / 模型 / 密钥。仅当需要为**固定上游平台**（有固定端点与官方模型、需内置模型分级、需接入代理模式）添加一等公民支持时，才按本章流程新增。

以新增供应商 `zhipu`（示例名）为例，完整流程如下：

### 8.1 类型与元数据注册（types.ts）

编辑 [src/shared/services/ai/types.ts](./src/shared/services/ai/types.ts)：

1. `AIProviderName` 联合类型追加 `'zhipu'`
2. `AI_PROVIDER_META` 注册表追加条目（单一事实来源，ProfilePage 下拉框 / 工厂默认值 / 文档均由此派生）：

```typescript
export type AIProviderName = 'deepseek' | 'openai' | 'qwen' | 'custom' | 'zhipu'

export const AI_PROVIDER_META: Record<AIProviderName, AIProviderMeta> = {
  // ...既有条目...
  zhipu: {
    label: '智谱',                        // UI 显示名
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-5',               // 高质量模型（文章/题目生成）
    flashModel: 'glm-5-flash',           // 轻量模型（翻译/emoji 等简单任务）；不支持分级填 null
    keyConsoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    supportsJsonMode: true,              // 是否支持 response_format: json_object
  },
}
```

> 由于 `PROVIDER_API_KEY_ENV` / `PROVIDER_MODEL_ENV` 等映射的类型为 `Record<Exclude<AIProviderName, 'custom'>, ...>`，追加联合成员后 `npm run typecheck` 会**强制报错**提示所有待补注册点——可据此逐一补齐，不会遗漏。

### 8.2 实现 Provider 类（新建 `<name>Provider.ts`）

新建 `src/shared/services/ai/zhipuProvider.ts`，继承 `BaseAIProvider`，**必须实现 5 个方法**：

```typescript
import type { ChatMessage } from './types'
import { BaseAIProvider } from './baseProvider'
import { AI_PROVIDER_META } from './types'

export class ZhipuProvider extends BaseAIProvider {
  providerName(): 'zhipu' {
    return 'zhipu'
  }

  defaultEndpoint(): string {
    return AI_PROVIDER_META.zhipu.endpoint
  }

  protected defaultModel(): string {
    return AI_PROVIDER_META.zhipu.defaultModel
  }

  // 构造上游请求体（OpenAI 兼容协议可参考 deepseekProvider.ts 的实现）
  buildRequestBody(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number
      thinkingDisabled?: boolean
      modelOverride?: string
      reasoningEffort?: 'high' | 'max'
      temperature?: number
    }
  ): unknown {
    const body: Record<string, unknown> = {
      model: options?.modelOverride ?? this.model,
      messages,
    }
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options?.temperature !== undefined) body.temperature = options.temperature
    return body
  }

  // 从响应中提取助手消息内容（OpenAI 兼容：choices[0].message.content）
  parseContent(data: unknown): string {
    return (
      (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message
        ?.content ?? ''
    )
  }
}
```

可按需覆盖的可选方法（均有基类默认行为）：

| 方法 | 用途 | 默认行为 |
| --- | --- | --- |
| `getFlashModel()` | 模型分级：翻译 / emoji / 例句等简单任务降级用轻量模型省成本 | 返回 `undefined`（即不分级的平台无需覆盖，统一使用默认模型）；支持分级时覆盖返回轻量模型名 |
| `jsonModeSupportsArray()` | 数组型响应场景（练习题 / 词汇 / 短语等）是否可带 `response_format: json_object` | 返回 `true`（OpenAI 兼容平台无需覆盖）；不支持时覆盖为 `false`，否则数组解析会报错 |
| `usagePlatformLabel()` | AI 使用记录中的平台标识（个人中心鼠标悬停展示） | 返回 `AI_PROVIDER_META` 中的 `label`（custom 覆盖为按端点 URL 推断平台名） |
| `getFetchTimeoutMs()` | 单次请求超时 | 170000ms（170s） |

> 密钥解析链无需关心：显式 `apiKey`（env / 连接测试传入）优先，其次 `keyResolver`（请求时点异步读取 secureStorage 中用户保存的密钥），由工厂在构造时注入。

### 8.3 工厂注册（index.ts）

编辑 [src/shared/services/ai/index.ts](./src/shared/services/ai/index.ts)，共 **8 处**。其中第 2-4 处为 `Record` 类型映射，漏加时 `npm run typecheck` 会直接报错；其余为 switch 分支与白名单，需对照本清单逐一补齐：

1. 顶部 import 区：`import { ZhipuProvider } from './zhipuProvider'`
2. `PROVIDER_API_KEY_ENV`：追加 `zhipu: env.VITE_ZHIPU_API_KEY`
3. `PROVIDER_MODEL_ENV`：追加 `zhipu: env.VITE_ZHIPU_MODEL`
4. `LS_KEY_SECURE_API_KEY`：追加 `zhipu: 'ydxl-ext-ai-api-key-zhipu'`
5. `parseProviderName` 白名单：追加 `value === 'zhipu'` 分支
6. `createAIProvider` switch：追加 `case 'zhipu': base = new ZhipuProvider(buildBaseConfig(name)); break`
7. `buildFallbackProvider` switch（可选，允许该供应商作为兜底上游时）：追加对应 case
8. `createAIProviderByName` switch（连接测试专用工厂）：追加对应 case

> `buildBaseConfig` 无需修改：其参数类型为 `Exclude<AIProviderName, 'custom'>`，新增非 custom 成员后自动纳入「代理模式 / 直连模式」双路由逻辑。

### 8.4 个人中心 UI（useProfileSettings.ts + ProfilePage.tsx）

编辑 [src/features/profile/hooks/useProfileSettings.ts](./src/features/profile/hooks/useProfileSettings.ts)（与 index.ts 的 `LS_KEY_SECURE_API_KEY` 保持一致）：

1. 追加密钥存储常量：`const LS_KEY_AI_API_KEY_ZHIPU = 'ydxl-ext-ai-api-key-zhipu'`
2. 在按供应商名解析 secureStorage key 的 switch 中追加 `zhipu` 分支

再编辑 [src/features/profile/pages/ProfilePage.tsx](./src/features/profile/pages/ProfilePage.tsx)「AI 供应商选择」下拉框，追加选项：

```tsx
<option value="zhipu">智谱 GLM</option>
```

> ⚠️ 供应商下拉框为**静态 `<option>` 列表**（并未从 `AI_PROVIDER_META` 派生），且 `value` 经 `as` 断言转换，**漏加时 typecheck 不会报错**——只能靠人工对照本清单，否则 UI 无法选择新供应商。custom 的端点/模型输入框由 `aiProviderType === 'custom'` 条件渲染控制，新增普通供应商无需额外 UI。

### 8.5 单一配置源（config/ai-providers.json）

编辑 [config/ai-providers.json](./config/ai-providers.json)，在 `providers` 注册表追加条目（服务端 `aiConfig.ts` 的 `getProviderMeta` 由此派生，JSON 只存**变量名**，密钥值只写服务端 `.env`）：

```json
{
  "providers": {
    "zhipu": {
      "endpoint": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      "model": "glm-5",
      "flashModel": "glm-5-flash",
      "keyEnv": "ZHIPU_API_KEY",
      "allowedModels": ["glm-5", "glm-5-flash"]
    }
  }
}
```

字段说明：

- `keyEnv`：服务端密钥的**环境变量名**（前端直连镜像为 `VITE_ZHIPU_API_KEY`）
- `allowedModels`：模型白名单，防止恶意构造请求体触发计费

### 8.6 服务端 AI 代理注册（ai-proxy.ts）

编辑 [server/src/ai-proxy.ts](./server/src/ai-proxy.ts)，在 `UPSTREAMS` 注册表追加条目（追加后 `/v1/ai-proxy/zhipu` 与 `/v1/ai-proxy/zhipu/stream` 路由**自动注册**）：

```typescript
const UPSTREAMS: Record<string, UpstreamConfig> = {
  // ...既有条目...
  zhipu: {
    endpoint: getProviderMeta('zhipu').endpoint!,
    envKeyName: getProviderMeta('zhipu').keyEnv!,
    allowedModels: getProviderMeta('zhipu').allowedModels!,
  },
}
```

### 8.7 环境变量（.env.example）

编辑 [.env.example](./.env.example)，参照 deepseek 段落追加：

```bash
# 智谱配置（前端直连时使用；走代理模式则仅服务端需要 ZHIPU_API_KEY）
VITE_ZHIPU_API_KEY=
# 模型覆盖（可选，默认取 config/ai-providers.json 的 model）
VITE_ZHIPU_MODEL=

# 服务端密钥（代理模式使用）
ZHIPU_API_KEY=
```

> `vite.config.ts` 启动时读取 `config/ai-providers.json` 自动注入部分前端默认变量（如 fallback 配置），providers 条目本身无需在 vite.config.ts 注册。

### 8.8 测试与验证

1. **新增测试**：在 `src/shared/services/ai/__tests__/` 添加 `zhipuProvider.test.ts`，参考 `multiProvider.test.ts`（多供应商路由）与 `ai-proxy-contract.test.ts`（前后端代理契约一致性）的既有用例，至少覆盖：请求体构造、响应解析、与 `AI_PROVIDER_META` 的一致性
2. **全量验证**：

```bash
npm run typecheck   # Record 类型强制校验所有注册点已补齐（仅覆盖前端）
npm run lint
npm test                  # 前端全量测试（vitest，仅覆盖 src/**）
npm --prefix server test  # 后端全量测试（含 AI 代理契约测试，覆盖 UPSTREAMS 注册）
npm run build
npm --prefix server run build  # 服务端 tsc 编译（服务端无独立 typecheck 脚本，类型检查由 build 承担）
```

> 注意两点：① 服务端 `UPSTREAMS`（8.6）键类型为宽泛的 `Record<string, UpstreamConfig>`，**漏加时 tsc 不会报错**，需人工对照；② 新增供应商本身不会破坏任何既有测试（已实测验证），但按第 1 点补测试后需同步 8.9 的测试计数。

3. **手工验证**：启动 `npm run dev` + `npm run server:dev`，在「个人中心 → AI 设置」选择新供应商，填入密钥后「测试连接」，再实际生成一篇文章验证代理模式与直连模式均正常。

### 8.9 文档同步

按「文档与源码保持一致」的项目约定，同步更新：

- [docs/AI_API_CONFIGURATION.md](./docs/AI_API_CONFIGURATION.md)：`config/ai-providers.json` 注册表速查追加 `providers.zhipu` 条目，第四节「修改内置供应商」清单同步
- [docs/API_REFERENCE.md](./docs/API_REFERENCE.md)：新增 `/v1/ai-proxy/zhipu`（含 `/stream`）端点说明
- [docs/TESTING.md](./docs/TESTING.md)：第 7 节测试清单追加 `zhipuProvider.test.ts` 行，并更新前端 / 总测试文件数与用例数统计
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)：架构图中 ai-proxy 供应商枚举与「四供应商」表述同步为新数量
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)：第 2 节环境变量矩阵追加新供应商的 `VITE_<NAME>_API_KEY` 与服务端 `<NAME>_API_KEY` 行，`VITE_AI_PROVIDER` 取值枚举同步
- [docs/USER_GUIDE.md](./docs/USER_GUIDE.md)：「DeepSeek / OpenAI / 通义千问 / 自定义模型」四类供应商枚举（AI 设置相关章节）同步为新数量
- [README](./README.md)：环境变量说明追加新供应商变量
- [docs/OPERATIONS.md](./docs/OPERATIONS.md)（新供应商实际启用时）：供应商控制台清单（3.1 每周检查）与 AI 成本表（6.3）追加该供应商
- [docs/LINUX_DEPLOY.md](./docs/LINUX_DEPLOY.md)（新供应商实际启用时）：`.env` 密钥配置示例追加该供应商段落
- [CHANGELOG](./CHANGELOG.md)：以 `feat(ai):` 条目记录

> docs/README.md 文档索引无需改动（未新增文档文件）；PROJECT_ANALYSIS_REPORT.md 为历史快照不改；AI_TOKEN_OPTIMIZATION.md / TECHNICAL_ANALYSIS.md 属机制与成本分析，仅当新供应商纳入优化建议时按需更新。若供应商枚举还出现在其他文档，按 [CODING_STANDARDS 第 13 节](./docs/CODING_STANDARDS.md) 对照表随改随修。

## 9. 相关文档

- [README](./README.md)：项目概述与快速开始
- [开发规范](./docs/CODING_STANDARDS.md)：TypeScript / React / 数据层 / 安全 / AI Provider 编码规范
- [架构文档](./docs/ARCHITECTURE.md)：分层架构与数据流
- [数据库设计](./docs/DATABASE.md)：表结构、索引、迁移与加密
- [API 参考](./docs/API_REFERENCE.md)：REST / AI 代理端点与核心类型
- [测试策略](./docs/TESTING.md)：三层测试策略与完整覆盖清单
- [文档索引](./docs/README.md)：全部文档导航
- [变更日志](./CHANGELOG.md)：版本变更记录
