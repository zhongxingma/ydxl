# 项目全面分析报告（当前基线）

> 分析对象：`ydxl` 英语学习 PWA（React 18 + Vite 6 + TypeScript + Express + SQLite）
> 分析方式：静态度量 + 依赖审计 + 代码走查 + 配置核对。**所有结论均标注可验证依据**（文件:行号 / 命令输出数值）。
> 历史快照报告见 [archive/PROJECT_ANALYSIS_REPORT.md](./archive/PROJECT_ANALYSIS_REPORT.md)；本文件反映当前代码状态。

## 0. 分析基线

| 指标 | 实测值 | 采集方式 |
| --- | --- | --- |
| 前端源码 | 442 个 `.ts/.tsx` 文件，76,707 行 | `Get-ChildItem src` |
| 后端源码 | 54 个 `.ts` 文件，8,465 行 | `Get-ChildItem server/src` |
| 前端测试 | **199** 文件 / **1749** 用例 | 文件计数 + `.github/workflows/ci.yml` 注释 |
| 后端测试 | **23** 文件 / **241** 用例 | 同上 |
| E2E | **10** 个 spec，3 种模式（fixture / 真实后端 / SW；含无障碍与移动端回归） | `e2e/` + `playwright.config.ts` |
| 构建产物 | **1.85 MB**（dist 全量）；最大 chunk recharts 407.9 KB | `dist/assets` |
| 数据库表 | SQLite **12** 张 + Dexie **8** 张 | `server/src/db.ts` / `docs/ER_DIAGRAM.md` |
| 依赖漏洞 | 生产依赖：前端 **0** / 后端 **0**（2026-10-31 已修复，后端原 3：critical 1 / high 1 / moderate 1）；前端 dev 链 **21**（2 low / 19 moderate，均 dev；M6 后为上游传递依赖） | `npm audit --omit=dev` / `npm audit` |
| 代码卫生 | `any` 用法 **0**；`TODO/FIXME/HACK` **0**；生产代码裸 console **0** 处（统一 `logger`，仅日志模块与测试内保留 console） | `rg` 统计 |
| 覆盖率阈值 | statements 91 / branches 81 / functions 91 / lines 93（实测基线 95.05 / 85.36 / 95.17 / 97.11） | `vitest.config.ts:37-44` |

**严重度定义**：严重＝可致安全事件或数据泄露；高＝显著影响可用性/安全/维护成本；中＝局部影响或潜在风险；低＝优化项。

---

## 1. 整体架构设计

**现状**
- 采用「前后端分离 + 服务器为主 + Dexie 离线只读缓存」三层架构，10 个 `features` 垂直模块（admin/auth/mastered/phrases/profile/reading/review/stats/vocabulary/wordbook）自包含 components/pages/services/hooks。
- AI 层已完成三层拆分：`providerCore.ts`（365 行，Provider 核心）、`requestRunner.ts`（196 行，非流式请求执行）、`streamRunner.ts`（198 行，SSE 流执行）、`usageRecorder.ts`（65 行，Token 用量与来源记录）、`providerContentTasks.ts`（144 行，内容任务入口；具体流程拆至 `contentArticleTasks.ts` 142 / `contentQuestionTasks.ts` 173 / `contentTextTasks.ts` 128，执行上下文 `contentTaskIO.ts` 27）、`articlePrompts.ts`（257 行，提示词），另有 `fallbackProvider` / `hybridProvider` 组合编排。
- 多用户架构已落地：`auth.ts`（scrypt + 不透明 session）、`permissions.ts`（admin/teacher/student RBAC 矩阵）、`audit.ts`（operation_logs 审计）。

**问题**
1. **[高 → 已部分修复 2026-11-01]** 部分核心文件仍偏大：`requestRunner.ts` 已由 398 行降至 196 行（SSE 执行抽至 `streamRunner.ts`、用量记录抽至 `usageRecorder.ts`）；`ReadingPage.tsx` 已由 459 行降至 415 行（打印 Portal 与视图区抽为独立组件），剩余主要为 hooks 编排与 props 组装，进一步压缩需引入 view-model；`providerContentTasks.ts` 已由 406 行降至 144 行（M3 收尾，按领域拆为文章 / 题目 / 文本三类执行模块）。剩余主要为 `providerCore.ts`（365 行）。
2. **[中 → 已修复 2026-11-01]** 兜底素材已外置为 `fallback-articles.json`（13 篇），`fallback-articles.ts` 仅保留类型与选取逻辑（约 35 行），内容运营与代码发布解耦。
3. **[低]** 模块边界依赖约定而非强制：跨模块引用若绕过 `index.ts` 桶文件，重构时易产生隐式耦合（需在 review 规则中固化）。

**建议**
- ~~优先拆分 `ReadingPage.tsx` 与 `requestRunner.ts`~~ → **已实施（2026-10-31）**：requestRunner 拆出 `streamRunner` / `usageRecorder`；ReadingPage 拆出 `ReadingPrintPortal` / `ReadingPageViews` / `renderReadingPageGuard`。
- ~~兜底素材迁移为 `public/` 或 `src/features/reading/data/*.json`~~ → **已实施（2026-11-01）**：素材外置为 `src/features/reading/data/fallback-articles.json`（13 篇）。
- 在 ESLint 增加 `import/no-restricted-paths`（或自定义规则）约束跨模块深层引用。

---

## 2. 业务逻辑合理性

**现状**
- 学习闭环完整：AI 生成文章 → 阅读理解/语法填空 → 生词本 → SM-2 五步背诵 → 统计/成就；多用户后新增班级学情、用户管理、审计。
- 容错链路完整：AI 失败 → `FallbackAIProvider` 切兜底供应商 → 仍失败降级兜底素材库（`articleService`）。
- 数据隔离：私有表查询强制 `WHERE userId = ?`（`server/src/routes/tableRouter.ts:34-64`），删除带 `userId` 条件（`tableRouter.ts:149-164`）。

**问题**
1. **[中 → 已缓解 2026-11-01]** 兜底素材为固定集合，AI 连续不可用时用户会反复看到同一批内容（现为 13 篇，覆盖 campus/science/culture/biography/nature）；虽有 contentHash 去重，但可复用池仍有限。
2. **[中]** 多用户业务规则边界需持续验证：如班级统计（`classStats.ts`）、教师/学生可见范围是否与 RBAC 矩阵完全一致，缺少端到端权限矩阵测试。
3. **[低]** 学习目标、每日复习上限等参数在 UI 层 clamp，服务端无同源校验（前端可绕过）。

