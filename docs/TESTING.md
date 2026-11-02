# 测试策略

本文档说明 `ydxl` 项目的测试策略、运行命令、覆盖率目标、fetch mock 模式与 vitest 配置。

## 1. 三层测试策略

项目采用**单元测试 + 集成测试 + E2E 测试**三层测试金字塔，当前重心在单元测试与集成测试，E2E 测试为未来计划。

### 1.1 单元测试

**目标**：验证纯函数与工具类的正确性，隔离外部依赖。

| 测试文件 | 被测对象 | 覆盖点 |
| --- | --- | --- |
| `src/shared/services/ai/__tests__/ai-provider.test.ts` | `BaseAIProvider.callChat`（DeepSeek 为主） | 超时抛 `AIError('请求超时（170s）')`、5xx 重试 2 次（指数退避 1s/2s）、4xx 不重试立即抛错、429 按 Retry-After 动态退避 |
| `src/features/review/services/__tests__/sm2.test.ts` | `sm2` 加权算法 | 三环节加权输入（炼 0.3 / 拼 0.3 / 写 0.4）、ease factor 计算、stabilityScore 返回、easeFactor/interval clamp 边界（1.3 ≤ easeFactor ≤ 3.0、interval ≤ 365） |
| `src/features/wordbook/services/__tests__/wordbookService.test.ts` | `wordbookService`（生词本服务） | enrichWord 占位值检测（`/-/`、`未知`、`暂未收录`）、addToWordbook 的 `enrichIfMissing` 参数（AI 补全触发 / best-effort 失败兜底） |
| `src/features/review/utils/__tests__/phonetics.test.ts`（如存在） | `estimateSyllables` | 音节数估算 |
| `src/features/stats/services/__tests__/achievementService.test.ts` | `achievementService.checkAndUnlockAchievements` | 成就规则判断逻辑 |
| `src/features/review/services/__tests__/reviewService.test.ts` | `reviewService.getStubbornWords` 等 | 顽固词识别（`stubbornCount >= 3`）等 |

### 1.2 集成测试

**目标**：验证跨层流程，多个模块协作完成一个完整业务场景。

| 测试文件 | 验证流程 | 覆盖点 |
| --- | --- | --- |
| `src/features/reading/services/__tests__/articleService.integration.test.ts` | `articleService` → `AIProvider` → `CachedRemoteRepository` 端到端 | AI 生成文章 → 写入服务器 SQLite → 读取验证；含 AI 不可用时 fallback 降级到兜底素材库 |
| `src/shared/services/ai/__tests__/ai-proxy-contract.test.ts` | 前端 Provider ↔ 后端 `server/src/ai-proxy.ts` 契约 | DeepSeek 在代理模式下发送的请求体格式（`{ provider, body }` 信封）与后端解析一致 |
| `src/shared/components/__tests__/ErrorBoundary.test.tsx` | ErrorBoundary 子组件异常捕获 | 子组件抛错时显示恢复 UI（"刷新页面" / "返回首页"按钮）而非白屏 |

### 1.3 E2E 测试（Playwright，三种模式）

E2E 位于根目录 `e2e/`，由 `playwright.config.ts` 按 npm 脚本区分三种模式：

| 命令 | 启动方式 | 拦截 / 真实后端 | 覆盖 |
| --- | --- | --- | --- |
| `npm run test:e2e` | vite dev（5173） | `page.route` 返回 fixture | 阅读 / 复习 / 离线回退 / 生词本 / 打印 / 多用户切换 / 无障碍基线（`a11y.spec.ts`）/ 移动端窄屏回归（`mobile.spec.ts`） |
| `npm run test:e2e:real` | 真实 Express（3001，临时 SQLite）+ vite dev | **不拦截 `/api`**（真实登录、读写） | `real-backend.spec.ts`：登录 → 阅读 → 标记已读 → 历史 → 生词本 → 复习队列；错误密码 401 文案 |
| `npm run test:e2e:sw` | vite build + vite preview（4173） | `context.route`（覆盖 SW 透传） | 生产构建下 Service Worker 预缓存离线整页重载 |

