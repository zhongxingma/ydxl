# 重构总结报告（第四轮：剩余大文件清扫，2026-10-25）

> 历史快照：本报告记录 2026-10-25 第四轮结构化重构的完成情况，内容不随代码更新。
> 第一轮见 [REFACTOR_SUMMARY_2026-10-25](./REFACTOR_SUMMARY_2026-10-25.md)，第二轮见 [REFACTOR_SUMMARY_2026-10-25_ROUND2](./REFACTOR_SUMMARY_2026-10-25_ROUND2.md)，第三轮见 [REFACTOR_SUMMARY_2026-10-25_ROUND3](./REFACTOR_SUMMARY_2026-10-25_ROUND3.md)。

## 1. 概述

- **目标**：在第三轮（生词本 / 个人中心）之后继续清扫超大文件，覆盖组件、AI 层、仓储、阅读、复习与服务端管理路由；保持对外接口、数据库 schema、REST 路由与用户可见行为不变，每批独立验证、独立提交。
- **起点**：`0d0ce8a`（第三轮文档同步，CI 全绿）。
- **终点**：`9501188`（本轮文档同步），区间共 25 个提交（含第三轮报告归档 `c85f441`）。
- **结论**：完成 19 项拆分 + 4 批文档基线同步；全部非测试源文件降至 500 行以内；前端测试净增 1 文件 / 6 用例；无接口破坏、无依赖变更、无 schema / 路由变更；本轮 17 次 GitHub Actions 运行全部成功。

## 2. 实施清单

| 批次 | # | 事项 | 代码提交 | 拆分前 → 拆分后 | 新增产出 |
| --- | --- | --- | --- | --- | --- |
| 一 | 1 | WordCard 拆分 | `96fd8e7` | `WordCard.tsx` 462 → 118 行 | `WordCardHeader`（97）/ `WordCardDetails`（150）/ `WordCardFooter`（54）/ `useLongPress`（140，+6 单测） |
| 一 | 2 | BaseAIProvider 三层拆分 | `8c2bb6e` | `baseProvider.ts` 1015 → 11 行（聚合出口） | `providerCore`（365）/ `providerContentTasks`（406）/ `providerWordTasks`（270） |
| 一 | 3 | Prompt 模板按领域拆分 | `db2f478` | `prompts.ts` 505 → 22 行（聚合出口） | `promptShared`（123）/ `articlePrompts`（257）/ `wordPrompts`（145） |
| 一 | 4 | 已掌握页拆分 | `7c74e59` | `MasteredPage.tsx` 425 → 131 行 | `useMasteredWords`（197）/ `MasteredWordCard`（134） |
| 一 | 5 | 添加文章 Modal 拆分 | `ea331bf` | `AddArticleModal.tsx` 413 → 83 行 | `useAddArticleForm`（183）/ `AddArticleFormFields`（228） |
| 一 | 6 | Token 统计拆分 | `131713d` | `tokenStats.ts` 463 → 300 行 | `tokenStatsTypes`（133）/ `tokenStatsStorage`（61） |
| 一 | 7 | 生词本 / 学习统计服务拆分 | `f30b5f4` | `wordbookService.ts` 441 → 43 行、`statsService.ts` 418 → 53 行 | `wordbookMutationService`（225）/ `wordbookQueryService`（120）/ `wordEnrichmentService`；`statsRecordingService`（157）/ `statsQueryService`（249） |
| 一 | — | 文档基线同步 | `bb573ed`、`96a9738` | 测试基线 / 构建体积 / 模块边界 | CHANGELOG、ARCHITECTURE、TECHNICAL_ANALYSIS、TESTING |
| 二 | 8 | AI 请求执行器再拆分 | `648c840` | `requestRunner.ts` 685 → 418 行 | `requestTypes`（40）/ `requestRetry`（89）/ `requestPayload`（128）/ `sseParser`（78） |
| 二 | 9 | AI 供应商入口拆分 | `9d6cb9a` | `ai/index.ts` 506 → 68 行（聚合出口） | `aiConfig`（231）/ `providerFactory`（171）/ `aiProviderProxy`（77） |
| 二 | 10 | 缓存仓储拆分 | `30d3541` | `cachedRemoteRepository.ts` 503 → 383 行 | `localIndexRepository`（111）/ `cacheSync`（53） |
| 二 | 11 | 个人中心页面拆分 | `0fbc8ad` | `ProfilePage.tsx` 414 → 104 行 | `ProfileStatsGrid`（64）/ `ProfilePreferencesSection`（189）/ `ProfileAISettingsSection`（149） |
| 二 | 12 | 服务端 AI 代理拆分 | `2fc84d6` | `ai-proxy.ts` 577 → 62 行 | `aiProxyUpstreams`（92）/ `aiProxyTransport`（232）/ `aiProxyStream`（164）/ `aiProxyAudit`（27）/ `aiProxyLimiter`（45） |
| 二 | — | 文档基线同步 | `ac986f8` | 测试基线 / 构建体积 / 模块边界 | CHANGELOG、ARCHITECTURE、TECHNICAL_ANALYSIS |
| 三 | 13 | 阅读页生命周期拆分 | `b3e2102` | `ReadingPage.tsx` 570 → 459 行 | `useReadingLifecycle`（151）/ `ReadingPageFallback`（48） |
| 三 | 14 | 答题流程拆分 | `d89eb02` | `useQuizRunner.ts` 456 → 254 行 | `useContentGeneration`（141）/ `useMarkAsRead`（199） |
| 三 | 15 | 查词 hook 拆分 | `8d6d5cb` | `useWordLookup.ts` 402 → 94 行 | `useWordSelectionPopover`（298）/ `useWordbookActions`（103） |
| 三 | 16 | 题目服务拆分 | `cd6cbfd` | `questionService.ts` 378 → 181 行 | `questionValidation`（115）/ `questionMapper`（119） |
| 三 | — | 文档基线同步 | `2fa2eb3` | 测试基线 / 构建体积 / 模块边界 | CHANGELOG、ARCHITECTURE、TECHNICAL_ANALYSIS |
| 四 | 17 | 朗读 / 拼写步骤拆分 | `65b4d6d` | `ReadStep.tsx` 384 → 267 行、`SpellStep.tsx` 382 → 231 行 | `useReadStep`（167）/ `useSpellStep`（179）/ `spellHint`（24） |
| 四 | 18 | 复习页拆分 | `a29046b` | `ReviewPage.tsx` 353 → 105 行 | `useReviewPage`（287）/ `ReviewProgressHeader`（50） |
| 四 | 19 | 管理路由拆分 | `93dfa0f` | `server/src/adminRoutes.ts` 363 → 26 行 | `adminUserRoutes`（248）/ `adminLogRoutes`（82）/ `adminClassStatsRoute`（34） |
| 四 | — | 文档基线同步 | `9501188` | 测试基线 / 构建体积 / 模块边界 | CHANGELOG、ARCHITECTURE、TECHNICAL_ANALYSIS |