**建议**
- 兜底素材池已扩充至 13 篇（2026-11-01），后续可按主题分组轮换；或接入「离线题库包」按需下载。
- 补一组「角色 × 资源 × 操作」权限矩阵集成测试（teacher 访问 admin 接口应 403 等）。
- 关键参数在服务端二次校验，避免绕过前端限制。

---

## 3. 技术栈选型适配性

**现状**
- React 18 + Vite 6 + TS 5.6 + Zustand 5 + Dexie 4 + Recharts 2；后端 Express 4 + better-sqlite3 11 + cors + express-rate-limit 7。
- Node 要求已提升至 `>=20`（`package.json:7`），CI 统一 Node 20（`.github/workflows/ci.yml:18`），与 WebCrypto 依赖一致。
- 测试栈完整：vitest 4 + coverage-v8 + Playwright 1.64。

**问题**
1. **[高 → 已缓解 2026-11-01]** `better-sqlite3` 为单写者模型：WAL 仅提升并发读，多用户并发写仍串行。已增加 `busy_timeout = 5000` 排队缓冲、批量导入单事务、articles 双表写入事务化；Postgres 迁移触发条件与设计要点见 `docs/DATABASE.md` §3.10（当前单校规模足够，暂不迁移）。
2. **[中]** Express 4 传递依赖存在漏洞（详见维度 5），当前 `express ^4.21.0` + `proxy-addr 2.0.7`（`server/package.json` / `server/node_modules`）。
3. **[低]** Recharts 2 打包体积 398.4 KB（dist 最大 chunk），仅统计页使用。

**建议**
- 中期评估写入路径：批量写合并（事务批量 INSERT）或迁移 WAL2/Postgres（视多用户规模）。
- 升级 Express 4 至最新补丁版（或 Express 5）并回归 AI 代理/限流/审计。
- Recharts 改动态 `import()`，只在进入统计页时加载（已有 `DashboardGrowthPanels` 懒加载先例）。

---

## 4. 代码质量与规范

**现状**
- TS 严格模式全开：`strict` + `noUnusedLocals` + `noUnusedParameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch`（`tsconfig.app.json:18-25`；`server/tsconfig.json` 同等）。
- ESLint 9 **扁平配置**（`eslint.config.js`）：`@eslint/js` recommended + `typescript-eslint` recommended + `react-hooks` + `react-refresh`，并已启用 `recommendedTypeChecked`（类型感知，先以 warn 落地；`parserOptions.projectService` 自动解析 tsconfig）；CI 有 lint 门禁（`ci.yml:29`）。
- 卫生良好：`any` 0 处、`TODO/FIXME/HACK` 0 处；Prettier + husky + lint-staged 已接入。
- 覆盖率有防回退阈值（`vitest.config.ts:40-44`）。

**问题**
1. **[中 → 已缓解 2026-11-01]** 类型感知规则已于 M6 全量开启（`recommendedTypeChecked`，降级为 warn），`no-floating-promises` / `no-misused-promises` / `require-await` 已可被静态拦截；当前遗留 **822 条 warn**（0 error），需按规则分批收敛后再提升为 error。
2. **[中 → 已修复 2026-11-01]** 生产代码裸 `console` 共 268 处（87 个文件），生产环境缺乏统一日志级别与脱敏策略 → S3 引入 `logger` 统一封装后归零（`rg` 统计）。
3. **[低]** 前端覆盖率 `branches` 阈值 81%，低于实测基线 85.36% 约 4 个百分点，分支回退容忍度偏大（`vitest.config.ts:42`）。

**建议**
- ~~引入 `recommended-type-checked`~~ → **已实施（2026-11-01）**：先以 warn 起步。后续优先把 `no-floating-promises` / `no-misused-promises` / `require-await` 三类高频告警清零并提升为 error。
- ~~统一 `logger` 封装，替换裸 `console`~~ → **已实施（2026-11-01，S3）**：前端 `src/shared/utils/logger.ts`（`debug` 仅开发环境）与后端 `server/src/logger.ts`（`debug` 仅非生产环境），`info/warn/error` 始终输出；日志模块是唯一允许直接调用 `console` 的位置。
- 提高 branches 阈值至 83，随补测继续上移。

---

## 5. 依赖组件安全性

**现状**（`npm audit --omit=dev` 实测）

| 范围 | 漏洞 | 包 | 严重度 |
| --- | --- | --- | --- |
| 后端（生产依赖） | **0（已修复）** | 原 `proxy-addr 2.0.7` → 2.0.8、`body-parser <1.20.9` → 1.20.9、`qs 6.16.0` → 6.16.2 | — |
| 前端（生产依赖） | **0** | — | — |
| 前端（dev 依赖） | 21（2 low / 19 moderate） | 全部为 devDependencies 传递链：`eslint` 9 → `@eslint/config-array`/`@eslint/eslintrc`（`minimatch <11.0.1`）、`typescript-eslint` 8 → `typescript-estree`（`minimatch`）、`workbox-build`（`glob <14.0.2` / `deepmerge` / `@trickfilm400/rollup-plugin-off-main-thread` → `ejs`） | moderate / low |

- 前端 21 个漏洞仅存在于开发链（本地 lint / 构建 / 打包插件），**不进入生产 bundle**，`npm audit --omit=dev` 实测 0。

**修复记录（2026-10-31）**
- 后端：执行 `npm --prefix server audit fix` 两轮，critical（`proxy-addr` IP 伪造）与 high（`body-parser` 压缩体 DoS）已消除，`qs` moderate 亦修复；升级后实际版本 `express 4.22.3` / `body-parser 1.20.9` / `qs 6.16.2` / `proxy-addr 2.0.8`。
- 前端：`npm audit fix` 升级 `baseline-browser-mapping 2.11.34`、`brace-expansion 2.1.7`；显式升级 `vitest` / `@vitest/coverage-v8` 至 4.1.12（消除 `@vitest/mocker` 路径遍历/任意文件读漏洞）、`react-router-dom` 至 7.18.5（消除 react-router 开放重定向类漏洞）。
- 回归验证：`npx tsc -b` 类型检查通过；服务端 **22 文件 / 216 用例全部通过**；`npm audit --omit=dev` 与 `npm --prefix server audit --omit=dev` 均返回 `found 0 vulnerabilities`。
- 门禁固化：`.github/workflows/ci.yml` 新增 `quality-gates` job —— 前后端各执行 `npm audit --omit=dev --audit-level=high`，并运行文档数值校验脚本，生产依赖漏洞或文档漂移均直接阻断合入。