- 真实后端模式使用独立临时库 `.e2e-tmp/real-backend.db`（每次运行重建，已 gitignore），管理员由 `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD` 引导创建；AI 密钥清空，主链路不依赖外网。
- 真实后端模式调高 `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX`，避免单浏览器高频请求触发测试自身 429。
- 无障碍基线（`a11y.spec.ts`）：首个 Tab 聚焦「跳到主要内容」并可跳转 `#main-content`；导航具名且当前页 `aria-current="page"`；弹窗打开即聚焦内部控件、Tab / Shift+Tab 不逃逸、Escape 关闭后焦点回到触发按钮。
- 移动端回归（`mobile.spec.ts`）：`test.use({ viewport })` 模拟 375×667 与 320×568，断言顶部导航隐藏、底部 Tab 五项可见、Tab 跳转生词本后 `aria-current` 更新，且页面 `scrollWidth` 无横向溢出。

## 2. 运行命令

| 命令 | 作用 | 适用场景 |
| --- | --- | --- |
| `npm test` | 一次运行前端所有测试 | CI / 提交前验证 |
| `npm --prefix server test` | 运行后端所有测试 | CI / 提交前验证 |
| `npm run test:watch` | 监听模式，文件变更自动重跑 | 开发时迭代 |
| `npm run typecheck` | TypeScript 类型检查（`tsc -b --noEmit`） | 提交前验证 |
| `npm run lint` | ESLint 检查 | 提交前验证 |
| `npm run lint:fix` | ESLint 自动修复 | 开发时修复 |
| `npm run build` | 生产构建（含 `tsc -b` 类型检查） | 提交前验证 |
| `npm run docs:verify` | 校验文档声明的测试文件数 / 表数量与代码实际值一致 | CI / 修改文档数值后 |

### 只运行单个测试文件

```bash
npx vitest run src/shared/services/ai/__tests__/ai-provider.test.ts
```

### 只运行匹配模式的测试

```bash
npx vitest run -t "超时"
```

### 查看 UI 测试

vitest 默认不打开浏览器，但 `@testing-library/react` 在 jsdom 环境下渲染组件。如需查看渲染结果，可在测试中使用 `screen.debug()` 输出 DOM。

## 3. 覆盖率目标

