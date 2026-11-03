# 重构总结报告（测试套件治理，2026-10-26）

> 历史快照：本报告记录 2026-10-25 至 2026-10-26「测试套件治理」工作的完成情况，内容不随代码更新。
> 第四轮业务源码重构见 [REFACTOR_SUMMARY_2026-10-25_ROUND4](./REFACTOR_SUMMARY_2026-10-25_ROUND4.md)。

## 1. 概述

- **目标**：在第四轮完成非测试源码拆分（全部 ≤ 500 行）后，治理体量过大的测试套件——将 400 行以上的测试文件按 `describe` / 职责拆分为聚焦文件，抽取重复的 mock 与测试数据工厂为共享 harness；严格保持用例数量、用例名、断言与业务行为不变，每批独立验证、独立提交。
- **起点**：`2c355e9`（第四轮报告归档，CI 全绿）。
- **终点**：`3164b4a`（本轮文档同步），区间共 8 个提交（6 个测试拆分 + 2 个文档同步）。
- **范围**：仅改动 `__tests__/` 下的测试文件与共享 harness，以及 `*.md` 文档；**未改动任何生产源码、数据库 schema、REST 路由或依赖**（区间 95 个变更文件中 0 个非测试非文档文件）。
- **结论**：19 个不同测试文件经历 20 次拆分，产出 53 个聚焦测试文件 + 15 个共享 harness；测试文件总数 83 → 121（前端 65 → 99，后端 18 → 22）；用例总数保持前端 731 + 后端 216 不变；最大测试文件由 1390 行降至 395 行，全部测试文件 ≤ 400 行；两次检查点 GitHub Actions 运行五个 job 全部成功。

## 2. 规模变化

| 指标 | 起点 `2c355e9` | 终点 `3164b4a` | 变化 |
| --- | --- | --- | --- |
| 前端测试文件 | 65 | 99 | +34 |
| 后端测试文件 | 18 | 22 | +4 |
| 测试文件合计 | 83 | 121 | +38 |
| 前端用例 | 731 | 731 | 0 |
| 后端用例 | 216 | 216 | 0 |
| 最大测试文件 | 1,390 行（`ai-provider.test.ts`） | 395 行（`statsService.trend.test.ts`） | −995 |
| 非测试源码最大文件 | 460 行（`ReadingPage.tsx`） | 460 行（未触碰） | 0 |
| 共享 harness / 辅助模块 | — | 15 个（本轮新增） | +15 |

区间变更规模：95 个文件、+11,906 / −11,486 行；其中测试区域 86 个文件（+11,827 / −11,427），文档 9 个文件（+79 / −59）。

## 3. 实施清单

