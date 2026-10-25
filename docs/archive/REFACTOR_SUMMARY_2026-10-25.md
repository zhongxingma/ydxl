# 重构变更摘要（2026-10-25）

> 范围：ydxl 英语学习应用本轮的 P0/P1 安全可靠性加固、代码结构重构与文档治理。
> 原则：保持现有接口与业务行为不变、不引入新依赖；所有改动均通过全量回归验证。
> 状态：改动已实施并通过验证，尚未提交到 Git。

## 1. 总览

| 阶段 | 主题 | 主要成果 |
| --- | --- | --- |
| A（P0） | 安全与权限 | 共享内容写入分级、真实客户端 IP、登录限流键、内部错误不外泄 |
| B（P1） | 可靠性 | 请求超时/取消、敏感值不落明文、跨账号缓存清理、AI 代理输入上限、阅读状态失败可见化 |
| C | 代码结构 | 拆分 3 个超大文件、收敛 4 类重复代码，接口与调用方零改动 |
| D | 文档治理 | 历史快照归档、索引与测试基线同步、文档路径与状态修正 |

回归基线：前端 61 个测试文件 / 715 用例，后端 18 个测试文件 / 216 用例（合计 931）。

## 2. 阶段 A：安全与权限

| 变更 | 说明 | 涉及文件 |
| --- | --- | --- |
| 共享内容写入分级 | 新增 `content:manage` 权限点（teacher/admin）；articles/questions 的编辑与删除前置校验并写审计；文章 POST（AI 回写）保持所有登录用户可用，学生仅可更新 `vocabulary` / `phrases` | `server/src/permissions.ts`、`server/src/routes.ts` |
| 反向代理信任 | 新增 `TRUST_PROXY` 解析与 `app.set('trust proxy', ...)`；Nginx 后设 `1` 时 `req.ip` 取真实客户端地址 | 新增 `server/src/trustProxy.ts`，修改 `server/src/index.ts` |
| 登录限流键 | 由单纯 IP 改为 `IP + 用户名`，避免同一 NAT 出口下不同学生互相误伤 | `server/src/authRoutes.ts` |
| 内部错误脱敏 | words 批量插入单条失败仅返回 `invalid item`，真实 SQLite 错误只写服务端日志 | `server/src/routes.ts`（现 `routes/wordsBulkRouter.ts`） |

新增测试：`contentAuth.test.ts`（6 条）、`trustProxy.test.ts`（8 条）。

## 3. 阶段 B：可靠性

| 变更 | 说明 | 涉及文件 |
| --- | --- | --- |
| 请求超时与取消 | 增加 15 秒超时、支持外部 `signal` 取消，区分「已取消 / 超时 / 网络失败」；错误体优先解析 `{ error: { message } }` | `src/shared/services/localApi.ts` |
| 敏感值降级 | IndexedDB/WebCrypto 不可用时仅保存到内存，不再把 API Key 明文写入 localStorage | `src/shared/services/secureStorage.ts` |
| 跨账号隔离 | 换号登录 / 登出 / 全端下线统一清空 8 张 Dexie 表与 AI 用量记录（`removeItem`） | `src/shared/services/authService.ts`、`src/shared/services/ai/aiUsageTracker.ts` |
| AI 代理输入上限 | 消息条数 ≤ 50、总内容长度 ≤ 100000 字符，超限返回 400 | `server/src/ai-proxy.ts` |
| 阅读状态可见化 | `markAsRead` / `recordReadingStart` 返回是否写入成功；失败时阅读页提示「阅读记录保存失败，请稍后重试」 | `src/features/reading/services/articleService.ts`、`src/features/reading/pages/ReadingPage.tsx` |

新增测试：`localApi.test.ts`（4 条）、`secureStorage.test.ts`（2 条）；扩展 `authService.test.ts`、`aiProxy.test.ts`、`articleDedup.test.ts`。

## 4. 阶段 C：代码结构重构

### 4.1 超大文件拆分

