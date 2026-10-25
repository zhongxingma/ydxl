# 深度重构总结报告（第二轮，2026-10-25）

> 历史快照：本报告记录 2026-10-25 第二轮结构化重构的完成情况，内容不随代码更新。
> 上一轮（P0/P1 安全加固与初步结构治理）见 [REFACTOR_SUMMARY_2026-10-25](./REFACTOR_SUMMARY_2026-10-25.md)。

## 1. 概述

- **目标**：在不改变对外接口、数据库 schema、REST 路由与用户可见行为的前提下，收敛超大文件、按职责拆分模块、补充测试护栏，并同步文档基线。
- **起点**：`c3afbdf`（上一轮安全与结构治理完成，CI 全绿）。
- **终点**：`5b17cfe`（文档基线更新），共 12 个提交，7 次 GitHub Actions 运行全部成功。
- **结论**：6 个重构项 + 1 个文档基线项全部完成；前端测试净增 2 文件 / 7 用例；无新增依赖、无 schema 变更、无接口破坏。

## 2. 实施清单

| # | 事项 | 代码提交 | 拆分前 → 拆分后 | 新增产出 |
| --- | --- | --- | --- | --- |
| 1 | AI Provider 传输层拆分 | `c83fed6` | `baseProvider.ts` 1705 → 1015 行 | `requestRunner.ts`（685 行） |
| 2 | ReadingPage 拆分 | `b2fb6ac` | `ReadingPage.tsx` 1409 → 570 行 | 4 个视图组件 + 3 个 hooks |
| 3 | DashboardPage 拆分 | `38f0219` | `DashboardPage.tsx` 650 → 224 行 | 2 个 hooks + 5 个区块组件 + 冒烟测试 |
| 4 | PracticeStep 生成逻辑拆分 | `53535a9` | `PracticeStep.tsx` 644 → 305 行 | `practiceQuestionGenerator.ts`（354 行）+ 5 个单测 |
| 5 | articleService 按能力拆分 | `d929481` | `articleService.ts` 592 → 55 行 | 生成服务 363 行、阅读服务 212 行、错误类型 16 行 |
| 6 | remoteRepository 拆分 | `da7023f` | `remoteRepository.ts` 618 → 6 行 | REST 基类 119 行、缓存仓储 503 行 |
| 7 | 性能体积基线更新 | `5b17cfe` | §7.1/§7.2 旧估算 → 实测 | JS 合计 1,650,989 B / gzip ~435 KB |

## 3. 结构变化明细

### 3.1 AI Provider 传输层

- [baseProvider.ts](../../src/shared/services/ai/baseProvider.ts)：仅保留业务编排（prompts、9 个公开方法、缓存与去重），`protected callChat` / `callChatStream` 委托执行器。
- [requestRunner.ts](../../src/shared/services/ai/requestRunner.ts)：并发信号量（上限 5）、指数退避重试（1s/2s，最多 2 次）、fetch / SSE 解析、错误映射与 `RetryableAIError`；供应商差异通过 `ProviderRequestContext` 回调注入。
- 子类（DeepSeek / OpenAI / Qwen / Custom）与业务调用方零改动。

### 3.2 阅读页

- [ReadingPage.tsx](../../src/features/reading/pages/ReadingPage.tsx)：只保留视图状态编排、缓存事件、难度弹窗与渲染。
- 视图组件：`ReadingArticleView`（199）、`ReadingQuizView`（77）、`ReadingResultView`（182）、`GrammarInterstitial`（88）。
- 逻辑 hooks：`useArticleLoader`（321，加载 / 题目词汇并行 / 短语补全 / 竞态令牌）、`useQuizRunner`（456，答题 / 语法填空 / 练习流式生成与重试）、`usePrintWorksheet`（94，打印前补齐题目与降级）。

### 3.3 首页仪表盘

- 数据 hooks：`useDashboardOverview`（105，统计概览 / 今日复习 / words 缓存联动）、`useDashboardArticles`（123，历史 / 最近阅读 / 推荐 / 分页 / articles 缓存联动）。
- 区块组件：`DashboardQuickActions`（59）、`DashboardStatGrid`（53）、`DashboardTodayTodo`（119）、`DashboardReviewWords`（64）、`DashboardGrowthPanels`（105，保持 recharts 懒加载）。
- 新增 `DashboardPage.test.tsx`：2 个冒烟用例（概览与待办渲染、历史/推荐空状态）。

### 3.4 复习练习

- `PracticeStep` 仅保留答题交互、提示、错题计数与自动推进。
- `practiceQuestionGenerator` 承载 7 种题型、预设词库、干扰项挑选与随机 3–5 题生成，全部为纯函数。
- 新增 5 个单测：题量区间、4 个不重复选项与答案索引、非词典词无近反义题、字段缺失时题型降级、7 种标签完整性。

### 3.5 文章服务

- `articleService.ts` 仅聚合导出；`articleGenerationService` 负责 AI 生成、contentHash + 标题双重去重、兜底素材库与主题注入；`articleReadService` 负责已读/开始阅读标记、历史与最近阅读、今日已读数、按 id 查询与短语补全；`ArticleNotFoundError` 独立到 `articleErrors`（避免聚合出口循环依赖）。
- 公共导入路径与 `articleService` 对象全部保留。

