# 项目全面深度分析报告（多维度审计）

> 分析对象：`ydxl` 英语学习 PWA（React 18 + Vite 6 + TypeScript + Express 4 + better-sqlite3）
> 分析时间：2026-11-01 ｜ 分析方式：静态度量 + 依赖审计 + 架构走查 + 测试/CI 核对，所有结论标注可验证依据
> 与 [PROJECT_ANALYSIS_REPORT.md](./PROJECT_ANALYSIS_REPORT.md)（当前基线 + 改进路线图）的关系：本报告是**面向迭代决策的多维度审计**，维度划分与该基线报告互补；数值口径以本文实测为准。

---

## 0. 执行摘要

**总体判断**：这是一个**工程成熟度较高、结构清晰、测试与质量门禁完备**的中型全栈应用。架构分层合理、依赖精简、生产依赖零漏洞、代码卫生优秀（`any` 与 TODO 均为 0）、CI 六段流水线覆盖质量→测试→构建→E2E。核心短板集中在三处：**i18n 尚未全量清零**、**chart 等大 chunk 未按需加载**、**开发协作流程缺少 PR/CODEOWNERS/依赖自动更新等治理件**。（P0 项 i18n 九大模块与图表按需加载已于本次完成，见 §6）

**健康度评分（满分 5）**

| 维度 | 评分 | 概要 |
| --- | --- | --- |
| 1. 基础信息与架构 | 4.5 | 三层分离 + 垂直模块 + 配置驱动，扩展成本低 |
| 2. 代码质量与工程化 | 4.5 | 类型严格、卫生优秀、模块单一；大文件已收敛 |
| 3. 功能完整性 | 4.0 | 主链路闭环；i18n 与少数边界仍需补齐 |
| 4. 性能与稳定性 | 4.0 | 虚拟化/缓存/超时到位；已接入 Sentry 可选错误上报；大 chunk 已按需加载 |
| 5. 开发流程与 CI/CD | 4.5 | 六段门禁完整 + PR 治理件 + CodeQL/依赖审查；仅剩自动部署 |
| 6. 风险可控性 | 4.0 | 高风险项（依赖漏洞、数据隔离、限流）已修；剩余为中低 |

**一句话结论**：可支撑当前规模稳定迭代；建议按 §6 的 P0→P2 优先级推进，重点是「英文界面一致性 → 图表按需加载 → 协作治理件」。

---

## 1. 项目基础信息与架构合理性

### 1.1 项目定位与业务目标

- **定位**：面向初中水平学习者的**纯英文阅读 + AI 内容生成 + 科学复习（SM-2）**英语学习 PWA，支持多用户（admin / teacher / student 三角色）。
- **核心价值主张**：
  1. 每日精选/生成英文文章（200–300 词，词汇不超中考大纲），沉浸式纯英文阅读 + 一键全文翻译 + 全文朗读；
  2. AI 自动生成阅读理解题、语法填空题、生词/短语标注（多供应商：DeepSeek / OpenAI / 通义千问 / 自定义）；
  3. 基于遗忘曲线（SM-2）的科学复习 + 学习统计 + 成就激励；
  4. PWA 离线可用，服务器本地 SQLite 存储，无云端强制依赖。
- **业务目标**：让学生「读—学—练—复习」形成闭环，教师/管理员可查班级学情与审计，成本（AI token）可预算可控。

### 1.2 技术栈选型（合理性评估）