| 批次 | 提交 | 拆分文件（拆分前行数） | 产出（行数） | 文件变化 |
| --- | --- | --- | --- | --- |
| 一 | `2951e57` | `ai-provider.test.ts`（1390） | `ai-jsonParsing`（85）/ `ai-prompts-schema`（159）/ `ai-provider-cache`（102）/ `ai-provider-enrich`（204）/ `ai-provider-finetune`（257）/ `ai-provider-request`（332）/ `ai-provider-retry`（104）/ `ai-provider-validation`（163） | 前端 65 → 79 |
| 一 | `2951e57` | `remoteRepository.test.ts`（955） | `remoteRepository.update`（126）/ `.offline`（198）/ `.swr`（373）/ `.refreshSync`（261）+ harness（29） | 同上 |
| 一 | `2951e57` | `wordbookService.test.ts`（1006） | `wordbookService.mutation`（236）/ `.enrich`（329）/ `.query`（269）+ harness（181） | 同上 |
| 一 | `2951e57` | `statsService.test.ts`（947） | `statsService.query`（208）/ `.trend`（395）/ `.recording`（170）+ harness（179） | 同上 |
| 一 | — | 文档基线同步（本批并入 `3ccd5d7`） | — | — |
| 二 | `ad708c1` | `crossModuleFlow.test.ts`（710） | `crossModuleFlow.reviewMastery`（193）/ `.readingStats`（118）/ `.readingWordbook`（142）+ harness（276） | 前端 79 → 84、后端 18 → 19 |
| 二 | `ad708c1` | `ai-proxy-contract.test.ts`（623） | `ai-proxy-contract.envelope`（79）/ `.request`（289）/ `.retry`（271） | 同上 |
| 二 | `ad708c1` | `vocabularyService.cache.test.ts`（654） | `vocabularyService.cache`（227）/ `vocabularyService.build`（80）+ harness（85） | 同上 |
| 二 | `ad708c1` | `server/aiProxy.test.ts`（520，开始拆分） | `aiProxyCustom`（142）+ `aiProxyTestApp`（12） | 同上 |
| 三 | `d4b360d` | `tokenStats.test.ts`（592） | `tokenStats.record`（104）/ `.stats`（253）/ `.cost`（254） | 前端 84 → 88、后端 19 → 21 |
| 三 | `d4b360d` | `storageManager.test.ts`（548） | `storageManager.capacity`（124）/ `.cleanup`（325）+ harness（108） | 同上 |
| 三 | `d4b360d` | `articleDedup.test.ts`（547） | `articleDedup`（288）/ `articleFallbackDedup`（129）+ harness（156） | 同上 |
| 三 | `d4b360d` | `server/routes.test.ts`（548） | `routesArticles`（149）/ `routesTables`（252）/ `routesWordsBulk`（118）+ helper（50） | 同上 |
| 四 | `ee307e9` | `questionService.test.ts`（508） | `questionService.cache`（232）/ `.grammar`（173）+ harness（108） | 前端 88 → 90、后端 21 → 22 |
| 四 | `ee307e9` | `reviewService.test.ts`（502） | `reviewService.queue`（171）/ `.weighted`（238）+ harness（93） | 同上 |
| 四 | `ee307e9` | `server/aiProxy.test.ts`（520，完成拆分） | `aiProxyForward`（252）/ `aiProxyValidation`（300） | 同上 |
| 四 | — | 文档基线同步 `3ccd5d7` | TESTING 清单 / 规模基线 / CHANGELOG | — |
| 五 | `b5b2854` | `sm2.test.ts`（463） | `sm2`（156）/ `sm2.weighted`（300） | 前端 90 → 93 |
| 五 | `b5b2854` | `vocabularyService.cache.test.ts`（496，二次拆分） | `vocabularyService.cache`（227）/ `vocabularyService.persistence`（290） | 同上 |
| 五 | `b5b2854` | `articlePromptInjection.test.ts`（441） | `articlePromptInjection`（159）/ `articlePromptContent`（166）+ harness（124） | 同上 |
| 六 | `ca3c786` | `ReadingPage.raceAndMarkAsRead.test.tsx`（485） | `ReadingPage.markAsRead`（240）/ `.raceProtection`（103）/ `.grammarChoice`（144）+ helper（94） | 前端 93 → 99 |
| 六 | `ca3c786` | `tokenOptimization.verification.test.ts`（462） | `tokenOptimization.cache`（185）/ `.modelTier`（93）/ `.dedup`（63）+ fixtures（191） | 同上 |
| 六 | `ca3c786` | `e2e-flow.test.ts`（486） | `e2e-flow.article`（105）/ `.learning`（134）/ `.complete`（115）+ harness（202） | 同上 |
| 六 | — | 文档基线同步 `3164b4a` | 测试规模 99 / 121 文件同步 | — |

> 行数为当前提交版本实测（含空行与注释）。`vocabularyService.cache.test.ts` 在批次二与批次五各拆分一次，故 19 个不同文件对应 20 次拆分操作。

## 4. 拆分明细

### 4.1 AI Provider、代理契约与 Token 统计

- `ai-provider.test.ts`（1390 行）按主题拆为 8 个文件：JSON 解析、Prompt Schema、请求构造、重试与超时、结果校验、单词补全、参数调优、响应缓存；原 `describe` 块整体迁移，用例名与断言未改动。
- `ai-proxy-contract.test.ts`（623 行）按契约面拆为信封结构、请求参数、重试分类三个文件。
- `tokenStats.test.ts`（592 行）拆为用量记录、统计聚合、成本估算三个文件。
- 共享的 `installFetchMock` / `installFetchMockSequence` / `restoreFetch` 仍统一来自 `src/test/setup.ts`，未新增重复实现。

### 4.2 仓储、存储、跨模块与端到端流程