**修复记录（2026-11-01，M6）**
- 前端 ESLint 迁移：`eslint 8.57` → **9.39.5**、`@typescript-eslint/{parser,eslint-plugin} 7` → **typescript-eslint 8.72.1**、`eslint-config-prettier 9` → 10、`eslint-plugin-react-hooks` → 5、`eslint-plugin-react-refresh` → 0.4.26；删除 `.eslintrc.cjs`，新增 `eslint.config.js` 扁平配置；lint 脚本去掉已废弃的 `--ext`（ESLint 9 由 `files` 匹配）。
- dev audit：23 → **21**（2 low / 19 moderate）。剩余均为上游传递依赖且 `npm audit fix` 无非破坏性修复（`minimatch <11.0.1` 尚无 eslint 9 适配版；`glob <14.0.2`、`ejs 3.x` 属 `workbox-build` 链；`deepmerge >=4.2.0` 上游未发布修复版本）。`npm audit --omit=dev` 仍为 **0**。
- 回归验证：`npm run lint` 0 error（类型感知规则 822 warn）、`npm run build` 通过（907 modules，PWA 预缓存 47 项）。

**修复记录（2026-11-01，L2）**
- 预算：AI 代理（非流式 + SSE）在转发前校验每用户日/月 token 用量，超限返回 429 `AI_BUDGET_EXCEEDED`，不产生上游计费；`AI_DAILY_TOKEN_BUDGET` 默认 100,000、`AI_MONTHLY_TOKEN_BUDGET` 默认 2,000,000，`0` 表示不限制。
- 用量：成功响应解析上游 `usage`（流式通过 SSE 采集器解析末尾用量），写 `operation_logs` 的 `ai.proxy.usage` 明细（prompt/completion/total/costCny/model/provider，**不记 prompt 内容**）；成本按 `server/src/aiUsage.ts` 内置价格表估算（元）。
- 面板：新增 `/api/admin/ai-usage`（`logs:view`，查询留痕 `ai.cost.view`）与前端 `/admin/ai-usage` 页面（今日/本月/窗口汇总、预算使用率、按日/模型/用户明细）。
- 测试：`aiQuota.test.ts` 新增 8 个用例（用量解析、SSE 采集、成本估算、聚合、预算超限 429、成功用量落库）；新增 `AiCostPage.test.tsx` 6 例与 `adminService` 1 例。后端 **22 文件 / 232 用例**、前端 **198 文件 / 1745 用例** 全量通过。

**修复记录（2026-11-01，L3）**
- 新增 `npm run test:e2e:real`：Playwright 以双 webServer 启动真实 Express（`DB_PATH=.e2e-tmp/real-backend.db`、固定管理员）+ vite dev；spec 不注册 `page.route`，全部 `/api` 走真实认证与 SQLite。
- `e2e/real-backend.spec.ts` 覆盖「登录 → 阅读（历史文章）→ 阅读完成（readAt 双表事务）→ 阅读历史 → 生词添加 → 复习队列」主链路，以及错误密码 401 统一文案。
- 为测试稳定性新增环境可调限流：`RATE_LIMIT_MAX`（全局，默认 60）、`LOGIN_RATE_LIMIT_MAX`（登录，默认 5），E2E 模式调高；生产默认不变。
- CI E2E job 增加真实后端轮次；本地实测 **2/2 通过（49.8s）**。

**修复记录（2026-11-01，L4）**
- 焦点管理：新增 `useModalFocus`（初始聚焦首个表单控件、Tab / Shift+Tab 在弹窗内循环、关闭后焦点还给触发元素），接入添加单词 / 批量导入单词 / 添加文章 / 批量导入文章 / 难度选择 / 笔记编辑 / 操作菜单 7 个弹窗。
- 键盘可达：Layout 新增「跳到主要内容」跳转链接（首个 Tab 停留，指向 `#main-content`）；桌面 / 底部导航分别具名 `主导航` / `底部导航`，底部 Tab 补 `aria-current="page"`，emoji 图标 `aria-hidden`。
- 状态可读：页面加载占位、阅读加载骨架补 `role="status"` + `aria-live="polite"`；成就 Toast 与阅读页 Toast 补 `role="status"`；阅读错误态补 `role="alert"`；生词本搜索框补 `aria-label`。
- 回归用例：新增 `useModalFocus.test.tsx`（4 例）、`e2e/a11y.spec.ts`（2 例：跳转链接 / 导航语义、弹窗焦点循环与恢复）、`e2e/mobile.spec.ts`（2 例：375 与 320 窄屏底部 Tab 与横向溢出）；本地默认 E2E **14/14 通过**。

**修复记录（2026-11-01，L5）**
- 健康检查：新增 `server/src/health.ts`，`/api/health` 为存活探针（进程元信息 + 版本 + uptime，不依赖数据库）、`/api/health/ready` 为就绪探针（`SELECT 1` 探活数据库，可用 200 / 不可用 503），两者均免登录、免限流；`APP_VERSION` 构建期注入。
- 容器化：`Dockerfile` 双目标（`app` = Express API 运行时，非 root + `HEALTHCHECK` 调 `/api/health/ready`；`web` = Nginx + 前端产物，反代 `/api` 到 `ydxl_app` upstream）；`.dockerignore` 排除密钥/产物/测试目录；`.env` 只经运行时注入，不进镜像。
- 编排：`docker-compose.yml` 以 profiles 管理蓝绿双槽位（`app-blue` / `app-green`），共享 `ydxl-data` 卷存放 SQLite；`deploy/nginx.conf` 处理静态资源、SW/manifest 不缓存、SSE 关闭缓冲。
- 蓝绿发布：`scripts/blue-green-deploy.mjs` 读取 `deploy/active-upstream.conf` 判断当前槽位 → 启动另一槽位 → 轮询 `/api/health/ready` 作为切流门禁 → 原地改写 upstream 并 `nginx -s reload` → 停止旧槽位；未就绪或 reload 失败时清理新容器并保持原 upstream（零流量中断）。
- 测试：新增 `server/src/__tests__/health.test.ts` 6 例（存活负载字段、`APP_VERSION` 注入、时间戳派生、就绪 200 / 503、异常收敛不抛出）；后端 **23 文件 / 238 用例** 全量通过。
- 说明：本机无 Docker，镜像构建与蓝绿切流脚本仅完成语法校验与 `--dry-run` 演练，实际容器运行需在具备 Docker 的主机验证（步骤见 `docs/DEPLOYMENT.md` §10）。