| 层 | 选型 | 评估 |
| --- | --- | --- |
| 前端框架 | React 18 + TypeScript 5.6 | ✅ 生态成熟、类型安全；StrictMode + 懒加载 |
| 构建 | Vite 6 | ✅ 开发/构建快，PWA 插件链完整 |
| 状态 | Zustand + Dexie(IndexedDB) | ✅ 轻量；Dexie 作为离线只读缓存、SWR 模式合理 |
| UI/样式 | Tailwind（darkMode class） | ✅ 原子化、深色模式支持好 |
| 图表 | Recharts | ⚠️ 功能够用，但打包成独立 398KB chunk，未按需加载（见 §4） |
| 后端 | Express 4 + better-sqlite3 | ✅ 单文件 SQLite、WAL、`busy_timeout`，零外部 DB 依赖 |
| 数据库 | SQLite 12 表 + Dexie 8 表 | ✅ 单机场景极简；多写者扩展性已评估（Postgres 迁移触发条件见 DATABASE §3.10） |
| AI | 自研 Provider 分层 + `config/ai-providers.json` 注册表 | ✅ 配置驱动，新增供应商成本低 |
| 认证 | scrypt + 不透明 session + RBAC | ✅ 无 JWT 依赖、可即时吊销、权限矩阵集中 |

**结论**：技术栈选型**克制且贴合场景**（本地单机 + 多用户教学），无过度设计；后端仅 5 个生产依赖（better-sqlite3 / cors / dotenv / express / express-rate-limit），维护面极小。

### 1.3 架构设计与合理性

**三层分离 + 垂直模块**：
- 前端 `src/features/*`（10 个垂直模块：admin/auth/mastered/phrases/profile/reading/review/stats/vocabulary/wordbook）+ `src/shared/*`（components/hooks/services/utils/types/i18n）+ `src/pages/*`。
- 后端 `server/src/*` 按职责拆分：`routes/`（table/articles/wordsBulk）、`auth`、`permissions`（RBAC）、`audit`、`health`、`db`、`migrateMultiUser`、`encryption`、`trustProxy`、`ai-proxy`。
- AI 层四层拆分：`providerCore`（配置/传输委托）→ `requestRunner`/`streamRunner`（非流式/SSE 执行）→ `usageRecorder`（用量）→ 任务模块（`contentArticleTasks`/`contentQuestionTasks`/`contentTextTasks`/`providerWordTasks`）。

**架构合理性**：
- ✅ **边界清晰**：features 通过 `index.ts` 桶文件对外暴露（如 `features/review/index.ts`），shared 层下沉跨模块复用；路由级懒加载（`App.tsx`）控制首屏体积。
- ✅ **配置驱动扩展**：AI 供应商元数据集中在 `config/ai-providers.json`，前后端派生（`vite.config.ts` / `server/src/aiConfig.ts`），消除多处手写配置漂移。
- ✅ **安全默认**：RBAC 权限矩阵（`permissions.ts`）+ 私有表强制 `WHERE userId = ?` + 生产强制 `ENCRYPTION_KEY` / `TRUST_PROXY` fail-fast。
- ⚠️ **小缺口**：前端新增供应商仍需在 `src/shared/services/ai/index.ts` 的 `PROVIDER_API_KEY_ENV`/`PROVIDER_MODEL_ENV` 补映射（前端环境变量无法运行时读 JSON）；模块边界靠约定而非 lint 强制。

---

## 2. 代码质量与工程化

### 2.1 实测度量

| 指标 | 实测值 | 依据 |
| --- | --- | --- |
| 前端源码 | 462 文件 / 70,432 行 | `Get-ChildItem src` |
| 后端源码 | 59 文件 / 8,667 行 | `Get-ChildItem server/src` |
| `any` 用法 | **0** | 正则 `:\s*any\b\|as any\b` |
| TODO/FIXME/HACK | **0**（7 处为组件名 `DashboardTodayTodo`、测试数据 `hack` 误报） | 正则核查 |
| 生产依赖漏洞 | 前端 **0** / 后端 **0** | `npm audit --omit=dev` |
| dev 依赖漏洞 | 21（2 low / 19 moderate，全在工具链） | `npm audit` |
| 最大前端源文件 | `ReadingPage.tsx` 415 行 | 文件行数 |
| 最大后端源文件 | `aiUsage.ts` 376 行、`db.ts` 324 行 | 文件行数 |

