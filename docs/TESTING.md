# 测试策略

本文档说明 `ydxl` 项目的测试策略、运行命令、覆盖率目标、fetch mock 模式与 vitest 配置。

## 1. 三层测试策略

项目采用**单元测试 + 集成测试 + E2E 测试**三层测试金字塔，重心在单元测试与集成测试；E2E 测试已引入 [Playwright](https://playwright.dev/)，覆盖 6 条关键用户路径（阅读 / 复习 / 离线回退 / 生词本 / 打印 / 多用户切换）与生产构建 SW 离线验证。

### 1.1 单元测试

**目标**：验证纯函数与工具类的正确性，隔离外部依赖。

| 测试文件 | 被测对象 | 覆盖点 |
| --- | --- | --- |
| `src/shared/services/ai/__tests__/ai-provider-retry.test.ts` | `BaseAIProvider.callChat`（DeepSeek 为主） | 超时抛 `AIError('请求超时（170s）')`、5xx 重试 2 次（指数退避 1s/2s）、4xx 不重试立即抛错、429 按 Retry-After 动态退避 |
| `src/features/review/services/__tests__/sm2.test.ts` / `sm2.weighted.test.ts` | `sm2` 基础与加权算法 | 三环节加权输入（炼 0.3 / 拼 0.3 / 写 0.4）、ease factor 计算、stabilityScore 返回、easeFactor/interval clamp 边界（1.3 ≤ easeFactor ≤ 3.0、interval ≤ 365） |
| `src/features/wordbook/services/__tests__/wordbookService.enrich.test.ts` | `wordbookService`（生词本服务） | enrichWord 占位值检测（`/-/`、`未知`、`暂未收录`）、addToWordbook 的 `enrichIfMissing` 参数（AI 补全触发 / best-effort 失败兜底） |
| `src/features/review/utils/__tests__/phonetics.test.ts` | `estimateSyllables` / `breakdownWord` | 元音组音节估算、末尾不发音 e 修正、双元音切分、magic E 合并、无元音与空串 |
| `src/features/stats/services/__tests__/achievementService.test.ts` | `achievementService.checkAndUnlockAchievements` | 成就规则判断逻辑 |
| `src/features/review/services/__tests__/reviewService.queue.test.ts` | `reviewService.getStubbornWords` 等 | 顽固词识别（`stubbornCount >= 3`）等 |

### 1.2 集成测试

**目标**：验证跨层流程，多个模块协作完成一个完整业务场景。

| 测试文件 | 验证流程 | 覆盖点 |
| --- | --- | --- |
| `src/features/reading/services/__tests__/articleService.integration.test.ts` | `articleService` → `AIProvider` → `CachedRemoteRepository` 端到端 | AI 生成文章 → 写入服务器 SQLite → 读取验证；含 AI 不可用时 fallback 降级到兜底素材库 |
| `src/shared/services/ai/__tests__/ai-proxy-contract.envelope.test.ts` | 前端 Provider ↔ 后端 `server/src/ai-proxy.ts` 契约 | DeepSeek 在代理模式下发送的请求体格式（`{ provider, body }` 信封）与后端解析一致 |
| `src/shared/components/__tests__/ErrorBoundary.test.tsx` | ErrorBoundary 子组件异常捕获 | 子组件抛错时显示恢复 UI（"刷新页面" / "返回首页"按钮）而非白屏 |

### 1.3 E2E 测试（Playwright，已引入）

**当前状态**：已引入 [Playwright](https://playwright.dev/)，测试位于项目根目录 `e2e/`，配置 `playwright.config.ts`，命令 `npm run test:e2e`。

**技术路线（前端级 + API 拦截）**：Playwright 驱动真实浏览器访问 vite dev server（5173），所有 `/api` 请求由 `page.route()` 在网络层拦截并返回预置 fixture（`e2e/helpers.ts`），**不启动真实后端**；AI 代理端点统一返回 404（4xx 不触发重试，provider 秒级降级），用于验证 AI 不可用时的前端降级路径。登录后业务数据通过原生 IndexedDB API 直写 Dexie（`ydxl-db`）预置。

**测试文件与覆盖路径**：

| 测试文件 | 验证路径 | 覆盖点 |
| --- | --- | --- |
| `e2e/reading.spec.ts` | 阅读路径 | 失败分支：AI 404 → 语法填空提示条 + 练习题生成失败错误态；成功分支：预置本地题目 → 答题 → 成绩单 100% |
| `e2e/review.spec.ts` | 复习路径 | 五步全流程：列表队列 → 识记 → 朗读 → 练习（3-5 题随机按内容定位正确项）→ 拼写 → 默写 → 已掌握评价 → 「今日复习已完成 🎉」 |
| `e2e/offline.spec.ts` | 离线回退路径 | 在线加载写 Dexie 缓存 → `context.setOffline(true)` → OfflineBanner → SPA 导航复习队列纯本地可用 → 文章本地缓存可读 |
| `e2e/wordbook.spec.ts` | 生词本路径 | 「添加」→ AddWordModal 五字段填写 → 保存（POST 回显）→ 弹窗关闭 → 生词卡出现在列表 |
| `e2e/print.spec.ts` | 打印路径 | 降级分支：无题目 + AI 404 → 提示「仅打印文章内容」→ 工作表打开；完整分支：预置题目 → 工作表包含题干；以 `window.print` 桩计数 + `.print-portal` 挂载断言（屏幕上 display:none，仅打印媒体可见） |
| `e2e/offline-sw.spec.ts` | 生产构建 SW 离线回退 | 跑在 `vite build` + `vite preview`（4173）上：SW 激活（预缓存 45 项）→ 断网**整页重载**由 SW 预缓存提供文档 → OfflineBanner + 本地数据照常可用；dev 模式不生成 SW，此路径仅本用例覆盖 |
| `e2e/multiuser.spec.ts` | 多用户切换路径 | 登出 → 跳转登录页 + RequireAuth 拦截；换账号登录（cache-owner 变化）清空上一账号本地缓存（历史页空态）；同账号重复登录保留缓存。fixture 按用户名派生用户 id；场景 2/3 用 `sessionStorage.clear()` 模拟「会话丢失未登出」（绕过登出按钮——登出本身也清缓存），精确触发账号切换检测 |

**关键约定**：

- 本地运行使用系统 Chrome（`channel: 'chrome'`）；CI 使用 `npx playwright install --with-deps chromium` 安装的内置 Chromium
- fixture 文章的 `vocabulary` 必须为「增强版」（每条含 `exampleSentence` / `exampleSentenceTranslation` / `emojiHint`），vocabularyService 检测后短路 AI 调用
- dev 模式不生成 Service Worker（VitePWA 仅 build 启用），离线能力完全依赖 Dexie 本地缓存；React.lazy 的页面 chunk 离线后无法加载，离线导航目标页需在同一次文档生命周期内提前挂载预热
- 生产构建 SW 场景（`offline-sw.spec.ts`）必须用 `context.route` 注册 fixture：登录后页面处于 SW 控制下，`page.route()` 不拦截 SW 发起的网络请求
- `@playwright/test` 1.x 要求 Node >= 20（本地与 CI 全部 job 统一 Node 20）

## 2. 运行命令

| 命令 | 作用 | 适用场景 |
| --- | --- | --- |
| `npm test` | 一次运行前端所有测试 | CI / 提交前验证 |
| `npm run test:coverage` | 运行前端测试并生成覆盖率报告（text-summary / html / lcov，含防回退阈值校验） | 覆盖率检查 / CI |
| `npm --prefix server test` | 运行后端所有测试 | CI / 提交前验证 |
| `npm run test:watch` | 监听模式，文件变更自动重跑 | 开发时迭代 |
| `npm run test:e2e` | 运行 Playwright E2E 测试（自动启动 vite dev，/api 由 fixture 拦截） | 提交前验证（需 Node 20+ 与系统 Chrome） |
| `npm run test:e2e:sw` | 运行生产构建 SW 离线验证（`vite build` + `vite preview` 4173） | 提交前验证 PWA 离线能力（需 Node 20+ 与系统 Chrome） |
| `npm run typecheck` | TypeScript 类型检查（`tsc -b --noEmit`） | 提交前验证 |
| `npm run lint` | ESLint 检查 | 提交前验证 |
| `npm run lint:fix` | ESLint 自动修复 | 开发时修复 |
| `npm run build` | 生产构建（含 `tsc -b` 类型检查） | 提交前验证 |

### 只运行单个测试文件

```bash
npx vitest run src/shared/services/ai/__tests__/ai-provider-retry.test.ts
```

### 只运行匹配模式的测试

```bash
npx vitest run -t "超时"
```

### 查看 UI 测试

vitest 默认不打开浏览器，但 `@testing-library/react` 在 jsdom 环境下渲染组件。如需查看渲染结果，可在测试中使用 `screen.debug()` 输出 DOM。

## 3. 覆盖率目标

> **当前状态**：已接入 `@vitest/coverage-v8`，通过 `npm run test:coverage` 生成 text-summary / html / lcov 报告（输出到 `coverage/`，已加入 `.gitignore`）。

**2026-10-26 第四批补测后实测基线**：statements 76.19% / branches 62.45% / functions 71.60% / lines 77.99%。

`vitest.config.ts` 中的**防回退阈值**取基线下方约 4 个百分点，用于拦截明显回退并留存跨平台 V8 统计差异余量：statements 72 / branches 58 / functions 67 / lines 73。下表为**阶段性目标**，当前整体已达标，后续按模块补充测试逐步提高阈值。

| 模块 | 目标覆盖率 | 当前状态 |
| --- | --- | --- |
| 核心服务层（`localApi.ts` / `sm2.ts` / `reviewService.ts` 等） | >= 80% | 部分达标（`sm2.ts` 98.6%、`localApi.ts` 80.4%、`reviewService.ts` 75.4%、`storageManager.ts` 73.8%） |
| UI 组件（`features/*/components/`） | >= 60% | 未达标，个人中心区块 / 部分管理页仍主要由 E2E 覆盖 |
| 整体 | >= 70% | 已达标（当前 lines 77.99%） |

实际配置（`vitest.config.ts`）：

```ts
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text-summary', 'html', 'lcov'],
    reportsDirectory: './coverage',
    include: ['src/**/*.{ts,tsx}'],
    exclude: ['src/**/__tests__/**', 'src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
    thresholds: {
      statements: 72,
      branches: 58,
      functions: 67,
      lines: 73,
    },
  },
}
```

> 覆盖率的统计范围仅含 `src/` 业务源码，不含测试文件、测试基建、类型声明与入口 `main.tsx`；服务端（`server/`）当前未接入覆盖率统计。

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
src/shared/services/ai/__tests__/ai-provider-request.test.ts

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

共 146 个测试文件（前端 124 个 + 后端 22 个），1239 个用例（前端 1023 + 后端 216）：

### 前端测试（src/，124 个文件）

**AI Provider 抽象层（src/shared/services/ai/__tests__/，25 个文件）**

| 文件 | 覆盖点 |
| --- | --- |
| `ai-jsonParsing.test.ts` | parseJsonResponse 纯 JSON / 代码块 / 前后闲聊 / 平衡块与截断容错 |
| `ai-provider-request.test.ts` | DeepSeekProvider 配置校验、直连 / 代理请求体与响应解析 |
| `ai-provider-retry.test.ts` | 超时控制与 5xx / 429 重试、4xx 不重试 |
| `ai-provider-validation.test.ts` | 生成结果必填字段校验与 HTTP 错误映射 |
| `ai-provider-enrich.test.ts` | enrichSingleWord 成功与 400/401/402/422/429/500 错误场景 |
| `ai-provider-cache.test.ts` | callChatCached 二级缓存命中与 inflight 去重 |
| `ai-prompts-schema.test.ts` | 各 Prompt 的 JSON Schema 样例精简 |
| `ai-provider-phase2.test.ts` | reasoning_effort / thinkingDisabled / max_tokens 调优 |
| `multiProvider.test.ts` | OpenAI / Qwen 供应商、工厂分发、多供应商错误文案、temperature 透传 |
| `customProvider.test.ts` | 自定义供应商端点规范化、平台推断 |
| `customProviderJsonCompat.test.ts` | 第三方模型 JSON 兼容（json_object 门控、对象解包） |
| `dynamicProvider.test.ts` | 动态 Proxy 供应商路由/免刷新切换/密钥解析/字段校验/markdown 围栏解析 |
| `fallbackProvider.test.ts` | 自定义优先 + DeepSeek 兜底自动降级链（含流式防重放） |
| `parseJsonArrayResponse.test.ts` | 数组解析：顶层数组/对象包装解包/裸单题对象防护 |
| `responseCache.test.ts` | AI 响应缓存命中与过期 |
| `promptCache.integration.test.ts` | 缓存集成（同文章二次请求零 token） |
| `callChatStream.retry.test.ts` | 流式调用重试与降级 |
| `deepseekCacheStats.test.ts` | DeepSeek 上下文缓存命中统计 |
| `tokenStats.record.test.ts` | Token 用量记录与 DeepSeek 缓存字段累加 |
| `tokenStats.stats.test.ts` | 缓存命中率、旧字段兼容与跨 scenario 聚合 |
| `tokenStats.cost.test.ts` | 成本估算、模型定价与缓存节省金额 |
| `extractArticlePhrases.test.ts` | 文章短语提取 |
| `ai-proxy-contract.envelope.test.ts` | 代理模式请求信封与 URL 拼接契约 |
| `ai-proxy-contract.request.test.ts` | JSON 模式、max_tokens、thinkingDisabled 与默认模型契约 |
| `ai-proxy-contract.retry.test.ts` | 429 / 402 / 503 重试分类与练习题思考模式契约 |

**阅读特性（src/features/reading/，31 个文件）**

| 文件 | 覆盖点 |
| --- | --- |
| `articleService.integration.test.ts` | 端到端流程含 fallback 降级 |
| `articleService.getById.test.ts` / `articleService.recentlyRead.test.ts` | 文章查询 / 最近阅读精简字段 |
| `articleDedup.test.ts` / `articleFallbackDedup.test.ts` | 文章 contentHash + 标题双重去重 / 兜底素材库去重 |
| `articlePromptInjection.test.ts` / `articlePromptContent.test.ts` | 历史主题注入 + 避免重复提示 / JSON Schema 精简、随机叙事视角、生活化题材简报 |
| `ensureArticlePhrases.test.ts` | 历史文章短语补全 |
| `questionService.cache.test.ts` / `questionService.grammar.test.ts` | 本地缓存与 AI 生成校验 / 语法填空与阅读理解去重 |
| `recommendationService.test.ts` | 相关文章推荐评分 |
| `vocabularyService.cache.test.ts` / `vocabularyService.persistence.test.ts` / `vocabularyService.build.test.ts` / `wordLookup.test.ts` | 词汇缓存字段 / 文章实体持久化与旧缓存迁移 / 高亮生词转换 / 本地词典查询 |
| `offlineScenario.test.ts` | 阅读离线降级 |
| `useArticleSpeech.test.ts` | 文章全文朗读 hook |
| `useWordbookActions.test.ts` / `useContentGeneration.test.ts` | 高亮词 / 查词 / 批量加入生词本与自动关闭、错误提示 / 语法填空与词汇重试、交互式生成、卸载与并发守卫 |
| `useWordSelectionPopover.test.ts` | 选词浮层：单查与标点清理 / 多词批量 / 选区去重 / 查词竞态与关闭失效 / 浮层内外点击与 Escape / 拖拽抑制与触控延迟 |
| `useAddArticleForm.test.ts` | 添加文章表单 hook：默认值与提交判定 / AI 翻译与提示轮播 / 翻译与保存守卫 / 保存实体字段与自动关闭 / 关闭重置与定时器清理 / Escape 与滚动锁定 |
| `ReadingPage.articleId.test.tsx` / `ReadingPage.markAsRead.test.tsx` / `ReadingPage.raceProtection.test.tsx` / `ReadingPage.grammarChoice.test.tsx` / `HistoryPage.test.tsx` | 阅读页路由参数 / 阅读完成与开始答题入口 / 加载竞态保护 / 语法填空选择页 / 历史页 |
| `WordPopover.test.tsx` / `PerformanceAnalysis.test.tsx` | 选词弹窗 / 成绩分析组件 |
| `ImportArticlesModal.test.tsx` | 批量导入文章：按 `---` 解析与正文长度过滤 / 删除预览 / 全部与部分导入结果 / 导入中状态 / 自动关闭与关闭方式 |
| `PrintableWorksheet.test.tsx` | 一键打印工作表：七大板块渲染、空题目跳过、highlightedWords 兜底、空翻译跳过、翻译多段兜底、自动唤起打印 |
| `ReadingPage.print.test.tsx` | handlePrint 四场景：题目就绪直接打印 / 懒生成补齐后打印 / 生成失败降级 / 准备期间防重复点击 |

**背诵与生词（src/features/review / wordbook / mastered / vocabulary，23 个文件）**

| 文件 | 覆盖点 |
| --- | --- |
| `sm2.test.ts` / `sm2.weighted.test.ts` | SM-2 基础算法 / 加权算法与 easeFactor/interval clamp 边界 |
| `reviewService.queue.test.ts` | 复习队列、每日上限、顽固词与逾期判断 |
| `reviewService.weighted.test.ts` | 加权复习结果的 stabilityScore、掌握流转与 stubbornCount |
| `practiceQuestionGenerator.test.ts` | 练习题目生成：题量 3-5、选项唯一、答案索引、近反义词题型降级与标签完整性 |
| `phonetics.test.ts` | 音节估算与本地拼读分解（双元音 / magic E / 无元音） |
| `review/__tests__/store.test.ts` | 五步背诵状态机：队列初始化、步骤解锁、完成推进、跳过与结束 |
| `useReviewPage.test.ts` | 复习页状态机：队列加载 / 补全 / 评价提交 / 庆祝与成就 / 进度计算 |
| `useSpellStep.test.ts` | 拼写步骤：分级提示、输入、正确 / 错误提交、放弃与顽固词计数 |
| `LearnStep.test.tsx` / `WriteStep.test.tsx` | 识记步骤 AI 助记与降级 / 默写步骤双模式、提示、逐字符对比与朗读 |
| `useReadStep.test.ts` / `PracticeStep.test.tsx` | 朗读步骤语速 / AI 拼读与本地降级 / 录音评分 / 麦克风失败 / 完成回调 / 练习步骤答题反馈、错题自动推进、提示递进与发音播放 |
| `WordbookPage.test.tsx` | 生词本冒烟测试：卡片网格 / 空状态 / 全部已掌握 |
| `ImportWordsModal.test.tsx` | 批量导入单词：解析去重 / 无有效词提示 / 删除预览 / 导入中与失败 / 2 秒自动关闭 / Escape 与遮罩关闭 |
| `AddWordModal.test.tsx` | 添加单词 Modal：AI 补全成功 / 部分字段 / 失败与并发守卫 / 保存成功重置 / 保存失败与保存中 / Escape 与遮罩关闭 |
| `wordbookService.mutation.test.ts` / `wordbookService.enrich.test.ts` / `wordbookService.query.test.ts` | 新增 / 删除 / 笔记 / 统计 / 批量，AI 补全，列表查询 |
| `wordbook/__tests__/store.test.ts` | 生词本 Zustand store：搜索 / 收藏过滤 / 排序 / 勾选 / 批量与单个删除 |
| `masteredService.test.ts` | 已掌握单词归档查询 |
| `mastered/hooks/__tests__/useMasteredWords.test.tsx` | 已掌握列表：分页、搜索防抖、排序、缓存失效重载与无限滚动 |
| `vocabularySummaryService.test.ts` | 词汇汇总分组 |

**共享层与跨模块（src/shared + src/__tests__ + src/pages + 其他 features 单页，45 个文件）**

| 文件 | 覆盖点 |
| --- | --- |
| `remoteRepository.update.test.ts` / `remoteRepository.offline.test.ts` / `remoteRepository.swr.test.ts` / `remoteRepository.refreshSync.test.ts` | update 分级兜底 / 离线持久化 / SWR 本地优先 / 后台刷新与增量同步 |
| `authService.test.ts` | 认证服务：登录 / 换账号清 Dexie 缓存与 AI 缓存/用量 / 同账号保留 / 登出兜底 / authHeaders 与 isInternalApiUrl |
| `localApi.test.ts` | 错误体解析（嵌套 error.message / 非 JSON 回退 statusText）/ 15 秒超时 / 外部 signal 取消 |
| `secureStorage.test.ts` | 加密可用时密文落盘可解密读回 / IndexedDB 缺失时仅内存保存不落明文 |
| `storageManager.capacity.test.ts` / `storageManager.cleanup.test.ts` | 存储容量检测 / 超期与上限清理策略 |
| `statsService.query.test.ts` / `statsService.trend.test.ts` / `statsService.recording.test.ts` | 概览与区间查询 / 阅读能力趋势 / 学习记录写入 |
| `StatsPage.test.tsx` | 学习统计页：加载态 / KPI 概览 / 日期补零 / 周月切换 / 缓存失效重载 / 各数据源失败降级 |
| `AdminUsersPage.test.tsx` | 用户管理页：加载与失败 / 创建用户 / 启用禁用 / 角色修改 / 重置密码行内表单 / 提示自动消失 |
| `AuditLogsPage.test.tsx` | 审计日志页：加载与失败 / admin 入口可见性 / 空日志与空字段占位 / 过滤查询重置分页 / 分页步进与禁用 / CSV 导出成功与失败 / 结果标签样式 |
| `ClassStatsPage.test.tsx` | 班级学情页：默认 30 天窗口 / 汇总卡片百分比与时长格式化 / 学员明细与空值占位 / 空学员 / 窗口切换重载 / 加载失败兜底 |
| `useDarkMode.test.ts` / `useOnlineStatus.test.ts` / `useTranslation.test.ts` | 主题切换 / 网络状态 / i18n hooks |
| `useLongPress.test.ts` | 长按手势：触发延迟 / 抬起与滑动取消 / click 互斥 / 触摸后忽略合成鼠标事件 |
| `speech.test.ts` | 语音合成：支持性检测、普通朗读、计时朗读（onend / onerror）、失败降级与录音支持检测 |
| `ErrorBoundary.test.tsx` | 子组件异常捕获 |
| `useProfileSettings.test.ts` / `TokenStatsPanel.test.tsx` | 个人设置 hook / Token 用量面板 |
| `SessionSection.test.tsx` | 登录设备管理：未登录不请求 / 设备列表与当前设备标记 / 移除设备确认与失败恢复 / 全端下线成功与失败 / 请求中按钮禁用 |
| `useAIConnectionTest.test.ts` | AI 连接测试：成功 / 失败消息、并发防重、5 秒自动清空与卸载清理 |
| `notification.test.ts` | 浏览器通知：支持性检测、权限申请、发送降级与每日定时提醒 |
| `phraseService.test.ts` | 重点短语汇总：已读文章短语提取、来源附加、日期分组与相对标签 |
| `achievementService.test.ts` | 成就规则 |
| `RecentlyReadSection.test.tsx` / `NotFoundPage.test.tsx` | 首页最近阅读区块 / 404 页 |
| `DashboardPage.test.tsx` | 首页仪表盘冒烟测试：概览卡片 / 今日待办 / 复习单词渲染，历史与推荐空状态 |
| `e2e-flow.article.test.ts` / `e2e-flow.learning.test.ts` / `e2e-flow.complete.test.ts` | E2E 用户完整流程（生成→阅读→题目→生词→复习→统计），按文章与题目 / 生词与统计 / 完整闭环拆分 |
| `crossModuleFlow.reviewMastery.test.ts` / `crossModuleFlow.readingStats.test.ts` / `crossModuleFlow.readingWordbook.test.ts` / `offlineScenario.integration.test.ts` | 跨模块流程（复习→掌握 / 阅读→统计 / 阅读→生词）/ 离线集成 |
| `deepseekPhase2.verification.test.ts` / `tokenOptimization.cache.test.ts` / `tokenOptimization.modelTier.test.ts` / `tokenOptimization.dedup.test.ts` | 阶段性优化回归验证：响应缓存冷热对比与一周汇总 / 模型分级成本 / 并发去重 |

### 后端测试（server/src/，22 个文件）

| 文件 | 覆盖点 |
| --- | --- |
| `__tests__/db.test.ts` | SQLite 12 张表创建与 CRUD（含 users / sessions / user_article_states / schema_meta / operation_logs）、迁移列 |
| `__tests__/routesArticles.test.ts` / `__tests__/routesTables.test.ts` / `__tests__/routesWordsBulk.test.ts` | 7 张表 REST API 端到端（文章 / 其余表 / words 批量端点） |
| `__tests__/routes.edge.test.ts` | 路由边界场景（非法表名、缺失字段、超长字段） |
| `__tests__/rateLimit.test.ts` | 限流中间件（60 req/min，超限 429） |
| `__tests__/pagination.test.ts` | 分页参数解析（limit / offset / max 1000） |
| `__tests__/auth.test.ts` | 认证：登录 / 统一 401 文案防枚举 / 失败 5 次锁定 15 分钟 / 登出吊销 / 改密全端下线 / 禁用用户会话失效 |
| `__tests__/isolation.test.ts` | 多用户数据隔离：私有表按用户过滤、伪造 userId 被忽略、reviews.wordId 透明映射、阅读状态按用户剥离合并 |
| `__tests__/migration.test.ts` | 单用户→多用户迁移：空库建 admin、旧数据前缀化、幂等重复执行 |
| `__tests__/cors.test.ts` | CORS 白名单 `CORS_ORIGIN` 校验 |
| `__tests__/encryption.test.ts` | AES-256-GCM 字段加密与 fail-fast |
| `__tests__/aiProxyForward.test.ts` / `__tests__/aiProxyValidation.test.ts` / `__tests__/aiProxyCustom.test.ts` | AI 代理：转发与重试 / 请求校验与 SSE / custom 上游 |
| `__tests__/rbac.test.ts` | RBAC（P1）：权限矩阵逐点校验（三角色 × 10 权限点）/ 未知角色 fail-closed / requirePermission 401/403 语义 / `/api/admin/users` 全流程（创建/禁用/启用/重置密码/改角色）/ 响应不含 passwordHash / 禁止操作自己 / 禁用与改角色即时吊销会话 |
| `__tests__/audit.test.ts` | 审计日志（P2）：logOperation 五要素与脱敏（敏感键剔除）/ 认证事件留痕（登录成败/登出/改密）/ 管理操作留痕 / 403 `permission.denied` 留痕 / 表写操作与 bulk 留痕（GET 不记）/ `/api/admin/logs` 权限与过滤分页 / `logs.query` 自身留痕 / CSV 导出与转义 / 180 天归档清理幂等 |
| `__tests__/classStats.test.ts` | 班级学情聚合（P3）：`stats:class` 权限四态 / 窗口过滤与禁用账号排除 / 最新 streak 与 lastActiveDate / 人均阅读与按会话加权正确率 / 无学员零值 / days 参数边界 / `class_stats.view` 查询留痕 |
| `__tests__/aiQuota.test.ts` | AI 配额按 userId 计量（P3）：同 IP 下 A 用户刷满不影响 B 用户 / 无 `req.user` 时 keyGenerator 回退 IP（`createAiProxyLimiter` 工厂 + 可注入 skip） |
| `__tests__/sessionMgmt.test.ts` | 会话管理（P3）：GET 未认证 401 / 仅本人会话 + 当前设备标记 + 脱敏指纹不泄露完整令牌 / 过期会话惰性清理 / DELETE /:id 吊销指定会话 + 非法 id 400 + 不存在 404 + 越权他人 rowid 404 / DELETE 全端下线含当前端且他人不受影响 / `auth.revoke_session` 与 `auth.logout_all` 审计留痕 |
| `__tests__/contentAuth.test.ts` | 共享内容写权限（content:manage）：学生可 POST 文章、可写 vocabulary/phrases；改核心字段/删文章/改删题目 403；教师全通过 |
| `__tests__/trustProxy.test.ts` | `TRUST_PROXY` 解析（空/数字/true/false/自定义）/ XFF 下不同 IP 独立限流 / 同 IP 触发 429 / 登录限流键 IP+用户名 |

### 7.1 新增测试用例详解

以下测试用例针对近期修复的问题新增，覆盖关键边界场景与兜底逻辑：

#### wordbookService.enrich.test.ts — enrichWord 占位值检测

验证 `enrichWord` 能正确识别 `lookupWord` 未命中本地字典时返回的占位值，并触发 AI 补全：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| 字段已完整 → 不调用 AI | `phonetic` / `pos` / `definition` 均有真实值 | 直接返回原 word，不触发 `extractVocabulary` |
| 缺失字段 → 调用 AI 并写回 | 字段为空字符串 | 调用 AI，写回缺失字段，`update` 被调用 |
| AI 失败 → 抛出 Error | AI 抛错 | `enrichWord` 透传错误 |
| **占位值检测 → 触发 AI 补全** | `phonetic='/-/'`、`pos='未知'`、`definition` 含 `'暂未收录'` | 视为缺失，调用 AI，占位字段被真实值覆盖 |

#### wordbookService.enrich.test.ts — addToWordbook enrichIfMissing 参数

验证 `addToWordbook` 的 `enrichIfMissing` 参数控制写入后是否自动触发 AI 补全：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| `enrichIfMissing=true` 且字段缺失 | 字段为空 | 写入后自动调用 `enrichWord`，返回补全后的实体 |
| `enrichIfMissing=true` 且字段完整 | 字段已有真实值 | 不调用 AI，返回值字段保持原样 |
| `enrichIfMissing=true` 且 AI 失败 | AI 抛错 | **不抛错**，返回已写入的基础实体（best-effort 语义） |
| `enrichIfMissing=false`（默认） | 未传该参数 | 不调用 `enrichWord`，返回基础实体 |

#### sm2.weighted.test.ts — easeFactor / interval clamp 边界

验证 SM-2 算法对 `easeFactor` 与 `interval` 的上下限 clamp，防止极端输入产生越界值：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| easeFactor 低于 1.3 时 clamp | `currentEaseFactor=1.4` + 连续答错（quality=0），raw 计算为 0.6 | `nextEaseFactor` clamp 到 **1.3**（下限） |
| easeFactor 超过 3.0 时 clamp | `currentEaseFactor=2.95` + 连续答对（quality=5），raw 计算为 3.05 | `nextEaseFactor` clamp 到 **3.0**（上限） |
| interval 不超过 365 天 | `currentInterval=500`（极端大） + `easeFactor=3.0` | `nextInterval` ≤ 365，且落在合法阶梯 `[1,2,4,7,15,30]` 中 |

> 源码位置：`src/features/review/services/__tests__/sm2.weighted.test.ts` 的 `SM-2 边界场景` / `SM-2 clamp 边界` describe 块。

#### remoteRepository.update.test.ts — CachedRemoteRepository.update 404 兜底

> **状态**：已创建。代码与单元测试均已完成：`CachedRemoteRepository.update` 的 404 兜底逻辑实现于 `src/shared/services/remoteRepository.ts`，对应测试文件为 `src/shared/services/__tests__/remoteRepository.update.test.ts`。

覆盖的测试用例：

| 用例 | 场景 | 预期 |
| --- | --- | --- |
| 远程 update 成功 | PUT 返回 200 | 返回更新后的实体，同步写入本地缓存 |
| 远程 update 404 → 返回 fallback 对象 | PUT 返回 404 | 不抛错，返回 `{ ...patch, id, updated_at }` fallback 对象，best-effort 写入本地缓存 |
| 远程 update 500 → 重新抛出 | PUT 返回 500 | 重新抛出原始错误，best-effort 写入本地缓存 |
| 远程 update 网络错误 → 重新抛出 | fetch 抛错 | 重新抛出原始错误，best-effort 写入本地缓存 |

> 文件位置：`src/shared/services/__tests__/remoteRepository.update.test.ts`，通过 mock `RemoteRepository.update` 抛出含 "404" 的错误与不含 "404" 的错误，验证 `CachedRemoteRepository.update` 的分级兜底行为。详见 [架构文档 3.2 CachedRemoteRepository.update 404 兜底策略](./ARCHITECTURE.md#32-cachedremoterepositoryupdate-404-兜底策略)。

### 7.2 多用户与认证（P0 / P1 / P2 / P3）测试详解

P0 阶段（认证与数据隔离）新增 4 个测试文件：

| 文件 | 关键用例 |
| --- | --- |
| `server/src/__tests__/auth.test.ts` | 登录成功 / 无 token 401 / 错误账号统一 `INVALID_CREDENTIALS` 文案（防用户名枚举）/ 连续失败 5 次锁定 15 分钟 / 成功登录清零计数 / 登出即时吊销 / 修改密码全端下线 / 禁用用户会话失效 |
| `server/src/__tests__/isolation.test.ts` | 双用户同名生词互不可见 / 客户端伪造 `userId` 被忽略 / bulk 批量归属当前用户 / 同日 stats 隔离 / `reviews.wordId` 透明前缀映射 / articles 共享但 `readAt` / `startedAt` 按用户隔离（articles 行本身为 null） |
| `server/src/__tests__/migration.test.ts` | 空库迁移自动创建 admin / 旧数据 id 加 `userId:` 前缀 / 行内 `readAt` / `startedAt` 剥离到 user_article_states / 幂等重复执行不双重前缀 |
| `src/shared/services/__tests__/authService.test.ts` | 登录持久化 sessionStorage / 换账号清空 Dexie 业务表 / 同账号登录保留缓存 / 登出（服务端吊销 + 本地清理）/ 网络错误仍完成本地登出 / `isInternalApiUrl` 第三方域名不带 token |

后端测试通用基建：`server/src/__tests__/testUsers.ts` 提供固定测试用户（`TEST_USER` / `TEST_USER_2`）、`injectUser()`（模拟认证上下文，适配既有路由测试）与 `createRealUser()`（真实建用户 + 签发会话，供认证与隔离测试使用）。

P1 阶段（RBAC 与用户管理）新增 3 个测试文件：

| 文件 | 关键用例 |
| --- | --- |
| `server/src/__tests__/rbac.test.ts` | 权限矩阵逐点（student 5 项 / teacher 7 项 / admin 9 项）/ 未知角色 fail-closed / requirePermission 未认证 401、无权限 403 / student 与 teacher 访问管理端点 403 / 创建用户（默认 student、指定 role、409 冲突、400 校验）/ 禁用后会话失效 + 登录被拒、启用后可登录 / 重置密码后旧密码失效新密码可登录 / 改角色后旧会话吊销 / 响应无 passwordHash / 禁止操作自己 |
| `src/shared/services/__tests__/adminService.test.ts` | 请求构造（URL / 方法 / 请求体 / `x-user-token` 头）/ 401 清会话并广播 `ydxl:unauthorized` / 403 统一无权限文案 / 204 不解析 JSON / 审计日志查询参数透传（P2） |
| `src/features/auth/components/__tests__/RequireAdmin.test.tsx` | 未登录与 student / teacher 角色访问 `/admin` 重定向首页，admin 正常渲染子路由 / `roles` prop 放宽（teacher 访问 `/admin/logs` 通过，student 仍拒绝，P2） |

P2 阶段（审计日志）新增 1 个测试文件：

| 文件 | 关键用例 |
| --- | --- |
| `server/src/__tests__/audit.test.ts` | 见上方「后端测试」表 `audit.test.ts` 行；设计文档 4 节验收项（动作字典全覆盖 / 脱敏 grep 不到密码 token / `logs.query` 自身留痕）均在此验证 |

P3 阶段（班级学情聚合）新增 1 个测试文件，另在既有 adminService 测试中补 2 个用例：

| 文件 | 关键用例 |
| --- | --- |
| `server/src/__tests__/classStats.test.ts` | 权限四态（teacher / admin 200、student 403 `FORBIDDEN`、未认证 401）/ 窗口聚合与禁用账号排除 / 教师账号不计入学员 / `streak` 与 `lastActiveDate` 取窗口内最新一天 / 人均阅读与按会话加权正确率 / 无学员返回零值 / `days` 生效、上限收敛 180、非法值回退 30 / 查询写 `class_stats.view` 并记录窗口 |
| `src/shared/services/__tests__/adminService.test.ts` | 补 `getClassStats` 用例：GET `/api/admin/class-stats?days=N` 请求构造与令牌头、403 统一文案 |

P3 阶段（AI 配额 + 会话管理）再新增 2 个测试文件（前端 authService 测试同步补 `listSessions` / `revokeSession` / `logoutAll` 用例）：

| 文件 | 关键用例 |
| --- | --- |
| `server/src/__tests__/aiQuota.test.ts` | 同 IP 下 A 用户刷满配额不影响 B 用户（自建实例 max=3）/ 无 `req.user` 时 keyGenerator 回退 IP（max=2） |
| `server/src/__tests__/sessionMgmt.test.ts` | GET 未认证 401 / 仅本人会话 + 当前设备 `current` 标记 + 脱敏指纹不泄露完整令牌 / 过期会话惰性清理 / DELETE `/:id` 吊销指定会话 / 非法 id 400 / 不存在 404 / 越权他人 rowid 404 / DELETE 全端下线含当前端且他人不受影响 / `auth.revoke_session` 与 `auth.logout_all` 审计留痕 |

## 8. 相关文档

- [架构文档](./ARCHITECTURE.md)：分层架构与 REST API 数据流
- [CONTRIBUTING.md](../CONTRIBUTING.md)：开发流程与提交规范
- [README](../README.md)：项目概述