**修复记录（2026-11-01，S3）**
- 前端 `src/shared/utils/logger.ts`：`debug` 仅在开发环境输出（`import.meta.env.DEV === false` 时静默），`info` / `warn` / `error` 始终输出；测试环境 `import.meta.env` 为空对象时按开发环境处理，保留诊断信息。
- 后端 `server/src/logger.ts`：`debug` 仅在 `NODE_ENV !== 'production'` 时输出，`info` / `warn` / `error` 始终输出，容器日志（`docker logs` / `journalctl`）可正常采集。
- 替换范围：生产代码（不含测试与测试基建）共 **87 个文件 / 268 处**裸 console；`console.log` → `logger.info`（保留启动与运维输出）、`console.debug` → `logger.debug`、`warn` / `error` 同名映射。日志模块是唯一允许直接调用 `console` 的位置。
- 回归验证：`npm run typecheck`、`npm --prefix server run build`、`npm run lint`（0 error / 822 warn）、后端 23 文件 / 238 用例、前端 199 文件 / 1749 用例全部通过。

**修复记录（2026-11-01，M3 收尾）**
- `providerContentTasks.ts` 由 406 行降至 144 行，仅保留类声明、JSDoc 与执行上下文构造；行为与调用方零改动。
- 按领域拆出三个执行模块：`contentArticleTasks.ts`（142 行，文章生成含结果校验重试）、`contentQuestionTasks.ts`（173 行，题目 / 语法填空统一流式→降级→缓存→非空校验流程）、`contentTextTasks.ts`（128 行，翻译 / 词汇 / 短语的永久缓存提取）。
- 新增 `contentTaskIO.ts`（27 行）：ProviderCore 的传输能力为 protected，拆分出的模块通过闭包上下文调用 `callChat` / `callChatCached` / `callChatStream` / `withAIError` / `getFlashModel`，不放宽封装边界。
- 回归验证：`npm run typecheck` 通过；`npx vitest run src/shared/services/ai` → **31 文件 / 327 用例**全部通过；改动文件 ESLint 0 警告；`npx prettier --check` 通过。

**修复记录（2026-11-01，S4）**
- admin 4 个页面（`AdminUsersPage` / `ClassStatsPage` / `AuditLogsPage` / `AiCostPage`）全部接入 `useTranslation`，`zh-CN.json` 与 `en-US.json` 各新增约 100 个 `admin.*` 键；页面内角色名、表头、按钮、占位符、提示与错误兜底文案均走 `t()`，时间与数字按当前语言做 `toLocaleString` 格式化。
- 新增中文硬编码护栏：`scripts/check-i18n-literals.mjs` 剔除注释后按文件统计含中文行，与 `scripts/i18n-baseline.json`（163 文件 / 1380 行）比较，新增文件或行数增加即失败；`npm run i18n:check` 纳入 CI `quality-gates`，`--update` 可在 i18n 推进后刷新基线。
- 验证：`npx vitest run src/features/admin` → **4 文件 / 41 用例**全部通过（zh-CN 下渲染文案与改造前一致）；`npm run i18n:check` 通过且 admin 模块基线为空；`npm run typecheck`、`npm run lint`（0 error / 822 warn）通过。

**修复记录（2026-11-01，S5）**
- 强校验：`server/src/trustProxy.ts` 新增 `resolveTrustProxy(raw, nodeEnv)`；生产环境未显式设置 `TRUST_PROXY` 时返回错误，`server/src/index.ts` 打印错误并 `exit 1`，避免反代部署漏配导致 IP 限流全站共享、审计 IP 失真；开发环境仅打印提示。
- 取值语义：反代部署 `TRUST_PROXY=1`（单层）或实际跳数（如 CDN + Nginx 为 `2`）；直连部署必须显式 `false`（明确不信任 `X-Forwarded-For`）。
- 文档：`docs/DEPLOYMENT.md` 新增 4.7.1（按部署形态的取值表、Nginx `X-Forwarded-For` 透传示例、启动失败日志样例），4.9 部署验证新增「审计日志 IP 为真实客户端地址」核对项，10.5 补充容器内漏配的后果；`LINUX_DEPLOY.md` 与 `.env.example` 同步说明。
- 测试：`trustProxy.test.ts` 新增 3 例（生产未配置报错、生产显式 `1`/`2`/`false` 放行、非生产仅提示），后端 **23 文件 / 241 用例**全量通过。

**仍存在的问题**
1. **[中 → 已部分修复 2026-11-01]** 前端 dev 依赖漏洞已由 23 降至 **21**：ESLint 9 / typescript-eslint 8 迁移已消除旧版 `eslint` 生态链路；剩余为 `minimatch <11.0.1`（eslint 9 上游尚未适配）、`glob <14.0.2` 与 `ejs 3.x`（`workbox-build` 传递依赖）、`deepmerge`（上游无修复版本），当前无非破坏性修复方案；不进生产 bundle，记录为 dev 债务。
2. **[低]** CI 仅审计生产依赖（`--omit=dev`），dev 漏洞按上文豁免，避免上游生态问题阻断日常提交。

**建议**
- ~~中期安排一次 ESLint 9 + typescript-eslint 8 迁移~~ → **已实施（2026-11-01）**；剩余 dev 漏洞待上游发布修复版本后通过 `npm audit fix` 收敛，暂不引入 `overrides` 强制跨大版本（避免 lint/构建链行为漂移）。
- 生产依赖 audit 门禁已实施（`quality-gates` job），新增依赖须保证生产链 0 high/critical。

---

## 6. 性能瓶颈点

**现状**
- 构建产物 1.81 MB；`manualChunks` 已拆分 recharts / react（`vite.config.ts:116-127`）。
- PWA 预缓存 40 条 / 1.65 MB。
- 路由级懒加载已全覆盖（`src/App.tsx`）。