### 2.2 代码结构与可维护性

- ✅ **文件体量已收敛**：历史上 `requestRunner` 398→196 行、`ReadingPage` 459→415 行、`providerContentTasks` 406→144 行（按领域拆为文章/题目/文本三模块）。当前源文件均在 420 行内，远低于超大文件阈值。
- ✅ **日志统一**：`src/shared/utils/logger.ts` 与 `server/src/logger.ts` 统一封装，生产代码裸 `console` 归零（仅日志模块与测试内保留），`debug` 级别开发环境才输出。
- ✅ **类型严格**：`tsconfig` 全开 `strict/noUnusedLocals/noImplicitReturns` 等；ESLint 9 扁平配置 + `recommendedTypeChecked`（类型感知，warn 起步）。
- ✅ **测试组织**：`__tests__` 目录 + `*.test.ts(x)` 命名对齐源文件；共享 fetch mock（`src/test/setup.ts`）避免重复。
- ⚠️ **注释质量**：核心模块注释充分（含设计动机与修复记录），但业务组件内部注释密度不均。

### 2.3 依赖管理

- ✅ **极精简**：后端 5 个生产依赖；前端生产依赖覆盖 React/Router/Dexie/Zustand/Tailwind/Recharts，无冗余。
- ✅ **生产链零漏洞**：critical/high 已全部修复（express 4.22.3 / body-parser / qs / proxy-addr 等）。
- ⚠️ **dev 链 21 漏洞**：`minimatch`/`glob`/`ejs`/`deepmerge` 等上游传递依赖，`npm audit fix` 无非破坏性修复，均不进生产 bundle（已记录为 dev 债务）。
- ⚠️ **缺依赖自动更新**：无 dependabot/renovate 配置，依赖更新靠手工 `npm outdated`。

### 2.4 文档完整性

- ✅ **体系完整**：`docs/` 17 份（README/ARCHITECTURE/API_REFERENCE/DATABASE/ER_DIAGRAM/DEPLOYMENT/LINUX_DEPLOY/OPERATIONS/TESTING/UPGRADE/CODING_STANDARDS/MULTI_USER_DESIGN/AI_* 等）+ 根 SECURITY/CHANGELOG/CONTRIBUTING。
- ✅ **自动校验一致性**：`scripts/verify-docs.mjs`（8 项数值锚点）、`scripts/check-i18n-literals.mjs`（中文硬编码基线）纳入 CI 门禁，文档漂移直接阻断合入。
- ⚠️ 文档数值需随测试增长同步（当前已同步至前端 203/1764、后端 24/247）。

---

## 3. 功能完整性验证

### 3.1 已实现功能清单

| 模块 | 能力 | 依据 |
| --- | --- | --- |
| 阅读 reading | 每日/历史文章、AI 生成、纯英文+翻译、全文朗读、标记已读、一键打印工作表 | `features/reading/*` |
| 复习 review | SM-2 复习队列、拼写/写作/朗读/练习/学习五步 | `features/review/*` |
| 生词本 wordbook | 生词增删改查、AI 补全、批量导入（bulk）、笔记、翻转卡片 | `features/wordbook/*` + `wordsBulkRouter` |
| 重点词汇/短语 | vocabulary / phrases 汇总与卡片 | `features/vocabulary`、`features/phrases` |
| 统计 stats | 学习统计、能力增长曲线、成就徽章 | `features/stats/*` |
| 个人中心 profile | 学习概览、AI 设置、用量与成本、登录设备、双语/深色模式 | `features/profile/*` |
| 管理后台 admin | 用户管理、审计日志、班级学情、AI 成本面板 | `features/admin/*` + `server/src/adminRoutes.ts` |
| 多用户认证 | 登录/登出、session、RBAC、数据隔离、审计 | `auth.ts`/`permissions.ts`/`audit.ts` |
| AI 能力 | 多供应商代理、流式、缓存、日/月 token 预算、用量成本 | `ai-proxy.ts`/`aiUsage.ts` |
| 健康/运维 | 存活+就绪探针、蓝绿发布脚本、容器化 | `health.ts`/`scripts/blue-green-deploy.mjs` |