| 文件 | 重构前 | 重构后 | 变化 |
| --- | ---: | ---: | --- |
| `src/shared/services/ai/baseProvider.ts` | 1866 | 1705 | -161，JSON 解析工具迁出 |
| `src/shared/services/ai/jsonParsing.ts` | — | 171 | 新增：JSON 多级容错解析 |
| `server/src/routes.ts` | 757 | 11 | 仅保留统一出口，实现拆入 `server/src/routes/` |
| `server/src/routes/shared.ts` | — | 292 | 新增：白名单/权限/清洗/序列化 |
| `server/src/routes/tableRouter.ts` | — | 168 | 新增：通用表路由 |
| `server/src/routes/articlesRouter.ts` | — | 221 | 新增：共享文章路由 |
| `server/src/routes/wordsBulkRouter.ts` | — | 121 | 新增：批量插入路由 |
| `src/features/reading/pages/ReadingPage.tsx` | 1628 | 1409 | -219，展示块拆为组件 |
| `src/features/reading/components/ReadingHeader.tsx` | — | 114 | 新增：顶部固定栏 |
| `src/features/reading/components/ArticlePhrasesSection.tsx` | — | 60 | 新增：重点短语区块 |
| `src/features/reading/components/ReadingActions.tsx` | — | 179 | 新增：底部操作区 |
| `src/pages/DashboardPage.tsx` | 718 | 650 | -68，内联图标迁出 |

关键兼容性设计：`server/src/routes.ts` 作为统一出口重新导出 `TABLES` / `TableName` / 各 Router 工厂，`index.ts` 与全部服务端测试的导入路径无需改动；AI 解析函数的两个测试改为直接从 `jsonParsing.ts` 导入。

### 4.2 重复代码收敛

| 重复内容 | 处理方式 |
| --- | --- |
| Dashboard 与答题组件的内联 SVG | 新增 `CheckIcon` / `CrossIcon` / `TrendUpIcon` / `TrendDownIcon` / `WarningIcon` 到 `src/shared/components/icons.tsx` |
| 选项字母 `OPTION_LETTERS` | 收敛到 `src/features/reading/types.ts` |
| 练习题生成阶段 `QuizGenStage` | 收敛到 `src/features/reading/types.ts` |
| 计时格式化 `formatDuration` | 收敛到 `src/features/reading/hooks/useReadingTimer.ts` |

## 5. 阶段 D：文档治理

| 变更 | 说明 |
| --- | --- |
| 历史文档归档 | `PROJECT_ANALYSIS_REPORT.md`、`DOC_SYNC_SUMMARY_2026-10-18.md`、`E2E_TEST_REPORT.md` 移入 `docs/archive/`，并在文首添加「历史归档」提示 |
| 文档索引 | `docs/README.md` 新增「历史归档」分区，测试规模修正为前端 61 / 后端 18，并新增「一次性报告统一归档」维护约定 |
| 根 README | 更新测试基线（61 / 715、18 / 216）、项目结构（`routes/`、`jsonParsing`）、多用户 P3 状态与归档入口 |
| 架构文档 | `docs/ARCHITECTURE.md` 更新路由出口、`TABLES` 位置与 JSON 解析模块路径 |
| 变更日志 | `CHANGELOG.md` 新增 Changed / Removed 条目，记录拆分与归档 |

## 6. 验证结果

| 检查项 | 结果 |
| --- | --- |
| 前端 typecheck | 通过 |
| ESLint | 通过 |
| 前端单元测试 | 61 文件 / 715 用例通过 |
| 服务端单元测试 | 18 文件 / 216 用例通过 |
| 前端生产构建 | 通过（PWA precache 45 entries） |
| 服务端 tsc 构建 | 通过 |
| Playwright dev E2E | 10 / 10 通过 |
| Playwright 生产 SW E2E | 1 / 1 通过 |

## 7. 兼容性与风险

- **接口不变**：REST 路径、请求/响应结构、数据库 schema、前端路由均未改动。
- **调用方不变**：服务端路由统一出口保留；AI 解析函数仅调整内部导入路径。
- **依赖不变**：未新增任何运行时或开发依赖。
- **行为不变**：新增的权限校验与错误提示均为原有缺陷的显式化，正常路径行为一致；全量测试与 E2E 已验证。
- **剩余大文件**：`baseProvider.ts`（1705 行）与 `ReadingPage.tsx`（1409 行）仍偏大，后续可按业务能力或 hooks 继续拆分，属独立重构任务，本次未展开以控制风险。

## 8. 待办

- 提交并推送本轮改动，观察 GitHub Actions 全量 CI 结果。