**问题**
1. **[高 → 已优化 2026-10-31]** **长列表全量渲染**：生词本 / 重点词汇 / 阅读历史已统一接入窗口化虚拟滚动（`src/shared/components/VirtualList.tsx`）：监听 window 滚动、按容器可见位置二分定位行区间，仅渲染视口内行 + overscan，其余行以容器总高度占位；DOM 节点数与列表长度解耦（O(视口)）。行高优先实测（`ResizeObserver` 监听卡片内部展开导致的高度变化），未测量行回退估算值，网格行由 `chunkRows` 按断点列数切分。
2. **[中 → 已优化 2026-10-31]** 全量拉取 + 内存过滤：`getWordbook` 在本地缓存非空时改走 Dexie 索引有序扫描（`queryOrdered` + `countMatching`，新增 words `createdAt` 索引与 Repository 下沉方法），首屏分页命中 limit 后提前终止并保持 SWR 后台刷新；仅当本地缓存为空时回退 `getAllLocalFirst` 全量路径。
3. **[中 → 已缓解 2026-11-01]** SQLite 写串行（见维度 3）：已通过 `busy_timeout`、批量事务与双表写入事务化降低写等待风险；迁移条件见 `docs/DATABASE.md` §3.10。
4. **[低]** Recharts chunk 398.4 KB 在统计页首次进入时一次性加载。

**建议**
- ~~列表统一引入虚拟滚动（或分页 + 窗口化）~~ → **已实施（2026-10-31）**：三处长列表接入窗口化虚拟滚动 `VirtualList`（无新增运行时依赖），视口外行不进入 DOM。
- ~~高频过滤条件下沉为索引查询~~ → **已实施（2026-10-31）**：Dexie 索引有序扫描 + SQLite 复合索引。
- 统计图表按需 `import()`；评估 Recharts 轻量替代（如 visx 按需引入）。

---

## 7. 可维护性与可扩展性

**现状**
- 分层清晰（features → shared → server），共享层职责明确；文档体系完整（17 份顶层文档 + 归档）。
- AI 供应商元数据已统一到 `config/ai-providers.json` 单一注册表，前后端派生（`vite.config.ts` / `server/src/aiConfig.ts`）。

**问题**
1. **[高 → 已修复 2026-10-31]** **文档数值漂移**：根 `README.md`、`docs/README.md`、`docs/TESTING.md` 原声明 58/70/109 个测试文件，实测 **194 / 22 文件、1723 / 216 用例**；三处均已修正为实测值，TESTING.md 第 7 节改为按模块统计（避免穷举导致再次漂移）。
2. **[中 → 已部分缓解 2026-11-01]** 大文件拆分继续推进：`providerContentTasks.ts` 406 → 144 行（拆为 `contentArticleTasks` / `contentQuestionTasks` / `contentTextTasks` + `contentTaskIO`）；剩余主要集中在 `providerCore.ts`（365 行）。
3. **[低]** 新增供应商仍需在 `src/shared/services/ai/index.ts` 的 `PROVIDER_API_KEY_ENV` / `PROVIDER_MODEL_ENV` 增加映射，未完全由 JSON 驱动（前端环境变量映射无法运行时读取 JSON）。

**建议**
- ~~建立「文档数值自动校验」脚本~~ → **已实施（2026-10-31）**：`scripts/verify-docs.mjs` 解析代码实际值并比对三处文档锚点，`npm run docs:verify` 可本地执行，CI `quality-gates` job 阻断漂移。
- 继续按重构轮次拆分大文件（项目已有 ROUND2-4 的拆分经验与归档）。
- 前端映射表增加显式注释与单测，确保新增供应商 checklist 明确。

---

## 8. 文档完整性

**现状**
- `docs/` 顶层 17 份：README / ARCHITECTURE / API_REFERENCE / DATABASE / ER_DIAGRAM / DEPLOYMENT / LINUX_DEPLOY / OPERATIONS / TESTING / UPGRADE / CODING_STANDARDS / MULTI_USER_DESIGN / AI_API_CONFIGURATION / AI_TOKEN_OPTIMIZATION / CACHING / TECHNICAL_ANALYSIS / USER_GUIDE；`archive/` 保留历史快照；根目录另有 SECURITY.md / CHANGELOG / BUGLOG / CONTRIBUTING。
- `docs/README.md` 已建立按用途索引与归档约定。

**问题**
1. **[高 → 已修复 2026-10-31]** 测试规模与文件数在根 README、docs/README、TESTING.md 三处不一致且均与实测不符；现已全部修正为 194 / 22 文件、1723 / 216 用例。
2. **[低]** `docs/TESTING.md` 中已移除「Task 5.3」等历史过程措辞（第 7 节已改为当前实现统计）。
3. **[低]** ER_DIAGRAM 已更新为 12 表，但 API_REFERENCE 部分表格可能仍按 7 表描述（需逐节核对）。

**建议**
- ~~加入 CI 数值校验脚本，防止文档数值再次漂移~~ → **已实施（2026-10-31）**：CI 新增 `quality-gates` job，文档数值漂移直接阻断合入。
- 清理过程性措辞，统一为「当前实现」表述。

---

## 9. 测试覆盖情况

**现状**
- 前端 **199** 文件 / **1749** 用例；后端 **23** 文件 / **241** 用例；E2E **10** spec（fixture + 真实后端 + SW，含无障碍与移动端回归）。
- 覆盖阈值：statements 91 / branches 81 / functions 91 / lines 93（实测基线 95.05 / 85.36 / 95.17 / 97.11）。
- CI 六段：`quality-gates`（生产依赖 audit + 文档数值校验）→ lint → 前端 test:coverage → 服务端 build+test → 生产 build → E2E（`ci.yml`）。

**问题**
1. **[中]** 前后端用例数量差距悬殊（1749 vs 241），但**覆盖面并不薄弱**：后端已有 `rbac` / `isolation` / `audit` / `migration` / `trustProxy` / `aiQuota` / `health` 等专项测试文件（23 个文件覆盖认证、授权、隔离、审计、迁移、限流、配额、健康探针全链路）。差距主要源于前端 UI 用例粒度更细。
2. **[中 → 已修复 2026-11-01]** E2E 原有 fixture 模式不覆盖真实后端；L3 新增 `real-backend.spec.ts`（真实 Express + 临时 SQLite + 真实登录，覆盖登录 → 阅读 → 标记已读 → 历史 → 生词 → 复习），并纳入 CI。
3. **[低]** branches 阈值低于基线 4 个百分点，分支覆盖回退不易被发现。