### 3.2 核心业务流程通畅性

**主链路「登录 → 阅读 → 做题 → 标记已读 → 加生词 → 复习 → 统计/成就」在代码层完整打通**，并由 E2E 三模式覆盖：
- fixture 模式：UI 主流程 + 无障碍 + 移动端回归（`e2e/a11y.spec.ts`、`mobile.spec.ts`）；
- **真实后端模式**（`e2e/real-backend.spec.ts`）：真实 Express + 临时 SQLite + 真实登录，覆盖登录→阅读→标记已读→历史→生词→复习全链路；
- SW 模式：离线构建验证。

后端 REST 覆盖 7 业务表 CRUD + bulk + admin 端点 + AI 代理 + 健康检查；多用户私有表强制隔离（`WHERE userId = ?`），共享表全站可见。

### 3.3 功能缺口 / 未完成项

| 缺口 | 影响 | 依据 |
| --- | --- | --- |
| **UI 层 i18n 已全覆盖**：admin / Layout / reading / wordbook / review / mastered / phrases / vocabulary / stats / dashboard(pages) / profile（含成就墙）全部接入 `useTranslation`，中文硬编码基线由 1380 行降至 **686 行**；剩余为 AI 提示词（articlePrompts/promptShared/wordPrompts，内部中文非 UI）、service/logger 内部文案 | 英文界面基本一致；AI 层内部文案不面向用户 | `npm run i18n:check` 基线 |
| 长按菜单键盘替代入口缺失（无障碍后续项） | 键盘/读屏用户操作受限 | L4 记录遗留 |
| 图表未按需加载（Recharts 非懒加载） | 首屏体积偏大 | §4.1 |
| 无自动部署环节 | 发布靠手工（蓝绿脚本已备） | §5.3 |

> 真实 TODO/FIXME 占位为 **0**，无半成品或被注释掉的功能，功能完整度高。

### 3.4 边界场景覆盖度

| 场景 | 覆盖情况 | 依据 |
| --- | --- | --- |
| 空数据 | ✅ 各列表/统计空态占位 | 各页面 empty state |
| 离线降级 | ✅ fetch 失败回退 Dexie + `ydxl:offline` 事件 | `cachedRemoteRepository`/`localApi` |
| 加载失败 | ✅ 错误边界 + 兜底文案 + 重试 | `ErrorBoundary.tsx` |
| 无权限 | ✅ 403 + 审计留痕 | `permissions.ts` |
| 并发/重复写 | ✅ SQLite `busy_timeout=5s` + 双表事务 | `db.ts` |
| AI 上游超时 | ✅ 150s 超时 + 流式降级 + 兜底素材 | `ai-proxy.ts`/`fallbackProvider` |
| 限流滥用 | ✅ 全局 60/min/IP、登录 5/min、AI 代理 20/min/用户 | `index.ts` |

---

## 4. 性能与稳定性评估

### 4.1 性能现状与瓶颈

| 方面 | 现状 | 判定 |
| --- | --- | --- |
| 长列表 | 生词本/重点词汇/阅读历史接入 `VirtualList` 窗口化虚拟滚动（视口外行不进 DOM） | ✅ 已优化 |
| 首屏/产物 | dist 1.86MB；`recharts` 398KB、`react` 346KB 独立 chunk | ⚠️ **Recharts 未按需加载**，统计页同步引入 |
| 后端查询 | 私有表强制 `WHERE userId = ?` + 复合索引（words/readingSessions/reviews），分页 `limit/offset` | ✅ 有索引、有分页 |
| 预算/成本 | AI token 日/月预算 + 用量聚合 | ✅ 成本可控 |