> **当前状态**：暂未配置覆盖率工具，未来计划引入 [c8](https://github.com/bcoe/c8) 或 [istanbul](https://istanbul.js.org/)。

| 模块 | 目标覆盖率 | 优先级 |
| --- | --- | --- |
| 核心服务层（`localApi.ts` / `baseProvider.ts` / `sm2.ts` / `reviewService.ts`） | >= 80% | 高 |
| UI 组件（`features/*/components/`） | >= 60% | 中 |
| 整体 | >= 70% | 基线 |

未来引入覆盖率工具后，将在 `vitest.config.ts` 中配置：

```ts
test: {
  coverage: {
    provider: 'v8',  // 或 'istanbul'
    reporter: ['text', 'html', 'lcov'],
    thresholds: {
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
  },
}
```

## 4. fetch mock 模式

`src/test/setup.ts` 提供三个 fetch mock 工具函数，迁移自原 `ai-provider.test.ts` 与 `ai-proxy-contract.test.ts` 中的重复实现。所有工具在 `afterEach` 中自动恢复 `globalThis.fetch`，避免测试间状态泄漏。

### 4.1 `installFetchMock(response)`

**用途**：每次 `fetch` 调用都返回相同的 `response`，适合单次请求场景。

**返回**：`FetchCall[]` 数组，记录每次 fetch 调用的 `url` / `method` / `headers` / `body`，供断言使用。

**示例**：

```ts
import { installFetchMock } from '@/test/setup'

it('正常返回 AI 内容', async () => {
  const calls = installFetchMock({
    ok: true,
    status: 200,
    json: {
      choices: [{ message: { content: '{"title":"Hello"}' } }],
    },
  })

  const result = await aiProvider.generateArticle('2026-07-05')

  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
  expect(result.title).toBe('Hello')
})
```

### 4.2 `installFetchMockSequence(responses)`

**用途**：每次 `fetch` 调用依次返回 `responses` 数组中的下一个响应，适合重试场景（第一次失败、第二次成功）。超出数组长度时复用最后一个响应。

**示例**：

```ts
import { installFetchMockSequence, installImmediateSetTimeout } from '@/test/setup'

it('5xx 自动重试 2 次后抛错', async () => {
  installImmediateSetTimeout()  // 跳过指数退避等待
  installFetchMockSequence([
    { ok: false, status: 500, statusText: 'Internal Server Error' },
    { ok: false, status: 500, statusText: 'Internal Server Error' },
    { ok: false, status: 500, statusText: 'Internal Server Error' },
  ])

  await expect(aiProvider.generateTranslation('hello')).rejects.toThrow(/HTTP 500/)
})
```

### 4.3 `restoreFetch()`

**用途**：手动恢复原始 `fetch`。通常无需调用，`afterEach` 已自动恢复。

### 4.4 `installImmediateSetTimeout()`

**用途**：将所有 `setTimeout` 延迟为立即触发，跳过 170s 超时等待与指数退避等待（1s/2s），加速超时 / 重试相关测试。

**返回**：restore 函数，须在 `finally` 中调用恢复。

**示例**：

```ts
import { installFetchMock, installImmediateSetTimeout } from '@/test/setup'

it('超时抛 AIError', async () => {
  const restore = installImmediateSetTimeout()
  try {
    installFetchMock({ neverResolve: true })
    await expect(aiProvider.generateTranslation('hello')).rejects.toThrow('请求超时（170s）')
  } finally {
    restore()
  }
})
```

### 4.5 MockResponse 字段说明

```ts
interface MockResponse {
  ok?: boolean             // 默认 true
  status?: number          // 默认 200（ok=true）或 500（ok=false）
  statusText?: string      // 默认 'OK' 或 'Internal Server Error'
  json?: unknown           // 作为 res.json() 的返回值
  text?: string            // 作为 res.text() 的返回值
  neverResolve?: boolean   // 永不 resolve（用于测试超时，依赖 AbortController 触发拒绝）
}
```

`neverResolve: true` 时 Promise 永不 resolve，等待 `AbortController.signal` 触发 `AbortError` 拒绝，模拟真实 fetch 行为。

## 5. vitest 配置

配置文件：`vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'import.meta.env': '{}',
  },
})
```

### 配置说明

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| `plugins` | `[react()]` | 复用 Vite React 插件支持 JSX 转换 |
| `test.environment` | `'jsdom'` | 使用 jsdom 模拟 DOM，支持 React 组件测试 |
| `test.globals` | `true` | 启用全局 API（`describe` / `it` / `test` / `expect` / `beforeEach` / `afterEach`），无需在每个文件 import |
| `test.setupFiles` | `['./src/test/setup.ts']` | 全局测试初始化：注册 jest-dom matcher、提供 fetch mock 工具、`afterEach` 恢复 fetch |
| `test.include` | `['src/**/__tests__/**/*.test.{ts,tsx}']` | 测试文件匹配模式：位于 `__tests__/` 目录下，扩展名 `.test.ts` 或 `.test.tsx` |
| `test.testTimeout` | `15000`（默认 5000） | 单用例超时：jsdom 重型组件用例常态耗时 2-4s，5s 默认值在高负载 / CI 慢机上会偶发超时失败 |
| `resolve.alias['@']` | `path.resolve(__dirname, './src')` | 与 Vite 配置一致的 `@` 路径别名 |
| `define['import.meta.env']` | `'{}'` | 显式注入 `import.meta.env` 为空对象，业务代码访问 `VITE_X` 变量时返回 `undefined`（与未配置环境变量时行为一致，由 `ai/index.ts` 降级处理） |

> **注意**：vitest 不读取 `.env` 文件，所有 `VITE_X` 变量在测试中为 `undefined`。如需特定环境变量，可在测试中通过 `vi.stubEnv` 注入，或在 `vitest.config.ts` 的 `define` 中显式设置。

## 6. 新增测试的规范

### 6.1 文件位置与命名

- 测试文件位于被测文件同级的 `__tests__/` 目录下
- 命名 `*.test.ts`（纯逻辑测试）或 `*.test.tsx`（React 组件测试）
- 文件名与被测文件对应：`src/<module>/<file>.ts` → `src/<module>/__tests__/<file>.test.ts`

**示例**：

```
src/shared/services/ai/baseProvider.ts
src/shared/services/ai/__tests__/ai-provider.test.ts

src/shared/components/ErrorBoundary.tsx
src/shared/components/__tests__/ErrorBoundary.test.tsx
```

### 6.2 测试用例规范

- 使用 vitest 全局 API：`describe` / `it` / `test` / `expect` / `beforeEach` / `afterEach`（无需 import）
- 测试用例命名使用中文描述，清晰表达测试意图
- 一个测试用例只验证一个行为
- 使用 `it` 或 `test` 均可，但同一文件内保持一致
- 异步测试使用 `async/await` 而非 Promise 链
- 每个测试用例独立，避免共享状态；`afterEach` 自动恢复 fetch mock

**示例**：

```ts
describe('DeepSeekProvider', () => {
  describe('直连模式', () => {
    it('请求 URL 为上游端点且携带 Authorization 头', async () => {
      const calls = installFetchMock({
        json: { choices: [{ message: { content: '{"title":"Hello"}' } }] },
      })

      await aiProvider.generateArticle('2026-07-05')

      expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
      expect(calls[0].headers['Authorization']).toMatch(/^Bearer /)
    })
  })
})
```

### 6.3 异步测试

```ts
it('超时抛 AIError', async () => {
  const restore = installImmediateSetTimeout()
  try {
    installFetchMock({ neverResolve: true })
    await expect(aiProvider.generateTranslation('hello')).rejects.toThrow('请求超时（170s）')
  } finally {
    restore()
  }
})
```

### 6.4 React 组件测试

使用 `@testing-library/react` 的 `render` / `screen` / `fireEvent` / `userEvent`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '../ErrorBoundary'

it('子组件抛错时显示恢复 UI', () => {
  const Throw = () => { throw new Error('boom') }
  render(
    <ErrorBoundary>
      <Throw />
    </ErrorBoundary>
  )
  expect(screen.getByText(/刷新页面/)).toBeInTheDocument()
  expect(screen.getByText(/返回首页/)).toBeInTheDocument()
})
```

`@testing-library/jest-dom` 的 matcher（如 `toBeInTheDocument`）已在 `setup.ts` 中全局注册，无需 import。

## 7. 当前测试覆盖

共 **227** 个测试文件（前端 **203** 个 + 后端 **24** 个），约 **2011** 个用例（前端 1764 + 后端 247）；另有 **10** 个 Playwright E2E spec（fixture / 真实后端 / service worker 三种模式，含无障碍与移动端回归）。

### 7.1 前端测试分布（src/，203 个文件）

| 范围 | 文件数 | 主要覆盖 |
| --- | --- | --- |
| `shared/services/ai` | 31 | 多供应商（DeepSeek/OpenAI/Qwen/Custom）路由与模型分级、动态 Proxy 免刷新切换、Fallback 分级降级、JSON 模式门控与解析容错、缓存与 Token 统计、Web Chat 混合调度 |
| `features/reading` | 48 | 文章生成与 contentHash 去重、题目/语法填空、词汇与短语提取、推荐评分、朗读 hook、阅读页竞态、一键打印工作表与 handlePrint 全场景 |
| `features/review` | 20 | SM-2 加权算法与 clamp 边界、复习队列/每日上限/顽固词、五步交互组件 |
| `features/wordbook` | 14 | 生词增删改查、AI 补全语义、筛选/排序、Zustand store |
| `features/profile` | 11 | 个人设置持久化、AI 配置读写、密钥存储、Token 面板 |
| `features/stats` | 8 | 统计聚合、阅读会话、成就规则与解锁 |
| `features/mastered` / `vocabulary` / `phrases` / `admin` / `auth` | 16 | 已掌握归档、词汇/短语汇总分组、班级学情、AI 成本与用户管理、登录与权限相关 UI |
| `pages` | 8 | 首页仪表盘区块、最近阅读、相关推荐、404 |
| `shared`（非 ai 部分） | 29 | 缓存仓储（404/500/离线分级兜底）、存储管理、i18n、深色模式、网络状态、错误边界、打印 Portal、Sentry 可选上报（opt-in 零副作用） |
| `__tests__`（跨模块） | 11 | 端到端业务流、跨模块流程、离线集成、阶段性优化回归验证 |

### 7.2 后端测试（server/src/__tests__/，24 个文件 / 247 用例）

| 领域 | 文件 |
| --- | --- |
| 认证与会话 | `auth.test.ts`、`sessionMgmt.test.ts`、`contentAuth.test.ts` |
| 授权与隔离 | `rbac.test.ts`、`isolation.test.ts` |
| 审计与学情 | `audit.test.ts`、`classStats.test.ts` |
| 迁移与基础设施 | `migration.test.ts`、`db.test.ts`、`encryption.test.ts`、`trustProxy.test.ts`、`health.test.ts` |
| REST 路由 | `routesTables.test.ts`、`routesArticles.test.ts`、`routesWordsBulk.test.ts`、`routes.edge.test.ts`、`pagination.test.ts`、`cors.test.ts`、`rateLimit.test.ts` |
| AI 代理与配额 | `aiProxyForward.test.ts`、`aiProxyCustom.test.ts`、`aiProxyValidation.test.ts`、`aiQuota.test.ts` |
| 可选错误上报 | `sentry.test.ts`（opt-in 零副作用：未配置 SENTRY_DSN 时不加载 SDK、captureException 为 no-op） |

> 后端用例数（247）显著少于前端（1764），但覆盖面仍完整：认证/RBAC/数据隔离/审计/迁移/限流/配额/健康探针均有专项测试文件（见上表）。

### 7.3 新增测试用例详解

以下测试用例针对近期修复的问题新增，覆盖关键边界场景与兜底逻辑：

#### wordbookService.test.ts — enrichWord 占位值检测

验证 `enrichWord` 能正确识别 `lookupWord` 未命中本地字典时返回的占位值，并触发 AI 补全：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| 字段已完整 → 不调用 AI | `phonetic` / `pos` / `definition` 均有真实值 | 直接返回原 word，不触发 `extractVocabulary` |
| 缺失字段 → 调用 AI 并写回 | 字段为空字符串 | 调用 AI，写回缺失字段，`update` 被调用 |
| AI 失败 → 抛出 Error | AI 抛错 | `enrichWord` 透传错误 |
| **占位值检测 → 触发 AI 补全** | `phonetic='/-/'`、`pos='未知'`、`definition` 含 `'暂未收录'` | 视为缺失，调用 AI，占位字段被真实值覆盖 |

#### wordbookService.test.ts — addToWordbook enrichIfMissing 参数

验证 `addToWordbook` 的 `enrichIfMissing` 参数控制写入后是否自动触发 AI 补全：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| `enrichIfMissing=true` 且字段缺失 | 字段为空 | 写入后自动调用 `enrichWord`，返回补全后的实体 |
| `enrichIfMissing=true` 且字段完整 | 字段已有真实值 | 不调用 AI，返回值字段保持原样 |
| `enrichIfMissing=true` 且 AI 失败 | AI 抛错 | **不抛错**，返回已写入的基础实体（best-effort 语义） |
| `enrichIfMissing=false`（默认） | 未传该参数 | 不调用 `enrichWord`，返回基础实体 |

#### sm2.test.ts — easeFactor / interval clamp 边界

验证 SM-2 算法对 `easeFactor` 与 `interval` 的上下限 clamp，防止极端输入产生越界值：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| easeFactor 低于 1.3 时 clamp | `currentEaseFactor=1.4` + 连续答错（quality=0），raw 计算为 0.6 | `nextEaseFactor` clamp 到 **1.3**（下限） |
| easeFactor 超过 3.0 时 clamp | `currentEaseFactor=2.95` + 连续答对（quality=5），raw 计算为 3.05 | `nextEaseFactor` clamp 到 **3.0**（上限） |
| interval 不超过 365 天 | `currentInterval=500`（极端大） + `easeFactor=3.0` | `nextInterval` ≤ 365，且落在合法阶梯 `[1,2,4,7,15,30]` 中 |

> 源码位置：`src/features/review/services/__tests__/sm2.test.ts` 的 `SM-2 clamp 边界` describe 块（Task 5.2 补充）。

#### remoteRepository.test.ts — CachedRemoteRepository.update 404 兜底

> **状态**：已创建（Task 5.3）。代码与单元测试均已完成：`CachedRemoteRepository.update` 的 404 兜底逻辑实现于 `src/shared/services/remoteRepository.ts`，对应测试文件为 `src/shared/services/__tests__/remoteRepository.test.ts`。

覆盖的测试用例：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| 远程 update 成功 | PUT 返回 200 | 返回更新后的实体，同步写入本地缓存 |
| 远程 update 404 → 返回 fallback 对象 | PUT 返回 404 | 不抛错，返回 `{ ...patch, id, updated_at }` fallback 对象，best-effort 写入本地缓存 |
| 远程 update 500 → 重新抛出 | PUT 返回 500 | 重新抛出原始错误，best-effort 写入本地缓存 |
| 远程 update 网络错误 → 重新抛出 | fetch 抛错 | 重新抛出原始错误，best-effort 写入本地缓存 |

> 文件位置：`src/shared/services/__tests__/remoteRepository.test.ts`，通过 mock `RemoteRepository.update` 抛出含 "404" 的错误与不含 "404" 的错误，验证 `CachedRemoteRepository.update` 的分级兜底行为。详见 [架构文档 3.2 CachedRemoteRepository.update 404 兜底策略](./ARCHITECTURE.md#32-cachedremoterepositoryupdate-404-兜底策略)。

#### VirtualList.test.tsx / chunkRows.test.ts / useResponsiveColumns.test.ts — 长列表窗口化虚拟滚动

验证 M1 虚拟滚动基础组件：仅渲染视口内行、占位高度正确、滚动区间随位置平移、网格按断点切行。

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| 仅渲染视口内行 | 100 行、估算行高 50px、jsdom 视口 768px、overscan=2 | 渲染 0..17 行，`row 18` / `row 99` 不进入 DOM |
| 容器总高度按估算累加 | 100 行 × 50px | 容器 `height = 5000px`，滚动条比例与全量列表一致 |
| 滚动后区间平移 | 容器顶部移出视口 1000px | 渲染区间移至 18..37，首行不再渲染 |
| 空数据 | `rows=[]` | 容器高度 0、无子节点 |
| 差异化估算 + 行间距 | 标题 20px / 卡片 60px，`rowGap=10` | 总高度 160px |
| `chunkRows` 边界 | 整行 / 末行不足 / 列数 0、负数、NaN / 空数组 | 分别按列数切分、非法列数退化为 1、空数组返回 `[]` |
| `useResponsiveColumns` | 无 matchMedia / 仅平板 / 桌面 / change 事件 | 返回 1 / 2 / 3 列，断点变化时更新 |

> 文件位置：`src/shared/components/__tests__/VirtualList.test.tsx`、`src/shared/utils/__tests__/chunkRows.test.ts`、`src/shared/hooks/__tests__/useResponsiveColumns.test.ts`（共 15 个用例）。

## 8. 相关文档

- [架构文档](./ARCHITECTURE.md)：分层架构与 REST API 数据流
- [CONTRIBUTING.md](../CONTRIBUTING.md)：开发流程与提交规范
- [README](../README.md)：项目概述