**建议**
- 保持后端专项测试覆盖面，同时提升单文件断言密度（当前 241 用例 / 23 文件 ≈ 10.5 用例每文件）。
- 增加 1 组真实后端 E2E（临时 SQLite + 真实 Express），覆盖登录→阅读→生词→复习主链路。
- 逐步上调 branches 阈值。

---

## 10. 部署与运维流程

**现状**
- 部署：PM2 / systemd + Nginx + SSL（`docs/LINUX_DEPLOY.md`）；构建 `tsc -b && vite build` + server `tsc`；另提供容器化方案（`Dockerfile` 双目标 + `docker-compose.yml` 蓝绿双槽位 + `scripts/blue-green-deploy.mjs`，见 `docs/DEPLOYMENT.md` §10）。
- 健康检查：`/api/health`（存活，不依赖数据库）与 `/api/health/ready`（就绪，数据库探活 200/503），后者同时用于容器 `HEALTHCHECK` 与蓝绿切流门禁。
- 运行安全：限流（全局 60/min/IP、登录 5/min、AI 代理 20/min/用户）、CORS 白名单、生产强制 `ENCRYPTION_KEY` fail-fast。
- 反代支持：`server/src/trustProxy.ts` 解析 `TRUST_PROXY` 并在生产环境强校验（未显式配置拒绝启动；反代设 `1`/跳数，直连设 `false`），Nginx 示例含 `X-Forwarded-For` 透传（见 `docs/DEPLOYMENT.md` 4.7.1）。

**问题**
1. **[高 → 已修复 2026-11-01]** 部署在 Nginx 之后若未配置 `TRUST_PROXY`，`req.ip` 恒为反代地址，导致 **IP 维度限流全站共享**、审计日志 IP 失真 → S5 在 `server/src/trustProxy.ts` 增加生产环境强校验（未显式配置 `exit 1`），并在 `docs/DEPLOYMENT.md` 4.7.1 给出按部署形态的取值表与 Nginx 头透传示例。
2. **[中]** `migrateMultiUser.ts` 的幂等性、失败中断与回滚策略缺少专门测试与运维手册步骤。
3. **[低 → 已修复 2026-11-01]** 无容器化 / 无蓝绿发布方案，升级依赖手工 PM2 重启 + SW 缓存更新；现已有容器镜像、双槽位编排与就绪门禁切流脚本，且容器内 `TRUST_PROXY=1` 与 `CORS_ORIGIN` 由 `.env` 统一注入。

**建议**
- ~~部署检查清单增加「反代场景必须设置 TRUST_PROXY」项，并提供 Nginx 配置示例~~ → **已实施（2026-11-01，S5）**：生产启动强校验 + 取值表 + Nginx 头透传示例 + 部署验证清单新增审计 IP 核对项。
- 补充迁移演练脚本（备份 → 迁移 → 校验 → 回滚）并纳入 OPERATIONS。
- ~~中期引入容器化与健康检查~~ → **已实施（2026-11-01）**：容器化 + 存活/就绪分离 + 蓝绿切流脚本；后续可在具备 Docker 的主机补一轮真实镜像发布演练。

**【补充】部署相关安全注意**：`proxy-addr` 漏洞恰位于反代 IP 解析链路（见维度 5），升级前建议避免在公网直接暴露服务端。

---

## 11. 用户体验相关设计

**现状**
- 路由懒加载 + `Suspense` + `ErrorBoundary` 全覆盖（`src/App.tsx`）；加载/空/错误态基本齐全。
- 特色体验：纯英文阅读、全文朗读、一键完整打印（`PrintableWorksheet`）、深色模式、中英双语、PWA 离线。
- 打印：Portal + `@media print`，七章节（原文/阅读/语法/答案/单词/短语/翻译），题目懒生成缺失时自动补齐。

**问题**
1. **[高 → 已部分修复 2026-11-01]** **i18n 覆盖不完整**：admin 模块 4 个页面已全部接入 `useTranslation`（用户管理 / 班级学情 / 审计日志 / AI 成本，含日期与数字的 locale 格式化）；其余模块仍存在中文硬编码，按 `npm run i18n:check` 口径共 **163 个文件 / 1380 行**（剔除注释与测试），英文界面仍会出现中英混杂。
2. **[中 → 已优化 2026-10-31]** 长列表无虚拟化：三处长列表已接入窗口化虚拟滚动（同维度 6），仅渲染视口内行，滚动开销与数据量解耦。
3. **[中 → 已修复 2026-11-01]** 无障碍未系统化：已落地基线（跳转链接、导航具名与 `aria-current`、弹窗焦点循环与恢复、toast / 加载态 `role="status"`、搜索框 `aria-label`，见 L4）。
4. **[低 → 已修复 2026-11-01]** 移动端仅有 Tailwind 响应式：已补 `e2e/mobile.spec.ts`（375×667 / 320×568 底部 Tab 与横向溢出回归）。

**建议**
- ~~admin 模块优先 i18n 化；CI 增加「新增中文字面量」检测（排除 locales 与注释）~~ → **已实施（2026-11-01，S4）**：admin 4 页 i18n 完成；`scripts/check-i18n-literals.mjs` 按基线逐文件比较新增中文行，已纳入 `npm run i18n:check` 与 CI `quality-gates`。
- 虚拟滚动已补 `VirtualList` / `chunkRows` / `useResponsiveColumns` 单测，后续再补 E2E 滚动性能回归。
- ~~建立无障碍基线（表单 label、列表键盘可达、toast `role="status"`）~~ → **已实施（2026-11-01）**：见 L4；后续按页面补充键盘操作（长按菜单的键盘替代入口）。

---

## 12. 潜在风险与技术债务汇总