**主要瓶颈**：① Recharts 大 chunk（398KB）首屏加载；② 统计页同步 import 三个图表组件；③ 极端数据量下 Dexie 全量 getAll 场景（`getWordbook` 已下沉索引查询，缓存为空时回退全量）。

### 4.2 内存泄漏风险

- ✅ **事件/定时器清理**：`VirtualList` 的 `scroll`/`resize` 监听在 effect cleanup 中移除；`main.tsx` 启动 `cleanupExpired()` 清理 IndexedDB 过期 AI 缓存并定时清理（缓存有上限策略）。
- ✅ **响应缓存/Token 统计**：`responseCache`/`tokenStats` 有上限与清空机制，测试 `afterEach` 自动清空避免泄漏。
- ✅ **React effect cleanup**：hooks（如 `useArticleLoader` 竞态保护 `loadTokenRef/mountedRef`）过期结果丢弃、卸载后不 setState。
- ⚠️ **关注点**：SpeechSynthesis 长会话、Service Worker 生命周期、SSE 流中断需持续保证 abort；建议补一次长会话/反复进出页面的内存快照回归。

### 4.3 异常处理完善度

- ✅ **前端**：`ErrorBoundary` 全路由覆盖（`componentDidCatch` 记 `logger.error` + 恢复 UI）；AI 调用错误统一 `AIError`（携带 code）→ 业务层降级到兜底素材。
- ✅ **后端**：全局错误中间件兜底（结构化 JSON，生产 message 脱敏）；`uncaughtException`/`unhandledRejection` 捕获防进程崩溃；审计写失败不阻塞主流程。
- ✅ **数据库写失败**：articles POST/PUT/DELETE 双表事务化，失败可回滚。
- ✅ **可观测性**（2026-11-02）：`logger` 统一，并接入 **可选 Sentry 错误上报**（前端 `sentry.ts` + 后端 `sentry.ts`，动态 import，未配置 DSN 即 no-op 零影响；ErrorBoundary.onError 与后端全局异常/错误中间件均上报，保留原 logger.error）。

### 4.4 边界容错与缓存

- ✅ **超时**：AI 上游 `UPSTREAM_TIMEOUT_MS=150s`、Nginx `proxy_read_timeout`、fetch 超时分层。
- ✅ **并发**：SQLite WAL + `busy_timeout=5s` 排队；批量插入 `INSERT OR IGNORE` 事务。
- ✅ **缓存策略**：AI 响应缓存（含 `ttlMs`/永久缓存场景）、Dexie SWR、SW 预缓存 48 项、`/assets/` 长缓存 + SW/manifest 不缓存。
- ⚠️ 分支覆盖率阈值（83）与实测基线（84.85）间距较小（约 1.9pt），分支回退容忍度仍需随补测继续上移阈值。

---

## 5. 开发流程与协作规范

### 5.1 测试覆盖

| 层 | 数量 | 说明 |
| --- | --- | --- |
| 前端单元/集成 | 203 文件 / 1764 用例 | vitest + jsdom + Testing Library |
| 后端 | 24 文件 / 247 用例 | vitest（supertest + 内存 SQLite，禁并行防锁） |
| E2E | 10 spec × 3 模式 | Playwright（fixture / 真实后端 / SW） |
| 覆盖率阈值 | 91/83/91/93（branches 2026-11-02 上调） | 实测 94.73/84.85/94.92/96.84，防回退 |

**分层完整**（单元→集成→E2E），**真实后端 E2E 已补**跨层契约盲区。缺口：无性能/内存基准测试。

### 5.2 代码质量工具链

- ✅ ESLint 9 扁平配置 + `recommendedTypeChecked`（类型感知，warn 起步，822 warn 待分批收紧为 error）。
- ✅ Prettier（格式化）+ husky + lint-staged（提交钩子）+ `tsc -b --noEmit`（typecheck）。
- ✅ 门禁：`npm run typecheck / lint / test / docs:verify / i18n:check`。