> 行数为提交版本实测（含空行与注释）。区间源码（不含测试）合计 76 文件、+8,477 / −7,210 行；新增模块承担了从原文件迁出的职责，净增主要来自拆分后的模块头注释与导出声明。

## 3. 结构变化明细

### 3.1 组件与业务服务（批次一）

- [WordCard.tsx](../../src/features/wordbook/components/WordCard.tsx)：仅保留组合、toast 与长按接线；头部 / 详情 / 底部分别为 `WordCardHeader` / `WordCardDetails` / `WordCardFooter`，长按手势复用 `shared/hooks/useLongPress`（触摸 / 鼠标长按、10px 滑动取消、与 click 互斥）。
- [baseProvider.ts](../../src/shared/services/ai/baseProvider.ts)：保留为聚合出口；配置 / 密钥解析 / 端点与传输委托在 `providerCore`，文章 / 题目 / 语法填空 / 翻译 / 词汇 / 短语任务在 `providerContentTasks`，单词提示 / 拼读 / 助记 / 例句 / emoji / 连通性测试 / 补全在 `providerWordTasks`，子类继承路径不变。
- `prompts.ts`：拆为 `promptShared`（输出规则 / 文体题材难度映射 / 创作风格预设）+ `articlePrompts` + `wordPrompts`，原文件只做再导出。
- `tokenStats.ts`：拆为类型与定价表（`tokenStatsTypes`）、localStorage 读写与条目校验（`tokenStatsStorage`）、内存聚合与成本估算（`tokenStats.ts`）。
- `wordbookService.ts` / `statsService.ts`：按写入、查询、AI 补全与录制、区间查询拆分，聚合出口与调用方导入路径不变。
- `MasteredPage` 与 `AddArticleModal`：列表逻辑（分页 / 搜索防抖 / 排序 / 无限滚动 / 缓存失效重载）与表单逻辑（字段状态 / AI 翻译 / 保存 / 关闭清理）分别下沉到 hooks，视图拆为独立组件。

### 3.2 AI 传输、仓储、个人中心与服务端代理（批次二）