| 编号 | 风险/债务 | 严重度 | 可验证依据 |
| --- | --- | --- | --- |
| R1 | 后端依赖漏洞（proxy-addr critical / body-parser high / qs moderate） | **已修复** | 2026-10-31 升级至 express 4.22.3 / body-parser 1.20.9 / qs 6.16.2 / proxy-addr 2.0.8；`npm audit` 0 漏洞 |
| R2 | 文档测试数值三处漂移（58/70/109 文件 vs 实际 194） | **已修复** | 三处已修正；当前实测 199 / 23 文件、1749 / 241 用例 |
| R3 | 无列表虚拟化 | **已优化** | 2026-10-31：三处长列表接入 `VirtualList` 窗口化虚拟滚动（仅渲染视口内行） |
| R4 | 硬编码中文（admin 已清零，其余 1380 行） | **部分修复** | 2026-11-01：admin 4 页接入 i18n；`npm run i18n:check` 基线 163 文件 / 1380 行，新增即阻断 |
| R5 | 反代未配 TRUST_PROXY 时 IP 限流/审计失真 | **已修复** | 2026-11-01：生产环境强校验（`resolveTrustProxy` 未显式配置拒绝启动），部署文档 4.7.1 取值表 + Nginx 示例 |
| R6 | 前后端用例数量差距（1749 vs 241，覆盖面已完整） | **中** | 文件/用例计数 |
| R7 | 大文件（365 行） | **部分修复** | requestRunner 398→196、ReadingPage 459→415、fallback-articles 393→约 35（数据外置）、providerContentTasks 406→144（2026-11-01） |
| R8 | 全量 getAll + 内存过滤 | **已优化** | 2026-10-31：`queryOrdered` + Dexie 索引（words createdAt / mastery / nextReview） |
| R9 | ESLint 缺类型感知规则（floating promises） | **已缓解** | 2026-11-01 已启用 `recommendedTypeChecked`（warn，`projectService`）；822 warn 待分批收紧 |
| R10 | console 调用 223 处，无统一日志层 | **已修复** | 2026-11-01：统一 `logger`（前端 `src/shared/utils/logger.ts` / 后端 `server/src/logger.ts`），生产代码裸 console 归零 |
| R11 | 兜底素材硬编码且池有限 | **已缓解** | 2026-11-01 外置 `fallback-articles.json` 并扩充至 13 篇 |
| R12 | SQLite 单写者，多用户写入串行 | **已缓解** | 2026-11-01：`busy_timeout 5s` + 批量/双表事务化；迁移触发条件见 DATABASE.md §3.10 |
| R13 | E2E 未覆盖真实后端 | **已修复** | 2026-11-01：新增真实 Express + SQLite 主链路 E2E 并纳入 CI（`e2e/real-backend.spec.ts`） |
| R14 | ~~多用户迁移幂等/回滚未专测~~ → 已有 `migration.test.ts` | **已排除** | `server/src/__tests__/migration.test.ts` |
| R15 | 纯前端参数 clamp，服务端无同源校验 | **低** | 学习目标/复习上限实现 |
| R16 | branches 覆盖率阈值偏低 | **低** | `vitest.config.ts:42` |
| R17 | Recharts 大 chunk 未按需加载 | **低** | dist 407.9 KB |
| R18 | AI 上游费用不可控（无日/月预算与成本视图） | **已缓解** | 2026-11-01：日/月 token 预算 + `/admin/ai-usage` 成本面板 + `ai.proxy.usage` 用量审计 |
| R19 | 无障碍未系统化、移动端无专门回归用例 | **已修复** | 2026-11-01：`useModalFocus` 焦点管理 + 导航/跳转链接/状态语义 + `a11y.spec.ts` / `mobile.spec.ts` |
| R20 | 无容器化 / 无蓝绿发布，升级靠手工重启 | **已修复** | 2026-11-01：`Dockerfile` 双目标 + `docker-compose.yml` 双槽位 + `/api/health/ready` 就绪门禁 + `scripts/blue-green-deploy.mjs` |

> 无以下问题：`any` 滥用（0）、`TODO/FIXME`（0）、无 CI（已具备 6 段流水线，含依赖审计、文档校验与中文硬编码门禁）、无覆盖率阈值（已具备）、`VITE_*` 密钥进 bundle（已隔离为服务端密钥）。

---

## 13. 改进路线图

### 短期（1–2 周，安全与一致性优先）

| 项 | 动作 | 对应问题 | 预期收益 |
| --- | --- | --- | --- |
| S1 | ✅ **已完成（2026-10-31）**：升级 express 4.22.3 / body-parser 1.20.9 / qs 6.16.2 / proxy-addr 2.0.8，后端 audit 归零；CI `quality-gates` job 固化前后端生产依赖 audit | R1 | 生产依赖漏洞清零（实测 0） |
| S2 | ✅ **已完成（2026-10-31）**：三处测试数值已修正（194/22 文件、1723/216 用例）；`scripts/verify-docs.mjs` + `npm run docs:verify` 纳入 CI | R2 | 文档与实测一致 |
| S3 | ✅ **已完成（2026-11-01）**：新增前后端 `logger`（`debug` 仅开发环境，`info/warn/error` 始终输出），替换生产代码 **268** 处裸 console（87 个文件）；日志模块是唯一允许直接调用 `console` 的位置 | R10 | 生产日志可控、减少信息泄露面 |
| S4 | ✅ **已完成（2026-11-01）**：admin 4 页（用户管理 / 班级学情 / 审计日志 / AI 成本）全部接入 `useTranslation`，新增约 100 个 `admin.*` 双语键（含日期 / 数字 locale 格式化）；新增 `scripts/check-i18n-literals.mjs` + `scripts/i18n-baseline.json` 中文硬编码基线，`npm run i18n:check` 纳入 CI `quality-gates`，新增中文行即阻断 | R4 | 英文界面一致性 |
| S5 | ✅ **已完成（2026-11-01）**：`resolveTrustProxy` 生产环境强校验（未显式配置 `TRUST_PROXY` 时启动即 `exit 1`；反代设 `1`/跳数，直连设 `false`），开发环境仅提示；`docs/DEPLOYMENT.md` 4.7.1 补齐取值表、Nginx `X-Forwarded-For` 透传示例与审计 IP 验证步骤；`.env.example` / `LINUX_DEPLOY` / 容器说明同步；`trustProxy.test.ts` 新增 3 例 | R5 | 避免限流全站共享 |
| S6 | ✅ **已完成（2026-10-31）**：前端修复 vitest / coverage-v8 → 4.1.12、react-router-dom → 7.18.5，生产依赖 audit 0；剩余 23 个 dev 漏洞转入中期 ESLint 9 迁移 | R1 | 生产链安全、工具链漏洞收窄 |

### 中期（1–2 月，性能与可维护性）