### 5.3 CI/CD 流水线（`.github/workflows/ci.yml`）

| Job | 职责 | 门禁 |
| --- | --- | --- |
| quality-gates | 前后端生产依赖 audit + `docs:verify` + `i18n:check` | 漏洞/文档漂移/新增中文即阻断 |
| lint | ESLint | 0 error |
| test-frontend | 前端测试 + 覆盖率阈值 | 防回退 |
| test-server | 后端 typecheck + build + test | — |
| build | 生产构建 + PWA | — |
| e2e | fixture → 真实后端 → SW 三阶段 | 主链路/离线 |

**流水线质量门禁完整**（质量→lint→测试→构建→E2E）。缺口见下表：

| 流程缺口 | 影响 | 依据 |
| --- | --- | --- |
| 无 CODEOWNERS / PR 模板 | 代码审查无强制 owner | `.github/` 缺失 |
| 无自动部署 | 发布手工（蓝绿脚本已就绪） | workflow 无 deploy job |
| 无安全扫描 action（CodeQL/依赖审查） | 依赖漏洞靠手工 audit | workflow 缺失 |
| 无 dependabot/renovate | 依赖更新靠手工 | 缺失 |
| 无性能/内存基准回归 | 性能回退靠人工发现 | 无 bench |
| 无自动版本/CHANGELOG 生成 | 版本与 changelog 手工维护 | 无 release action |

---

## 6. 风险与优化建议（按优先级排序）

### 风险总览

| 编号 | 风险/债务 | 类型 | 严重度 | 现状 |
| --- | --- | --- | --- | --- |
| R1 | 生产依赖漏洞 | 技术 | ~~高~~ | **已修复**（前后端 audit 0） |
| R2 | i18n 未全覆盖（中文硬编码） | 业务 | **低** | 已修复（UI 层）：所有用户界面模块 + dashboard + profile 成就墙已接入；基线 1380→686 行（97 文件），剩余仅 AI 提示词/内部文案（非 UI） |
| R3 | 多用户数据隔离/越权 | 业务 | ~~高~~ | **已缓解**（`WHERE userId` + RBAC + 审计 + 专测） |
| R4 | 反代 IP 失真/限流共享 | 技术 | ~~高~~ | **已修复**（`TRUST_PROXY` 生产强校验） |
| R5 | Recharts 大 chunk 未按需加载 | 性能 | **中** | 待优化 |
| R6 | 分支覆盖率阈值偏低（81 vs 85.36） | 流程 | **低** | 已上调（2026-11-02）：branches 81→83，实测 84.85% 达标（Statements 94.73 / Functions 94.92 / Lines 96.84） |
| R7 | 无错误聚合/可观测性 | 稳定性 | **低** | 已接入（2026-11-02）：可选 Sentry（前端+后端，DSN 可选、未配置零影响），ErrorBoundary + 全局异常/错误中间件上报 |
| R8 | dev 依赖 21 漏洞（工具链） | 技术 | **低** | 已记录，上游无修复 |
| R9 | 无 PR 治理件 / 自动部署 / 安全扫描 | 流程 | **低** | 大部分修复（2026-11-02）：CODEOWNERS / PR 模板 / dependabot / CodeQL + 依赖审查 已就位；仅剩自动部署（需部署主机/密钥） |
| R10 | SQLite 单写者（多用户写串行） | 架构 | **低** | 已缓解（busy_timeout/事务），迁移触发条件已定 |

### 优化建议（可落地，按优先级）