- [requestRunner.ts](../../src/shared/services/ai/requestRunner.ts)：保留流程编排；类型、退避重试 / 并发限流、请求头与信封构造 / 错误解析、SSE 解析分别独立；重试策略（1s/2s，最多 2 次）与并发上限（5）保持不变。
- `ai/index.ts`：配置解析（环境变量 / localStorage / secureStorage）、供应商实例装配与兜底链、免刷新动态单例分别独立，导出面不变。
- `cachedRemoteRepository.ts`：`where` / `count` 等索引查询迁至 `LocalIndexRepository` 基类，远程 → 本地增量同步迁至 `cacheSync`；服务器为主 + Dexie 缓存、SWR 本地优先、30 秒节流与离线回退语义不变。
- `ProfilePage.tsx`：统计卡、偏好设置、AI 配置拆为三个区块组件，页面仅保留编排与语言切换。
- `server/src/ai-proxy.ts`：上游注册、传输、SSE、审计、限流分模块；四供应商路由与 `/v1/ai-proxy/*` 路径不变。

### 3.3 阅读模块（批次三）

- [ReadingPage.tsx](../../src/features/reading/pages/ReadingPage.tsx)：加载 / 完成标记 / 缓存刷新 / toast / 难度选择副作用迁至 `useReadingLifecycle`，骨架屏与错误态拆为 `ReadingPageFallback`。
- `useQuizRunner.ts`：语法填空 / 词汇生成与重试迁至 `useContentGeneration`，已读保存与按需出题迁至 `useMarkAsRead`，对外返回字段不变。
- `useWordLookup.ts`：选区处理 / 查词竞态 / 浮层关闭迁至 `useWordSelectionPopover`，单个与批量加入生词本迁至 `useWordbookActions`。
- `questionService.ts`：结构校验 / id 规范化 / 错误消息 / 去重文本迁至 `questionValidation`，AI 结果转 `Question` 实体迁至 `questionMapper`；本地优先查询与 in-flight 协调保留在服务层。

### 3.4 复习模块与服务端管理路由（批次四）

- [ReadStep.tsx](../../src/features/review/steps/ReadStep.tsx)：语速切换 / 波形 / 录音回放与评分 / AI 拼读提示迁至 `useReadStep`，组件仅负责渲染。
- [SpellStep.tsx](../../src/features/review/steps/SpellStep.tsx)：输入 / 分级提示 / 抖动与闪现状态迁至 `useSpellStep`，分级遮罩 `getMask` 独立到 `spellHint`；`GIVE_UP_THRESHOLD = 2` 与提示递进顺序不变。
- [ReviewPage.tsx](../../src/features/review/pages/ReviewPage.tsx)：视图状态机 / 队列加载 / 评分与成就处理迁至 `useReviewPage`，sticky 进度条拆为 `ReviewProgressHeader`，页面仅保留三视图路由与共享 overlay。
- [adminRoutes.ts](../../server/src/adminRoutes.ts)：仅保留权限分组与路由组装（`/users` → `users:manage`、`/logs` → `logs:view`、`/class-stats` → `stats:class`）；用户管理五端点、审计日志查询 / CSV 导出、班级学情聚合分别落到 `adminUserRoutes` / `adminLogRoutes` / `adminClassStatsRoute`。

## 4. 兼容性保证

- **接口不变**：所有聚合出口（`baseProvider` / `prompts` / `tokenStats` / `wordbookService` / `statsService` / `ai/index` / `remoteRepository` / `shared/services`）的导出名称与类型保持；各 hook 的返回字段与组件 props 保持。
- **行为不变**：AI 重试与并发策略、缓存 SWR / 30 秒节流 / 离线回退、搜索防抖、分页页大小、复习五步流程、打印降级、RBAC 权限矩阵与审计留痕均按原逻辑迁移。
- **数据不变**：未修改 SQLite / Dexie schema、REST 路由、localStorage key 或环境变量契约。
- **依赖不变**：未新增任何运行时或开发依赖。

## 5. 验证结果