| 项 | 动作 | 对应问题 | 预期收益 |
| --- | --- | --- | --- |
| M1 | ✅ **已完成（2026-10-31）**：生词本 / 重点词汇 / 阅读历史接入窗口化虚拟滚动 `VirtualList`（window 滚动 + 二分定位可见行 + 容器占位高度 + ResizeObserver 实测行高），视口外行不进入 DOM | R3 | 长列表渲染与 DOM 规模同数据量解耦（O(视口)） |
| M2 | ✅ **已完成（2026-10-31）**：`getWordbook` 查询下沉 Dexie 索引（`queryOrdered` + `countMatching`，缓存为空时回退全量 SWR）；SQLite 新增 words(userId,mastery/nextReview/createdAt)、reviews/readingSessions(userId,reviewedAt) 复合索引 | R8 | 减少全表加载与内存排序开销 |
| M3 | ✅ **已完成（2026-11-01）**：requestRunner 398→196 行（streamRunner 198 / usageRecorder 65 拆分，2026-10-31）、ReadingPage 459→415 行（ReadingPrintPortal / ReadingPageViews / 守卫渲染拆分，2026-10-31）；`providerContentTasks.ts` 406→144 行（2026-11-01，拆为 `contentArticleTasks` 142 / `contentQuestionTasks` 173 / `contentTextTasks` 128 / `contentTaskIO` 27） | R7 | 核心传输与大页面职责收敛 |
| M4 | ✅ **已完成（2026-11-01）**：`db.test.ts` 补 12 张表结构与 M2 复合索引回归、`rateLimit.test.ts` 补标准 `RateLimit-*` 头递减与超限错误体、`cors.test.ts` 补多来源白名单与预检策略，共 +7 用例（216 → 223） | R6 | 关键契约（表/索引/限流头/CORS 预检）具备缺陷捕获力 |
| M5 | ✅ **已完成（2026-11-01）**：兜底素材外置为 `src/features/reading/data/fallback-articles.json`（`fallback-articles.ts` 393→约 35 行），并扩充为 13 篇（新增 campus 书信、science 睡眠与梦、culture 端午） | R11 | 内容可运营、减少重复感 |
| M6 | ✅ **已完成（2026-11-01）**：`eslint 9.39.5` + `typescript-eslint 8.72.1` 扁平配置（删除 `.eslintrc.cjs`），开启 `recommendedTypeChecked`（先 warn，0 error / 822 warn）；dev audit 23 → 21，剩余均为上游无非破坏性修复的传递依赖（生产链仍为 0） | R9 / dev 依赖债务 | 静态拦截 floating promise、旧 ESLint 生态链路清零 |

### 长期（1 季度，扩展性与体验）

| 项 | 动作 | 对应问题 | 预期收益 |
| --- | --- | --- | --- |
| L1 | ✅ **已完成（2026-11-01）**：写入加固（`busy_timeout = 5000`、articles POST/PUT/DELETE 双表事务化）+ 扩展性评估（容量判断、Postgres 迁移触发条件与设计要点，见 `docs/DATABASE.md` §3.10）；结论为本季度维持 SQLite | R12 | 写等待可控、迁移决策有据 |
| L2 | ✅ **已完成（2026-11-01）**：AI 代理接入每用户日/月 token 预算（`AI_DAILY_TOKEN_BUDGET` 默认 10 万 / `AI_MONTHLY_TOKEN_BUDGET` 默认 200 万，超限 429 `AI_BUDGET_EXCEEDED`）；非流式与 SSE 流式均采集上游 `usage` 并写入 `ai.proxy.usage`（token + 估算成本，不记 prompt）；新增 `/api/admin/ai-usage` 聚合端点与 `/admin/ai-usage` 成本面板（日/模型/用户维度、预算使用率），权限沿用 `logs:view` | 成本风险 | 费用可控、成本可观测 |
| L3 | ✅ **已完成（2026-11-01）**：`npm run test:e2e:real` 启动真实 Express（临时 SQLite + 固定管理员）+ vite dev，`real-backend.spec.ts` 不拦截 `/api`，覆盖登录 → 阅读 → 标记已读 → 历史状态合并 → 生词写入 → 复习队列，以及错误密码 401 文案；CI E2E job 新增该轮执行 | R13 | 跨层契约盲区收敛 |
| L4 | ✅ **已完成（2026-11-01）**：`useModalFocus` 统一弹窗焦点（初始聚焦 / Tab 循环 / 关闭恢复，7 个弹窗接入）、跳过导航跳转链接、导航具名与 `aria-current`、toast 与加载态 `role="status"`；新增 `e2e/a11y.spec.ts` 与 `e2e/mobile.spec.ts`（375 / 320 窄屏底部 Tab + 无横向溢出），默认 E2E 14/14 通过 | R19 | 可访问性与一致性 |
| L5 | ✅ **已完成（2026-11-01）**：`/api/health`（存活）与 `/api/health/ready`（就绪，数据库探活）分离；`Dockerfile` 双目标（app / web）+ `.dockerignore` + `docker-compose.yml` 蓝绿双槽位（profiles）+ `deploy/nginx.conf`；`scripts/blue-green-deploy.mjs` 以就绪探针为切流门禁、失败自动回滚 upstream；后端新增 6 例健康检查测试。本机无 Docker，容器运行需在目标主机按 `docs/DEPLOYMENT.md` §10 验证 | 运维 | 降低升级风险 |

---

## 14. 度量方法与可复现命令

```powershell
# 代码规模
(Get-ChildItem src -Recurse -Include *.ts,*.tsx -File).Count
(Get-ChildItem server/src -Recurse -Include *.ts -File).Count

# 测试规模
(Get-ChildItem src -Recurse -Include *.test.ts,*.test.tsx -File).Count
(Get-ChildItem server/src -Recurse -Include *.test.ts -File).Count

# 依赖漏洞
npm audit --omit=dev
npm --prefix server audit --omit=dev

# 交付物体积
Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum

# 代码卫生
rg -n ":\s*any\b|as any\b" src server/src
rg -n "TODO|FIXME|HACK" src server/src
rg -n "console\.(log|warn|error)" src
```

---

## 相关文档

- [架构文档](./ARCHITECTURE.md)｜[数据库设计](./DATABASE.md)｜[API 参考](./API_REFERENCE.md)
- [测试策略](./TESTING.md)｜[开发规范](./CODING_STANDARDS.md)｜[安全政策](../SECURITY.md)
- [部署指南](./DEPLOYMENT.md)｜[运维手册](./OPERATIONS.md)｜[多用户设计](./MULTI_USER_DESIGN.md)
- 历史快照：[archive/PROJECT_ANALYSIS_REPORT.md](./archive/PROJECT_ANALYSIS_REPORT.md)