**P0（近期，直接影响用户体验/一致性）**
1. **补齐 i18n**（已完成）：所有用户界面模块（admin / Layout / reading / wordbook / review / mastered / phrases / vocabulary / stats / dashboard / profile 含成就墙）全部接入 `useTranslation`（约 100 文件 / 600+ key），中文硬编码基线 1380→686 行。剩余仅 AI 提示词（内部中文，非 UI）与 service/logger 内部文案。已有 `i18n:check` 基线护栏防回退。
2. **图表按需加载**（已完成）：`StatsChart`/`StatsBarChart`/`ReadingGrowthChart` 已改 `React.lazy` + `Suspense` 骨架屏（StatsPage），Dashboard 侧此前已懒加载；recharts 仍为独立 398KB chunk 但脱离首屏关键路径。后续可评估 Recharts 轻量替代进一步瘦身。

**P1（中期，工程与稳定性）**
3. **可观测性**（已完成 2026-11-02）：前端 `ErrorBoundary.onError` 与后端全局异常/错误中间件接入 **可选 Sentry**（`VITE_SENTRY_DSN` / `SENTRY_DSN` 可选，未配置即 no-op、SDK 不加载、零影响；配置后动态加载上报）。线上错误从「人工查日志」升级为「聚合告警」。
4. **协作治理件**（大部分完成 2026-11-02）：已补 `CODEOWNERS`、PR 模板、`dependabot.yml`（npm 前端/服务端 + github-actions 周更）、`workflows/security.yml`（CodeQL 静态扫描 + PR 依赖漏洞审查，weekly + PR 触发）；仅剩 E2E 后自动部署（复用 `blue-green-deploy.mjs`，需部署主机/密钥）。
5. **覆盖率**（已完成 2026-11-02）：branches 阈值 81→83 上调（实测 84.85% 达标）；已补资源清理回归（VirtualList 监听器/ResizeObserver、阅读生命周期定时器/abort/订阅，反复进出无累积）。后续随补测继续上移阈值。

**P2（长期，扩展性）**
6. **i18n 全量 + CI 检测收紧**：目标是中文硬编码基线持续下降至全量清零。
7. **性能基准**（已完成 2026-11-02）：已补性能护栏——`VirtualList.domBudget.test.tsx`（3 例，虚拟滚动 DOM 预算 O(视口)、大数据量/深滚动不退化为全量渲染）+ `scripts/check-bundle-size.mjs`（`npm run bundle:check`，dist ≤ 2.5MB / 单 chunk ≤ 500KB，当前 1978.9KB / 398.4KB）。首屏 LCP 基准回归可后续补充。
8. **多写者扩展**：当并发写成为瓶颈时，按 DATABASE §3.10 触发条件评估 Postgres 迁移（expand-contract）。

---

## 7. 结论与迭代决策依据

**可直接用于迭代决策的判断**：

1. **架构与代码质量已达可长期维护水平**，无需重构式改造；新增功能（AI 供应商 / 表 / feature 模块）扩展成本低，可放心在现有结构上迭代。
2. **质量门禁完备**，生产依赖零漏洞、测试分层齐全、CI 六段全绿，合入风险低。
3. **优先投入应集中在「体验一致性 + 首屏性能 + 协作效率」三块**：i18n 补齐（业务）、图表按需加载（性能）、PR/安全扫描治理件（流程）。
4. **当前规模（约 7.9 万行全栈、222 测试文件、E2E 三模式）下，稳定性风险可控**；高风险项（依赖漏洞、数据隔离、限流 IP 失真）已全部修复或缓解。

> 建议迭代节奏：P0（i18n + 图表懒加载）→ P1（可观测性 + 治理件）→ P2（i18n 清零 + 性能基准 + 扩展性），每项完成后同步文档数值并复跑 `npm run docs:verify`。

---

**附：可复现度量命令**

```powershell
# 规模
(Get-ChildItem src -Recurse -Include *.ts,*.tsx -File).Count
(Get-ChildItem server\src -Recurse -Include *.ts -File).Count
# 依赖
npm audit --omit=dev ; npm --prefix server audit --omit=dev
# 代码卫生
# any / TODO(FIXME,HACK)
# 测试
npm test ; npm --prefix server test
# 文档与 i18n 一致性
npm run docs:verify ; npm run i18n:check
```