### 3.6 远程仓储

- `remoteRepository.ts` 仅统一出口；`RemoteRepository`（REST CRUD）在 `remoteRepositoryBase`，`CachedRemoteRepository`（SWR 本地优先、30 秒节流、离线回退、缓存同步）在 `cachedRemoteRepository`。
- 采用「基类独立一层 + 原文件 barrel」而非「原文件保留基类」，避免缓存类与基类形成循环导入。

## 4. 兼容性保证

- **接口不变**：`baseProvider` 的 protected 方法签名、`articleService` 全部命名导出、`remoteRepository` 的 `RemoteRepository` / `CachedRemoteRepository` / `PaginatedResponse` 导出、`PracticeStep` props 均未变化。
- **行为不变**：阅读页视图状态机、SWR 缓存事件联动、30 秒节流、打印补齐与降级、练习题随机分布、recharts 按需加载均保持原逻辑。
- **数据不变**：未修改 SQLite schema、Dexie schema、REST 路由或 AI prompt。
- **依赖不变**：未新增运行时或开发依赖。

## 5. 验证结果

| 项目 | 结果 |
| --- | --- |
| 前端 typecheck | 通过 |
| ESLint | 通过（仅保留 ReadingPage 既有的 1 条 ref cleanup 告警，本轮未引入新告警） |
| 前端单元测试 | 61 → **63 文件 / 722 用例**（净增 2 文件 / 7 用例） |
| 服务端单元测试 | 18 文件 / 216 用例通过 |
| 生产构建 | 通过；全部 JS 1,650,989 bytes / gzip 约 435 KB |
| PWA 预缓存 | 45 entries / 1708.58 KiB |
| Playwright dev E2E | 10 / 10 通过 |
| Playwright 生产 SW E2E | 1 / 1 通过 |
| GitHub Actions | 7 次运行、5 个 job 全部成功 |

CI 运行记录：`40182192059`、`40183950350`、`40185906958`、`40187275572`、`40187933091`、`40188537869`、`40188832705`。

## 6. 文档同步

- `CHANGELOG.md`：新增 6 条 Changed 记录与测试基线更新。
- `docs/ARCHITECTURE.md`：补充阅读页、仪表盘、练习生成器、文章服务、远程仓储的模块边界。
- `docs/TESTING.md` / `README.md` / `docs/README.md` / `docs/CODING_STANDARDS.md` / `docs/MULTI_USER_DESIGN.md`：测试基线统一为前端 63 文件 / 722 用例、合计 938。
- `docs/AI_TOKEN_OPTIMIZATION.md`：AbortController 归属更新为 `useQuizRunner`。
- `docs/TECHNICAL_ANALYSIS.md`：§7.1/§7.2 按最新构建实测重写（含 gzip 口径说明）。

## 7. 风险与遗留

| 项目 | 说明 | 建议 |
| --- | --- | --- |
| `baseProvider.ts`（1015 行） | 业务编排集中（prompts、缓存、9 个公开方法） | 无新增需求前不再拆，避免破坏供应商契约 |
| `requestRunner.ts`（685 行） | 传输层单一职责，已含并发 / 重试 / SSE | 保持现状 |
| `ai/index.ts`（506）、`prompts.ts`（505） | 工厂与提示词文本 | 不属于结构问题 |
| `WordbookPage`（493）、`useProfileSettings`（453） | 尚未拆分的较大文件 | 可列为下一轮候选 |
| `cachedRemoteRepository.ts`（503 行） | 缓存策略集中，内聚性高 | 暂不继续拆 |
| Dashboard 测试深度 | 仅 2 个冒烟用例，交互细节依赖 E2E | 后续可补充分页 / 弹窗用例 |
| PracticeStep 生成器测试 | 基于随机生成的结构性断言，未固定随机种子 | 若出现不稳定再引入 seeded RNG |

## 8. 提交记录

| 提交 | 类型 | 说明 |
| --- | --- | --- |
| `c83fed6` | refactor | AI Provider 传输层拆分至 requestRunner |
| `abecaf7` | docs | 同步 Provider 传输层拆分说明 |
| `b2fb6ac` | refactor | ReadingPage 拆分为视图组件与 hooks |
| `38f0219` | refactor | DashboardPage 拆分为 hooks 与区块组件 |
| `e98ff17` | docs | 同步仪表盘拆分说明与测试基线 |
| `53535a9` | refactor | PracticeStep 题目生成逻辑拆分 |
| `e891577` | docs | 同步练习生成器拆分说明与测试基线 |
| `d929481` | refactor | articleService 按能力拆分 |
| `6e9ac93` | docs | 同步文章服务拆分说明 |
| `da7023f` | refactor | remoteRepository 拆分为基类与缓存仓储 |
| `1d28bc8` | docs | 同步远程仓储拆分说明 |
| `5b17cfe` | docs | 按最新构建更新性能体积基线 |

## 9. 结论

本轮重构完成后，前端最突出的单文件（1409 行的阅读页、650 行的仪表盘、644 行的练习步骤、592 行的文章服务、618 行的仓储、1705 行的 Provider 基类）均已按职责收敛，模块边界与文档描述一致，测试与 CI 全绿。后续如需继续，建议优先评估 `WordbookPage` 与 `useProfileSettings`，并补充 Dashboard 的交互测试深度。