- `remoteRepository.test.ts`（955 行）拆为 update 分级兜底、离线持久化、SWR 本地优先、后台刷新与增量同步四个文件，mock 状态集中到 `remoteRepositoryTestMocks`。
- `storageManager.test.ts`（548 行）拆为容量检测与清理策略，公共 harness 提供 Dexie / 配额模拟。
- `crossModuleFlow.test.ts`（710 行）拆为复习→掌握、阅读→统计、阅读→生词三个跨模块流程，共享内存仓储 harness。
- `e2e-flow.test.ts`（486 行）拆为文章与题目、生词本与统计、完整闭环三个文件，`e2eFlowTestMocks` 以 ESM live binding 导出内存存储，保持各用例独立安装 / 恢复。

### 4.3 生词本、统计、题目、复习与 SM-2

- `wordbookService.test.ts`（1006 行）拆为新增 / 删除 / 笔记 / 统计 / 批量（mutation）、AI 补全（enrich）、列表查询（query）。
- `statsService.test.ts`（947 行）拆为概览与区间查询、阅读能力趋势、学习记录写入。
- `questionService.test.ts`（508 行）拆为本地缓存与 AI 生成校验、语法填空与阅读理解去重。
- `reviewService.test.ts`（502 行）拆为队列与逾期判断、加权结果与掌握流转。
- `sm2.test.ts`（463 行）拆为基础算法与加权算法 / clamp 边界。

### 4.4 阅读模块

- `vocabularyService.cache.test.ts` 先拆出高亮生词转换（`build`），再拆出文章实体持久化与旧缓存迁移（`persistence`），缓存字段与命中用例保留在原文件。
- `articlePromptInjection.test.ts`（441 行）拆为历史主题注入与 Prompt 内容（Schema 精简 / 随机叙事视角 / 题材简报），mock 提取为 `articlePromptTestMocks`。
- `ReadingPage.raceAndMarkAsRead.test.tsx`（485 行）拆为阅读完成与开始答题入口、加载竞态保护、语法填空生成选择页，数据工厂 / 渲染辅助 / IntersectionObserver mock 提取为 `readingPageRenderHelpers`。
- `tokenOptimization.verification.test.ts`（462 行）拆为响应缓存（场景 1 / 4）、模型分级（场景 2）、并发去重（场景 3），典型响应序列与用户流程模拟提取为 `tokenOptimizationTestFixtures`。

### 4.5 服务端

- `server/src/__tests__/routes.test.ts`（548 行）拆为文章路由、其余 7 张表路由、words 批量端点，Express 测试 app 构造提取为 `routesTestApp`。
- `server/src/__tests__/aiProxy.test.ts`（520 行）拆为转发、校验、custom 上游三个文件，测试 app 与配置提取为 `aiProxyTestApp`。

## 5. 兼容性与质量保证

- **用例不变**：拆分严格按原 `describe` / `it` 块迁移，用例名、断言与执行顺序保持一致；前端 731、后端 216 用例总数在起点与终点完全一致。
- **生产代码零改动**：区间内 0 个非测试非文档文件变更，故构建产物、数据库 schema、REST 路由、localStorage key 与环境变量契约均保持不变。
- **依赖零变更**：未新增运行时或开发依赖。
- **mock 注册顺序保持**：`vi.mock` 仍保留在测试文件或其专属 mock 模块中，并在被测组件导入前完成注册；共享 harness 只承载 mock 实例、工厂与辅助函数。
- **可独立运行**：每个拆分文件均可单独执行（`npx vitest run <file>`），并各自管理安装 / 恢复，避免测试间状态泄漏。

## 6. 验证结果