| 项目 | 结果 |
| --- | --- |
| 前端 typecheck | 通过 |
| ESLint | 通过（仅保留 `useReadingLifecycle` 中既有 ref cleanup 告警 1 条，CI 不阻断） |
| 前端单元测试 | 64 → **65 文件 / 725 → 731 用例**（净增 1 文件 / 6 用例，来自 `useLongPress`） |
| 服务端单元测试 | 18 文件 / 216 用例通过 |
| 生产构建 | 通过；33 个 JS chunk 合计 1,659,787 bytes / gzip **437.9 KiB** |
| PWA 预缓存 | 45 entries / 1717.18 KiB |
| Playwright dev E2E | 10 / 10 通过 |
| Playwright 生产 SW E2E | 1 / 1 通过 |
| GitHub Actions | 区间 17 次运行全部 success，最后一次 [run 40200564900](https://github.com/zhongxingma/ydxl/actions/runs/40200564900) 五个 job 全部通过 |

## 6. 文档同步

- `CHANGELOG.md`：新增 19 条拆分记录（按四批排列），测试基线更新为 65 文件 / 731 用例；同时按提交版本实测校正历史条目中的拆分后行数。
- `docs/ARCHITECTURE.md`：补充 WordCard、AI 三层、Prompt、Token、生词本 / 统计服务、请求执行器、AI 入口、缓存仓储、个人中心、服务端代理、阅读页生命周期、答题、查词、题目服务、复习步骤、复习页与 `adminRoutes` 的模块边界。
- `docs/TECHNICAL_ANALYSIS.md`：§7.1 基线更新为约 438 KB（gzip），§7.2 按最新产物更新 index / ReadingPage / ReviewPage / DashboardPage / 其他 chunk 与合计体积。
- `docs/TESTING.md`、`README.md`、`docs/README.md`：测试基线与归档索引同步。
- `docs/README.md`：新增本报告条目。

## 7. 风险与遗留

| 项目 | 说明 | 建议 |
| --- | --- | --- |
| `ReadingPage.tsx`（459 行） | 已仅剩编排与渲染，非测试源文件中最大 | 无新增需求前不再拆 |
| `requestRunner.ts`（418 行） / `providerContentTasks.ts`（406 行） | 传输与内容任务内聚，职责单一 | 保持现状 |
| 构建体积较第三轮 +约 8 KB | 新开模块头注释与导出声明带来轻微增量，gzip 仍在 438 KB | 可接受，后续按需再评估 |
| 大文件集中在测试套件 | `ai-provider.test`（1390）、`wordbookService.test`（1006）、`remoteRepository.test`（955）、`statsService.test`（947） | 如需继续收敛，可按 `describe` 分文件 |
| `useReadingLifecycle` lint 告警 | ref cleanup 既有告警，非本轮引入 | 非阻断，可后续单独处理 |
| 拆分后新增 hook 的单测覆盖 | `useReadStep` / `useSpellStep` / `useReviewPage` 主要依赖既有页面与 E2E 覆盖 | 可按需补充针对性单测 |

## 8. 提交记录

| 提交 | 类型 | 说明 |
| --- | --- | --- |
| `c85f441` | docs | 第三轮重构总结报告归档 |
| `96fd8e7` | refactor | WordCard 头部 / 详情 / 底部与长按手势拆分 |
| `bb573ed` | docs | WordCard 拆分后的测试基线与构建体积 |
| `8c2bb6e` | refactor | BaseAIProvider 拆分为核心层与内容 / 单词任务层 |
| `db2f478` | refactor | Prompt 模板按领域拆分 |
| `7c74e59` | refactor | 已掌握页列表逻辑与单词卡片拆分 |
| `ea331bf` | refactor | 添加文章表单逻辑与字段视图拆分 |
| `131713d` | refactor | Token 统计类型定价与持久化拆分 |
| `f30b5f4` | refactor | 生词本与学习统计服务按职责拆分 |
| `96a9738` | docs | 本批拆分与构建体积基线同步 |
| `648c840` | refactor | 请求执行器的重试、请求构造与 SSE 解析拆分 |
| `9d6cb9a` | refactor | AI 供应商配置、工厂与动态单例拆分 |
| `30d3541` | refactor | 缓存仓储的索引查询基类与同步工具拆分 |
| `0fbc8ad` | refactor | 个人中心统计与设置区块拆分 |
| `2fc84d6` | refactor | 服务端 AI 代理上游注册、传输、流式与限流拆分 |
| `ac986f8` | docs | 本批拆分与构建体积基线同步 |
| `b3e2102` | refactor | 阅读页生命周期与兜底视图拆分 |
| `d89eb02` | refactor | 答题生成与阅读完成逻辑拆分 |
| `8d6d5cb` | refactor | 查词浮层与生词本写入动作拆分 |
| `cd6cbfd` | refactor | 题目校验与生成结果转换拆分 |
| `2fa2eb3` | docs | 本批拆分与构建体积基线同步 |
| `65b4d6d` | refactor | 朗读与拼写步骤的状态逻辑拆分 |
| `a29046b` | refactor | 复习页状态机与进度条拆分 |
| `93dfa0f` | refactor | 管理路由的用户 / 日志 / 学情处理器拆分 |
| `9501188` | docs | 复习步骤 / 复习页 / 管理路由拆分与构建基线同步 |

## 9. 结论

本轮完成后，全部非测试源文件均降至 500 行以内（最大 `ReadingPage.tsx` 459 行），页面 / 组件只保留编排与渲染，状态与副作用集中于对应 hooks，服务与路由按领域聚合出口。对外接口、用户可见行为、数据 schema 与 REST 路由均未变化，测试与 CI 全绿。后续如需继续治理，重点已从业务源码转移到体量较大的测试套件。