| 项目 | 结果 |
| --- | --- |
| 前端 typecheck | 通过 |
| ESLint | 通过（仅保留 `useReadingLifecycle` 中既有 ref cleanup 告警 1 条，非本轮引入、CI 不阻断） |
| 前端单元测试 | 99 文件 / 731 用例全部通过（用例数未变） |
| 服务端单元测试 | 22 文件 / 216 用例全部通过（用例数未变） |
| 生产构建 | 通过；33 个 JS chunk 合计 1,659,787 bytes / gzip **437.9 KiB** |
| PWA 预缓存 | 45 entries / 1717.18 KiB |
| Playwright dev E2E | 10 / 10 通过 |
| Playwright 生产 SW E2E | 1 / 1 通过 |
| GitHub Actions（批次一~四检查点） | [run 40205232239](https://github.com/zhongxingma/ydxl/actions/runs/40205232239) 五个 job 全部 success |
| GitHub Actions（批次五~六检查点） | [run 40241962039](https://github.com/zhongxingma/ydxl/actions/runs/40241962039) 五个 job 全部 success |

构建体积与 PWA 预缓存清单与第四轮完全一致，印证本轮未触碰生产源码。

## 7. 文档同步

- `docs/TESTING.md`：第 7 节测试清单按新文件重写，文件数更新为 121（前端 99 + 后端 22）、用例 947；补充共享 harness 与拆分说明。
- `docs/AI_TOKEN_OPTIMIZATION.md`：第一轮验证脚本引用由单文件改为 `tokenOptimization.cache` / `.modelTier` / `.dedup`，运行命令同步。
- `docs/CODING_STANDARDS.md`、`docs/MULTI_USER_DESIGN.md`、`CONTRIBUTING.md`、`README.md`、`docs/README.md`：测试规模基线统一为前端 99 文件 / 731 用例 + 后端 22 文件 / 216 用例。
- `CHANGELOG.md`：新增测试套件两批拆分记录，测试基线与 CI 描述同步。
- `BUGLOG.md`：BUG-001 回归验证命令更新为拆分后的 ReadingPage 测试文件。

## 8. 风险与遗留

| 项目 | 说明 | 建议 |
| --- | --- | --- |
| 共享 harness 数量增加（15 个） | mock 工厂集中后，单个 harness 变更会影响多个测试文件 | 修改 harness 后至少运行对应目录的全量测试；CI 已覆盖全量回归 |
| 用例一致性依赖人工迁移 | 拆分保持用例名 / 断言不变，但没有自动化的「拆分前后用例 diff」校验，仅以数量与全绿为判据 | 后续可引入 `--reporter=json` 生成用例清单快照对比 |
| 最大测试文件 395 行 | 已低于 400 行阈值，继续拆分收益有限 | 维持现状，新增用例优先放入对应职责文件 |
| 无覆盖率工具 | 拆分可能掩盖个别用例遗漏，当前依赖总数与 CI | 规划引入 c8 / istanbul，设定模块阈值 |
| `useReadingLifecycle` lint 告警 | 既有 ref cleanup 告警，非本轮引入 | 非阻断，可单独处理 |
| 中间提交未逐一触发 CI | 推送按批次检查点合并，批次内提交仅本地验证 | 检查点运行均为全绿，可接受 |

## 9. 提交记录

| 提交 | 类型 | 说明 |
| --- | --- | --- |
| `2951e57` | test | AI / 仓储 / 生词本 / 统计测试套件拆分（4 文件 → 18 测试文件 + 3 harness） |
| `ad708c1` | test | 跨模块流程 / 词汇缓存 / AI 代理契约 / 服务端代理测试拆分 |
| `d4b360d` | test | Token 统计 / 存储管理 / 文章去重 / REST 路由测试拆分 |
| `ee307e9` | test | 题目 / 复习服务 / 服务端 AI 代理测试拆分 |
| `3ccd5d7` | docs | 测试清单、规模基线与 CHANGELOG 同步 |
| `b5b2854` | test | SM-2 / 词汇缓存 / 文章 Prompt 测试拆分 |
| `ca3c786` | test | ReadingPage / Token 验证 / E2E 流程测试拆分 |
| `3164b4a` | docs | 测试基线更新为 99 个前端测试文件并同步相关文档 |

## 10. 结论

本轮把测试套件从「少量超大文件」整理为「按职责聚焦的小文件 + 共享 harness」：所有测试文件降至 400 行以内（最大 395 行），文件总数 83 → 121，用例总数严格保持 947 不变；生产源码、数据 schema、REST 路由与依赖零改动，构建体积与 PWA 预缓存清单与第四轮完全一致，本地全量测试、构建、E2E 与两个检查点 CI 均全绿。

至此，业务源码（≤ 500 行）与测试套件（≤ 400 行）均完成结构治理，暂无继续拆分的候选文件。后续质量工作的重点可转向覆盖率工具引入与用例清单快照校验。
