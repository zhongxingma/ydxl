# 变更日志 Changelog

本项目所有重要变更均记录于此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，并遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

变更类型：

- `Added` 新增功能
- `Changed` 对现有功能的变更
- `Fixed` 错误修复
- `Removed` 已移除的功能
- `Deprecated` 即将废弃的功能
- `Security` 安全相关修复

> **日期说明**：v1.7.0 及之后版本记录精确到日的日期；v1.0.0–v1.6.0 因无版本库提交历史可考，仅记录到月份（`2026-07`），不臆造具体日期。

## [Unreleased]

### Added

- **LICENSE**：采用 MIT 许可证
- **SECURITY.md**：安全政策入口，收敛分散于 OPERATIONS / MULTI_USER_DESIGN / CODING_STANDARDS 的安全机制描述，并新增漏洞报告渠道与 P0/P1/P2 修复时限承诺
- **CI（GitHub Actions）**：`.github/workflows/ci.yml` 在 push / PR 时自动运行前端 typecheck / lint / 测试（90 文件 / 731 用例）、服务端 tsc build + 测试（22 文件 / 216 用例）、生产构建与 Playwright E2E（e2e job，Node 20 + 内置 Chromium，含 vite dev 与生产构建 SW 两轮）
- **多用户 P1（RBAC 与用户管理）**：新增 `server/src/permissions.ts`（10 权限点 × admin/teacher/student 三角色硬编码矩阵，未知角色 fail-closed）与 `server/src/adminRoutes.ts`（`/api/admin/users` 五端点：列表 / 创建 / 禁用启用 / 重置密码 / 改角色；软删除、操作即时吊销目标用户会话、禁止操作自己、响应不含 passwordHash）；前端新增 `/admin` 用户管理页（`RequireAdmin` 路由守卫 + 桌面导航 admin 角色专属「管理」入口）；新增 3 个测试文件 35 用例（权限矩阵逐点、管理 API 全流程、守卫与服务端行为）
- **多用户 P2（审计日志）**：新增第 12 张表 `operation_logs` 与 `server/src/audit.ts`（只追加写入 + 防御性脱敏 + 180 天保留策略：启动时归档 CSV 至 `server/data/log-archive/` 后清理）；动作字典全覆盖接入（认证 / 用户管理 / 数据写操作 / 敏感读 / AI 调用 / 403 权限拒绝）；新增 `GET /api/admin/logs`（logs:view：admin + teacher）与 CSV 导出端点，查询与导出行为自身留痕；前端新增 `/admin/logs` 审计日志页（过滤 / 分页 / 导出），`RequireAdmin` 泛化 `roles` prop，teacher 顶栏显示「日志」入口
- **多用户 P3（班级学情聚合）**：新增 `server/src/classStats.ts`（SQL 聚合：窗口内按用户汇总阅读/生词/复习/掌握、活跃天数、最新 streak 与最近学习日期、按会话加权正确率）与只读端点 `GET /api/admin/class-stats?days=N`（`stats:class`：admin + teacher；默认 30 天、上限 180）；查询行为写审计 `class_stats.view`；前端新增 `/admin/class-stats` 班级学情页（窗口切换 + 汇总卡片 + 学员明细），teacher 与 admin 顶栏均显示「学情」入口
- **多用户 P3（AI 配额按用户计量）**：AI 代理限流主计量维度由 IP 改为 userId（20 次/分钟/用户），`createAiProxyLimiter()` 工厂 + 默认实例（测试可注入小配额与 skip）；解决机房 / NAT 共享出口下单用户刷满误伤同网段学员的问题
- **多用户 P3（会话管理 / 我的设备）**：新增 `/api/auth/sessions` 三端点（GET 列出我的设备 / DELETE `/:id` 移除指定设备 / DELETE 全端下线）；列表仅返回脱敏令牌指纹（前 8 + 尾 4）与 `current` 标记，移除以 `rowid + userId` 联合限定防越权，过期会话惰性清理；操作写审计 `auth.revoke_session` / `auth.logout_all`；前端 Profile 页新增设备管理区块（`SessionSection` 组件）
- **多用户 P3（性能压测脚本）**：新增 `server/src/loadtest.ts`（纯 Node fetch 零依赖，`npm run loadtest`：默认 30 并发 / 300 请求，输出 RPS、成功率、状态码分布与延迟分位 p50/p90/p99），便于部署后基线压测
- **测试基线增长**：前端 90 文件 / 731 用例，后端 22 文件 / 216 用例（合计 947）；用例总数不变，文件按职责拆分
- **E2E 测试（Playwright）**：引入 `@playwright/test` 与 `e2e/` 测试目录（`helpers.ts` fixture 辅助 + 7 个 spec 共 11 用例），采用「前端级 + API 拦截」路线——真实浏览器访问 vite dev，`page.route()` 拦截全部 `/api` 返回预置 fixture（AI 代理统一 404 验证降级路径），业务数据经原生 IndexedDB 直写 Dexie 预置；覆盖阅读（AI 失败分支 / 答题成功分支）、复习五步全流程、离线回退（OfflineBanner + 本地队列 + 文章缓存）、生词本添加、打印（AI 失败降级 / 预置题目完整版）、多用户切换（登出拦截 / 换账号清空本地缓存 / 同账号保留）六条路径；另增生产构建 SW 离线验证（单一 `playwright.config.ts` 按 npm 脚本 / `PW_SW` 切换 dev 与 preview 模式，断网后整页重载由 Workbox 预缓存支撑，因 SW 透传请求需用 `context.route` 拦截）；CI e2e job 依次运行两轮（dev 拦截 + 生产 SW，`npx playwright install --with-deps chromium`，Node 20）；`.gitignore` 排除 `test-results/` / `playwright-report/` / `blob-report/`

### Changed

- **大文件拆分（保持接口不变）**：`baseProvider.ts` 的 JSON 解析工具（`extractJsonBlock` / `parseJsonResponse` / `parseJsonArrayResponse` / `parseExampleSentence`）迁至 `shared/services/ai/jsonParsing.ts`；`server/src/routes.ts` 拆为 `routes/shared.ts`、`routes/tableRouter.ts`、`routes/articlesRouter.ts`、`routes/wordsBulkRouter.ts`，原文件保留为统一出口；`ReadingPage.tsx` 的顶部栏、重点短语区块与底部操作区拆为 `ReadingHeader` / `ArticlePhrasesSection` / `ReadingActions` 组件
- **重复代码收敛**：Dashboard 与答题组件的内联 SVG 图标统一到 `shared/components/icons.tsx`（新增 `CheckIcon` / `CrossIcon` / `TrendUpIcon` / `TrendDownIcon` / `WarningIcon`）；`OPTION_LETTERS` 与 `QuizGenStage` 收敛到阅读模块 `types.ts`；`formatDuration` 收敛到 `useReadingTimer.ts`
- **AI Provider 传输层拆分**：并发节流、退避重试、`callChat` / `callChatStream`、SSE 解析与错误映射迁至 `shared/services/ai/requestRunner.ts`；`baseProvider.ts` 由 1705 行降至 1015 行，保留同名 protected 方法委托，子类与业务调用方零改动
- **阅读页逻辑拆分**：`ReadingPage.tsx` 的阅读 / 答题 / 成绩单视图拆为 `ReadingArticleView` / `ReadingQuizView` / `ReadingResultView` / `GrammarInterstitial` 组件，文章加载与短语补全迁至 `useArticleLoader`，答题 / 语法填空 / 练习生成与重试迁至 `useQuizRunner`，一键打印迁至 `usePrintWorksheet`；页面由 1409 行降至 570 行，仅保留编排与渲染，行为与接口不变
- **首页仪表盘拆分**：`DashboardPage.tsx` 的概览数据与文章列表迁至 `hooks/useDashboardOverview` / `hooks/useDashboardArticles`，展示区块拆为 `DashboardQuickActions` / `DashboardStatGrid` / `DashboardTodayTodo` / `DashboardReviewWords` / `DashboardGrowthPanels`；页面由 650 行降至 224 行，保留 SWR 缓存联动、分页与 recharts 懒加载行为不变，并新增 2 个组件冒烟测试
- **复习练习生成器拆分**：`PracticeStep.tsx` 的 7 种题型、题库常量与随机生成逻辑迁至同目录 `practiceQuestionGenerator.ts`（纯函数），组件由 644 行降至约 300 行、仅保留答题交互；新增 5 个生成器单测（题量区间、选项唯一、答案索引、题型降级、标签完整性）
- **文章服务拆分**：`articleService.ts` 由 592 行降至 55 行、仅保留聚合出口；文章生成 / contentHash 与标题去重 / 兜底素材库迁至 `articleGenerationService.ts`，阅读状态与查询迁至 `articleReadService.ts`，`ArticleNotFoundError` 独立到 `articleErrors.ts`；全部命名导出与调用方导入路径不变
- **远程仓储拆分**：`remoteRepository.ts` 由 618 行拆为统一出口 + `remoteRepositoryBase.ts`（`RemoteRepository` / `PaginatedResponse`）+ `cachedRemoteRepository.ts`（`CachedRemoteRepository` 的 SWR、30 秒节流与离线回退）；`repositories.ts` 与 `shared/services` 的导出路径不变
- **生词本页面拆分**：`WordbookPage.tsx` 由 493 行降至 262 行；列表查询 / 分页 / 统计 / 搜索防抖 / 缓存刷新迁至 `hooks/useWordbookList`，长按操作菜单拆为 `WordbookActionMenu`；新增 3 个冒烟测试（列表 / 空状态 / 全部掌握）
- **个人中心设置拆分**：`useProfileSettings.ts` 由 453 行降至 246 行；localStorage / secureStorage 读写与 legacy 迁移迁至 `profileSettingsStorage`，统计数据与累计时长迁至 `useProfileStats`；`AIProviderType` / `ProfileStats` / `formatDuration` 的对外导出保持不变
- **单词卡片拆分**：`WordCard.tsx` 由 462 行降至 118 行；头部（收藏 / 朗读 / 徽章）、详情（释义 / AI 补全 / 例句 / 短语 / 笔记）与底部（稳固度 / 掌握进度 / 操作）拆为 `WordCardHeader` / `WordCardDetails` / `WordCardFooter`，长按手势提取为共享 `useLongPress` 并新增 6 个单测
- **AI Provider 再拆分**：`baseProvider.ts` 由 1015 行降至聚合出口；配置 / 密钥解析 / 端点与传输委托迁至 `providerCore.ts`，文章 / 题目 / 语法填空 / 翻译 / 词汇 / 短语迁至 `providerContentTasks.ts`，单词提示 / 拼读 / 助记 / 例句 / emoji / 连通性测试 / 补全迁至 `providerWordTasks.ts`，子类继承路径与公开接口不变
- **Prompt 模板按领域拆分**：`prompts.ts` 505 行拆为 `promptShared.ts`（输出规则 / 文体题材难度映射 / 创作风格预设）+ `articlePrompts.ts` + `wordPrompts.ts`，`prompts.ts` 保留聚合出口
- **Token 统计拆分**：`tokenStats.ts` 463 行拆为 `tokenStatsTypes.ts`（记录 / 聚合 / 快照类型与定价表）+ `tokenStatsStorage.ts`（localStorage 读写与条目校验）+ `tokenStats.ts`（内存聚合与成本估算），统计口径与导出不变
- **已掌握页拆分**：`MasteredPage.tsx` 由 425 行降至 131 行；分页 / 搜索防抖 / 排序 / 无限滚动 / 缓存失效重载迁至 `hooks/useMasteredWords`，单词卡片拆为 `components/MasteredWordCard`
- **添加文章 Modal 拆分**：`AddArticleModal.tsx` 由 413 行降至 83 行；字段状态 / AI 翻译 / 保存 / 关闭清理迁至 `hooks/useAddArticleForm`，表单字段视图拆为 `components/AddArticleFormFields`
- **生词本服务拆分**：`wordbookService.ts` 由 441 行降至聚合出口；添加 / 批量添加 / 笔记 / 删除 / 收藏迁至 `wordbookMutationService.ts`，列表分页筛选排序与统计迁至 `wordbookQueryService.ts`，AI 补全迁至 `wordEnrichmentService.ts`
- **学习统计服务拆分**：`statsService.ts` 由 418 行降至聚合出口；每日指标累加 / 连续打卡 / 阅读会话记录迁至 `statsRecordingService.ts`，区间数据 / 阅读能力趋势 / 概览 / 成就上下文迁至 `statsQueryService.ts`
- **AI 传输层再拆分**：`requestRunner.ts` 由 685 行降至流程编排；`requestTypes.ts`（公共类型）、`requestRetry.ts`（退避重试 / 并发限流）、`requestPayload.ts`（请求头 / 信封 / 错误解析）、`sseParser.ts`（SSE 流解析）分模块实现
- **AI 供应商入口拆分**：`ai/index.ts` 由 506 行降至聚合出口；环境与 localStorage 配置解析迁至 `aiConfig.ts`，内置 / 自定义 / 兜底供应商组装迁至 `providerFactory.ts`，动态委托单例迁至 `aiProviderProxy.ts`
- **缓存仓储拆分**：`cachedRemoteRepository.ts` 由 503 行降至 383 行；`where` / `count` 等索引查询迁至 `LocalIndexRepository` 基类，远程 → 本地增量同步与批量写缓存迁至 `cacheSync.ts`，公开方法与缓存语义不变
- **个人中心页面拆分**：`ProfilePage.tsx` 由 414 行降至 104 行；统计卡、偏好设置（学习目标 / 发音 / 提醒）与 AI 配置拆为 `ProfileStatsGrid` / `ProfilePreferencesSection` / `ProfileAISettingsSection`
- **服务端 AI 代理拆分**：`server/src/ai-proxy.ts` 由 577 行降至 62 行；上游注册与运行时解析迁至 `aiProxyUpstreams.ts`，重试传输 / 非流式转发 / 请求体校验迁至 `aiProxyTransport.ts`，SSE 转发迁至 `aiProxyStream.ts`，审计与用户维度限流独立为 `aiProxyAudit.ts` / `aiProxyLimiter.ts`
- **阅读页再拆分**：`ReadingPage.tsx` 由 570 行降至 459 行；加载 / 完成标记 / 缓存刷新 / toast / 难度选择副作用迁至 `useReadingLifecycle`，骨架屏与错误态拆为 `ReadingPageFallback`
- **答题流程拆分**：`useQuizRunner.ts` 由 456 行降至 254 行；语法填空 / 词汇生成与重试迁至 `useContentGeneration`，已读保存与按需出题迁至 `useMarkAsRead`，对外返回字段不变
- **查词 hook 拆分**：`useWordLookup.ts` 由 402 行降至 94 行；选区处理 / 查词竞态 / 浮层关闭迁至 `useWordSelectionPopover`，单个与批量加入生词本迁至 `useWordbookActions`
- **题目服务拆分**：`questionService.ts` 由 378 行降至 181 行；结构校验 / id 规范化 / 错误消息 / 去重文本迁至 `questionValidation.ts`，AI 结果转 Question 实体迁至 `questionMapper.ts`
- **复习步骤拆分**：`ReadStep.tsx` 由 384 行降至 267 行、`SpellStep.tsx` 由 382 行降至 231 行；朗读的语速 / 波形 / 录音评分 / AI 拼读提示迁至 `useReadStep`，拼写的输入 / 分级提示 / 抖动与闪现状态迁至 `useSpellStep`，分级遮罩 `getMask` 独立到 `spellHint.ts`
- **复习页拆分**：`ReviewPage.tsx` 由 353 行降至 105 行；视图状态机 / 队列加载 / 评分与成就处理迁至 `hooks/useReviewPage`，sticky 进度条拆为 `components/ReviewProgressHeader`
- **管理路由拆分**：`server/src/adminRoutes.ts` 由 363 行降至 26 行路由组装；用户管理五端点在 `adminUserRoutes.ts`，审计日志查询与 CSV 导出在 `adminLogRoutes.ts`，班级学情聚合在 `adminClassStatsRoute.ts`；权限分组（`users:manage` / `logs:view` / `stats:class`）与原路径不变
- **测试套件按职责拆分**：14 个大型测试文件拆为 43 个聚焦文件 + 11 个共享 harness 模块（AI Provider / 代理契约 / Token 统计 / 远程仓储 / 存储管理 / 统计服务 / 跨模块流程 / 文章去重 / 题目服务 / 复习服务 / REST 路由 / 服务端 AI 代理），用例总数保持前端 731 + 服务端 216 不变；最大测试文件由 1390 行降至 496 行

### Removed

- **历史文档归档**：`PROJECT_ANALYSIS_REPORT.md`、`DOC_SYNC_SUMMARY_2026-10-18.md`、`E2E_TEST_REPORT.md` 移入 `docs/archive/`，`docs/README.md` 新增「历史归档」分区与维护约定

### Security

- **共享内容写入分级**：新增 `content:manage` 权限点（teacher/admin），通用表路由的 articles/questions 编辑与删除前置校验并写审计；文章 POST（AI 生成回写）保持所有登录用户可用，学生仅可更新 `vocabulary` / `phrases`
- **反向代理与登录限流**：新增 `TRUST_PROXY` 配置（Nginx 后设 `1`，`req.ip` 取真实客户端地址）；登录限流键改为 `IP + 用户名`，避免同一 NAT 出口下不同学生互相误伤
- **敏感信息与错误泄漏**：`secureStorage` 在 IndexedDB/WebCrypto 不可用时仅保存内存、不再明文写入 localStorage；bulk 写入异常不再把 SQLite 原始错误返回客户端；AI 代理增加消息条数（≤50）与总内容长度（≤100000 字符）上限
- **本地数据隔离**：换账号登录 / 登出 / 全端下线统一清空 Dexie 业务缓存、AI 响应缓存与 AI 用量记录

### Fixed

- **请求可靠性**：`localApi` 增加 15 秒超时与外部 `signal` 取消支持，错误响应体优先解析服务端标准结构 `{ error: { message } }`（此前读取扁平 `message` 导致错误信息丢失）
- **阅读状态可见化**：`markAsRead` / `recordReadingStart` 返回是否写入成功，阅读页在标记失败时提示「阅读记录保存失败，请稍后重试」而非静默忽略

---

## [1.8.0] - 2026-10-18

### 概述

恢复完整 AI 供应商矩阵并移除 Web Chat 自动化。`AIProviderName` 从 v1.4.0 的 `'deepseek'` 单供应商恢复为 `deepseek / openai / qwen / custom` 四类，引入 `config/ai-providers.json` 单一配置源；同时彻底移除基于 Puppeteer 的 Web Chat 自动化（含 `HybridAIProvider` 混合调度）。

### Added

- **恢复 OpenAI / 通义千问供应商**：恢复 `openai-provider.ts` / `qwen-provider.ts`（继承 `BaseAIProvider`）；`AIProviderName` 类型扩展为 `'deepseek' | 'openai' | 'qwen' | 'custom'`
- **自定义模型（custom）供应商**：任意 OpenAI 兼容端点（OpenRouter / SiliconFlow / Ollama / Groq 等），自定义优先 + DeepSeek 兜底自动降级（`FallbackAIProvider`）
- **单一配置源 `config/ai-providers.json`**：内置供应商与 custom 的端点 / 模型 / 白名单 / 密钥变量名（`keyEnv`）集中声明；服务端 `ai-proxy.ts` 的 UPSTREAMS、`vite.config.ts` 的 `VITE_CUSTOM_*` / `VITE_FALLBACK_*` 注入均从它派生；密钥值仅写服务端 `.env`，JSON 只存变量名
- **服务端多上游 AI 代理**：`ai-proxy.ts` 支持 deepseek / openai / qwen / custom 四个上游，每个上游注册非流式与 `/stream`（SSE）两条路由（共 8 条）；上游超时 150s、失败重试 2 次（1s/2s）；custom 支持 `CUSTOM_MODELS` 模型白名单
- **前端 AI 运行时切换**：「我的」页面供应商下拉框 + API Key 加密存储（secureStorage）+ 端点/模型覆盖 + 「测试连接」；保存后下一次请求即时生效
- **环境变量恢复**：`.env.example` 补充 `VITE_OPENAI_*` / `VITE_QWEN_*` / `VITE_CUSTOM_*` / `OPENAI_API_KEY` / `QWEN_API_KEY` / `CUSTOM_API_KEY` 等

### Removed

- **Web Chat 自动化（彻底移除）**：删除 `HybridAIProvider`（Web Chat + API 混合调度）、浏览器驱动与相关服务端组件；移除 `puppeteer` 依赖（`package.json` / `package-lock.json`）；删除 `docs/WEBCHAT_AUTOMATION.md` / `docs/WEBCHAT_SELECTORS.md` 两篇专属文档

### Changed

- **供应商选择优先级**：个人中心配置（localStorage，运行时热切换）> `VITE_AI_PROVIDER` 环境变量（构建时默认）> custom 自动检测（端点 + 模型配齐时）> deepseek（最终兜底）
- **文档全面同步**：README / ARCHITECTURE / API_REFERENCE / DEPLOYMENT / TESTING / CONTRIBUTING / docs/README 等文档移除 Web Chat 表述、更新测试规模（前端 57 文件 / 686 用例，后端 11 文件 / 135 用例）与 SQLite 表数量（11 张）

---

## [1.7.0] - 2026-08-30

### 概述

多用户认证 P0 落地：引入账号密码登录、会话管理与严格的按用户数据隔离，SQLite 由 7 张业务表扩展为 11 张（新增 4 张多用户表），全部业务 API（除 `/api/health` 与 `/api/auth/*`）需要登录会话。同日完成 AI 响应缓存持久层迁移（localStorage → Dexie `aiCache`，schema v7）。

### Added

- **认证核心 `server/src/auth.ts`**：账号密码登录（scrypt N=16384 / r=8 / p=1 / keylen=32 慢哈希），不透明 256 位会话令牌存 `sessions` 表（7 天滑动过期，可即时吊销）；连续失败 5 次锁定 15 分钟
- **认证路由 `server/src/authRoutes.ts`**：`/api/auth/*`（login / logout / me / change-password）；修改密码吊销全部会话（全端下线）；登录失败统一文案防用户名枚举
- **4 张多用户表**：`users` / `sessions` / `user_article_states`（阅读状态 readAt/startedAt 按用户独立）/ `schema_meta`（迁移标记）；SQLite 表数量 7 → 11
- **数据隔离**：私有表（生词/复习/统计/阅读会话/成就）在 SQL 层强制 `WHERE userId = 当前用户`，id 存储为 `userId:业务id`（服务端透明映射，前端无感）；文章/题目全站共享
- **业务 API 登录门控**：除 `/api/health` 与 `/api/auth/*` 外，全部业务 API 需要有效登录会话
- **首次多用户迁移 `server/src/migrateMultiUser.ts`**：单用户→多用户数据迁移（既有数据 id 加 userId 前缀 + `schema_meta` 标记），迁移幂等
- **管理员初始化**：`ADMIN_USERNAME`（默认 admin）/ `ADMIN_INITIAL_PASSWORD`（留空自动生成随机密码打印一次）；仅首次迁移（users 表为空）时生效
- **登录端点限流**：5 次/分钟/IP（独立于全局 60/min）
- **前端登录 `src/features/auth/`**：`LoginPage`（全屏登录页，登录后整页跳转清空内存状态）+ `RequireAuth`（路由访问守卫）
- **`authService.ts`**：login / logout / getCurrentUser / changePassword / getToken；令牌存 sessionStorage（关标签即失效）；换号清缓存
- **Dexie v7 `aiCache` 表**：AI 响应缓存持久层从 localStorage（约 5MB 上限）迁移到 IndexedDB `aiCache` 表（Dexie schema v7 新增），容量大幅提升；全部确定性场景统一永久缓存（`ttlMs = Infinity`），淘汰机制从 TTL 过期改为 LRU（按 `updatedAt` 最久未写入优先）
- **永久缓存扩展**：题目生成 / 语法填空 / 词汇提取 / 短语提取纳入永久缓存（以文章内容为 key `sha256(system+user)`，同文章零 token 复用）

### Changed

- **SQLite schema**：`db.ts` 由 7 张业务表扩展为 11 张（+ users / sessions / user_article_states / schema_meta）
- **REST 路由**：`routes.ts` 在通用路由工厂之上叠加用户隔离（私有表强制 `WHERE userId`、id 前缀透明映射）
- **Dexie schema**：版本升至 v7（新增 `aiCache` 表）
- **`.env.example`**：新增 `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD` 说明

### Security

- **全业务 API 认证门控**：未登录（无有效会话令牌）访问业务 API 返回 401
- **会话可吊销**：服务端会话表支持即时吊销（登出 / 修改密码）
- **防暴力破解**：连续失败锁定 + 登录端点独立限流
- **令牌存储**：前端令牌存 sessionStorage（关闭标签页即失效），不落持久存储

---

## [1.6.0] - 2026-07

### Added

- 新增首页历史阅读记录模块：首页「最近阅读」模块按时间倒序展示历史阅读记录，每条记录显示文章标题、相对时间（如「3 小时前」「昨天」）与阅读状态徽章（已读 / 阅读中）；支持分页加载（查看更多）
- 新增相关文章推荐模块：首页「相关推荐」模块基于历史阅读内容的评分算法智能推荐同主题文章，帮助用户拓展阅读；无历史数据时显示空状态引导
- 新增纯英文阅读模式：阅读翻译模式新增「纯英文」选项并设为默认，仅展示英文原文不显示中文翻译，沉浸式训练纯英文阅读能力；同时保留段落对照、按句显示、逐句切换模式
- 新增全文朗读 hook 与控制 UI：文章正文底部提供朗读控制条，支持播放/暂停、停止、语速调节（0.5x-1.5x）与段落进度显示（「朗读中：第 N/M 段」）；纯英文模式下段落顶部喇叭按钮可单独朗读指定段落；朗读时当前段落高亮；依赖浏览器 Web Speech API，不支持时显示提示
- 新增单词发音按钮：生词本每个单词卡片标题右侧有喇叭按钮，点击播放标准发音，支持美式/英式发音源切换
- 新增生词本字母顺序排序：生词本排序选项新增「字母顺序」，支持升序（A→Z）/降序（Z→A）切换
- 新增 AI 词义补全：当生词音标或释义缺失时显示「AI 补全」按钮，点击调用 DeepSeek AI 自动补全音标、词性与释义；补全中显示「补全中...」状态，失败显示「AI 补全失败，请稍后重试」
- 新增用户阅读行为追踪：articles 表新增 `startedAt` 字段（INTEGER，开始阅读时间戳，null/undefined 表示未开始阅读），用于追踪用户阅读开始时间与首页阅读状态徽章展示
- 新增 i18n 文案：zh-CN / en-US 新增 `reading.speech.*`、`dashboard.recent_reading`、`dashboard.recommended`、`dashboard.no_history`、`dashboard.no_recommendation`、`dashboard.load_more`、`wordbook.ai_enrich*` 等 key

### Changed

- 阅读翻译模式默认值从「段落对照」改为「纯英文」
- articles 表 schema 新增 `startedAt` 字段（Dexie + SQLite，通过 ALTER TABLE 兼容旧数据库）
- 文档更新：README 新增功能特性项；USER_GUIDE 新增「首页历史记录与推荐」「全文朗读」「单词发音」「AI 补全」章节与「纯英文模式」说明；API_REFERENCE 新增 `startedAt` 字段说明

---

## [1.5.0] - 2026-07

### Added

- 新增阅读文章指纹去重机制（SHA-256 contentHash + 3 次重试 + 回退历史文章）
- 新增阅读完成存档功能（markAsRead + readAt 时间戳）
- 新增阅读历史查询（getReadHistory，按 readAt 倒序）
- 新增 AI prompt 注入历史主题避免重复（avoidTopics 参数）
- 新增服务端限流（express-rate-limit，60/min/IP，超限 429）
- 新增 CORS 白名单配置（CORS_ORIGIN 环境变量）
- 新增服务端分页支持（?limit=20&offset=0，响应 {items,total,limit,offset}）
- 新增 Repository 索引查询方法（count/getRecent/whereEquals 等 11 个）
- 新增 wordbookService 单元测试（10 用例）
- 新增 useProfileSettings 单元测试（9 用例）
- 新增 aiProxy 集成测试（8 用例）
- 新增 articleDedup 去重测试（6 用例）
- 新增 articlePromptInjection prompt 注入测试（6 用例）
- 新增 pagination 分页测试（12 用例）
- 新增 rateLimit 限流测试（2 用例）
- 新增 cors 白名单测试（3 用例）

### Changed

- articles 表 schema 新增 contentHash 与 readAt 字段（Dexie v4 + SQLite）
- articleService.generateArticle 增加去重逻辑与历史主题注入
- server/src/routes.ts GET 列表端点响应格式从数组改为 {items,total,limit,offset}
- server/src/index.ts CORS 配置支持白名单
- 2 处 TODO 标记转为已知限制注释（wordLookup.ts）

### Security

- 服务端新增 IP 限流（60/min）防止滥用
- CORS 支持白名单收紧（CORS_ORIGIN 环境变量）

---

## [1.4.0] - 2026-07

### 概述

执行 `simplify-stack-local-storage` spec：技术栈精简与服务器本地存储迁移。移除 Supabase 云端依赖与多 AI 供应商支持，改为 Express + better-sqlite3 本地服务器存储，仅保留 DeepSeek 作为唯一 AI 供应商。前端引入 CachedRemoteRepository 模式（服务器为主 + Dexie 离线缓存），适配 Linux 服务器本地部署场景（systemd + Nginx 反代）。本次变更为**破坏性变更**，不向后兼容旧版 Supabase 数据。

### Added

- **Express 服务器子包**：新建 `server/` 独立子包（`server/package.json` 依赖 express、better-sqlite3、cors、tsx、typescript），包含应用入口 `server/src/index.ts`、REST 路由工厂 `server/src/routes.ts`、SQLite 数据库初始化 `server/src/db.ts`、AI 代理端点 `server/src/ai-proxy.ts`、可选初始化脚本 `server/src/seed.ts`
- **本地 SQLite 存储**：better-sqlite3 创建 7 张表（articles / questions / words / reviews / stats / readingSessions / achievements），字段名使用 camelCase 与前端 Dexie 完全一致；启用 WAL 模式提升并发读性能；数据库文件 `server/data/ydxl.db` 运行时自动创建
- **REST API 路由工厂**：`server/src/routes.ts` 的 `createTableRouter(tableName)` 为每张表生成 GET 列表 / GET :id / POST 新增 / PUT :id 更新 / DELETE :id 删除；`TABLES` 白名单常量防止 SQL 注入；POST / PUT 自动填充 `updated_at`
- **JSON 字段序列化**：`server/src/db.ts` 的 `JSON_COLUMNS` 声明 object/array 字段（`lexileRange` / `highlightedWords` / `options` / `achievementTags`），写入时 `JSON.stringify`、读取时 `JSON.parse`，对前端透明
- **`localApi.ts` REST 客户端**：封装 fetch 调用本地服务器 REST API（`baseUrl` 从 `VITE_API_BASE_URL` 读取，默认 `/api`），提供 `get` / `post` / `put` / `del` 通用方法；fetch 失败时 `dispatchEvent(new CustomEvent('ydxl:offline'))` 通知 UI 显示离线提示
- **`RemoteRepository<T>` 类**：基于 localApi 的远程 CRUD（`getAll` / `getById` / `create` / `update` / `delete`），basePath 对应服务器路由名
- **`CachedRemoteRepository<T>` 类**：组合 `RemoteRepository<T>`（REST）与 `Repository<T>`（Dexie）。读取：服务器优先，失败回退 Dexie 缓存；写入：服务器为主，成功后同步更新本地缓存
- **离线提示 UI**：fetch 失败时监听 `ydxl:offline` 事件，toast 提示「网络不可用，仅可查看已缓存数据」
- **Vite 开发代理**：`vite.config.ts` 的 `server.proxy` 将 `/api` 请求转发到 `http://localhost:3001`（本地 Express 服务器）
- **根目录 npm 脚本**：新增 `server:dev`（`npm --prefix server run dev`）与 `server:build`（`npm --prefix server run build`）
- **后端测试**：新增 `server/src/__tests__/db.test.ts`（SQLite 表创建与 CRUD）、`server/src/__tests__/routes.test.ts`（7 张表 REST API 端到端）
- **Linux 部署文档**：新建 `docs/LINUX_DEPLOY.md`，覆盖 Ubuntu 22.04 / Debian 12 逐步操作命令、systemd / PM2 配置示例、Nginx 反代配置、Let's Encrypt SSL、DeepSeek 密钥配置、防火墙端口

### Changed

- **数据存储策略**：从「Dexie 本地优先 + Supabase 云端同步」改为「服务器 SQLite 为主 + Dexie 离线只读缓存」。服务器 SQLite 为唯一权威数据源，Dexie 仅作为离线回退
- **AI 供应商精简**：`AIProviderName` 类型从 `'openai' | 'qwen' | 'deepseek'` 改为 `'deepseek'`；`createAIProvider()` 直接返回 DeepSeekProvider 实例（无 if 分支）；`server/src/ai-proxy.ts` 仅保留 DEEPSEEK_UPSTREAM 分支
- **`AI_PROXY_TOKEN` 改为可选**：本地部署场景可不配置 `AI_PROXY_TOKEN`，未配置时不鉴权（原逻辑未配置时返回 503 拒绝服务）
- **请求体大小上限**：Express `express.json({ limit: '10mb' })`（原 Serverless Function 为 1MB）
- **字段命名一致**：服务器 SQLite 与前端 Dexie 均使用 camelCase 字段名，无需 `fieldMappings` 字段映射转换。仅 `updated_at` 保留 snake_case 以与前端 `BaseEntity` 类型对齐
- **各 feature service 层**：默认使用 `CachedRemoteRepository`（服务器为主）；`Repository`（Dexie）仅作为离线只读缓存
- **7 个 Repository 实例**：`repositories.ts` 中 articleRepository / questionRepository / wordRepository / reviewRepository / statsRepository / readingSessionRepository / achievementRepository 均改为 `CachedRemoteRepository` 组合 `RemoteRepository` + 本地 `Repository`
- **`.env.example`**：移除所有 `VITE_SUPABASE_*` / `VITE_OPENAI_*` / `VITE_QWEN_*` / `OPENAI_API_KEY` / `QWEN_API_KEY` 变量；仅保留 `VITE_DEEPSEEK_API_KEY` / `VITE_DEEPSEEK_MODEL` / `VITE_API_BASE_URL=/api` / `VITE_AI_PROXY_URL`（可选）/ `VITE_AI_PROXY_TOKEN`（可选）/ `DEEPSEEK_API_KEY` / `AI_PROXY_TOKEN`（可选）/ `PORT=3001`
- **`vite.config.ts`**：清理 `@supabase/supabase-js` 相关注释
- **`vercel.json`**：保留 `/api/v1/ai-proxy/:provider` rewrite 兼容性，但主要部署方式改为服务器本地
- **文档全面更新**：README / DEPLOYMENT / OPERATIONS / API_REFERENCE / TECHNICAL_ANALYSIS / ARCHITECTURE / ER_DIAGRAM / AI_PROVIDERS / CONTRIBUTING 全部更新为反映新技术栈

### Removed

- **Supabase 依赖**：从根目录 `package.json` 移除 `@supabase/supabase-js` 依赖
- **Supabase 相关文件**：删除 `src/shared/services/supabase.ts`、`src/shared/services/supabase-schema.sql`
- **SyncService**：删除 `src/shared/services/sync.ts`、`src/shared/services/registerSyncAdapters.ts`、`src/shared/hooks/useSync.ts`、`src/features/profile/components/SyncStatus.tsx`
- **字段映射**：删除 `fieldMappings` / `toRemoteRecord` / `toLocalRecord` / `remoteTableNames`（两端字段命名一致，无需转换）
- **OpenAI Provider**：删除 `src/shared/services/ai/openai-provider.ts`
- **Qwen Provider**：删除 `src/shared/services/ai/qwen-provider.ts`
- **auth 模块**：删除 `src/features/auth/` 整个目录（authService / store / types）。本地 / 局域网部署，不启用用户认证
- **ProfilePage 供应商切换 UI**：移除 AI 服务商下拉框（固定为 deepseek）
- **双模式鉴权**：移除「未配置 AI_PROXY_TOKEN 返回 503」逻辑，改为可选鉴权
- **SyncService 测试**：删除 `sync-field-mapping.test.ts`、`sync-performance.test.ts`
- **`netlify.toml`**：删除（不再支持 Netlify 部署）
- **`VITE_AI_PROVIDER` 环境变量**：移除（固定为 deepseek，无需选择）

### Security

- **密钥隔离**：`DEEPSEEK_API_KEY` 仅存在于服务端（不打包进前端 bundle）；前端通过 `VITE_AI_PROXY_URL` 走代理模式时，apiKey 字段承载代理令牌而非上游密钥
- **本地部署无认证**：本地 / 局域网部署场景不启用用户认证，适合家庭 / 内网使用；公网部署建议配置 `AI_PROXY_TOKEN` 启用代理鉴权

---

## [1.3.0] - 2026-07

### 概述

执行 `execute-quality-roadmap` spec：四阶段 22 个任务的技术债务清理与健壮性增强。涵盖 P0 阻断修复、P1 安全稳定性、P2 健壮性增强、轻微技术债务清理，为生产环境上线做准备。

### Added

- **BaseAIProvider 抽象基类**：抽取 OpenAI / Qwen / DeepSeek 三家 Provider 的公共逻辑（端点解析、callChat 通用流程、withAIError 异常包装、9 个 AIProvider 接口方法实现），子类仅实现 5 个差异化抽象方法
- **fetch 超时与重试**：前端 30s `AbortController` 超时控制 + `retryWithBackoff(fn, maxRetries=2)` 指数退避重试（1s/2s），后端 8s 超时返回 504，仅对网络错误 / 超时 / 5xx 重试，4xx 立即抛错
- **SyncService 性能优化**：Dexie v3 schema 为 words/reviews/questions 添加 `updated_at` 索引；`getSince` 使用 `where('updated_at').above(timestamp)` 索引查询；`upsert` 分批 50 条处理并让出主线程；`syncAll` 使用 `Promise.allSettled` 并行同步 7 张表；`syncTable` 使用服务端时间戳 `maxRemoteUpdatedAt` 避免时钟漂移；首次同步保护避免回推全部本地数据
- **ErrorBoundary**：全局 `<ErrorBoundary>` 包裹最外层，每个路由级 `<Suspense>` 内层包裹局部 `<ErrorBoundary>`，子组件抛错显示恢复 UI（含"刷新页面"与"返回首页"按钮）
- **vitest 测试框架**：引入 vitest + @testing-library/react + @testing-library/jest-dom + jsdom，配置 `vitest.config.ts`（`environment: 'jsdom'`、`globals: true`、`setupFiles`、`@` 路径别名、`import.meta.env` 注入为 `{}`），迁移 8 个原有手写测试为 vitest 风格
- **fetch mock 工具**：在 `src/test/setup.ts` 提供 `installFetchMock` / `installFetchMockSequence` / `restoreFetch` / `installImmediateSetTimeout` 工具，每个测试 `afterEach` 自动恢复
- **i18n 抽象层**：`useTranslation` hook 基于 localStorage 语言选择 + JSON 字典查找；`zh-CN.json` 含约 100 条核心 UI 文案；`en-US.json` 占位；ProfilePage 设置项新增"语言"切换下拉框
- **API 版本化**：`vercel.json` rewrite 改为 `/api/v1/ai-proxy/:provider` → `/api/ai-proxy`；三个 Provider 的 `resolveEndpoint` 拼接 `/v1/ai-proxy/<provider>` 路径前缀；向后兼容 `VITE_AI_PROXY_URL=/api` 默认值
- **错误码结构化**：`api/ai-proxy.ts` 错误响应统一为 `{ error: { code, message } }` 格式，错误码枚举 `UNAUTHORIZED` / `INVALID_BODY` / `UNSUPPORTED_PROVIDER` / `UPSTREAM_ERROR` / `PROXY_NOT_CONFIGURED` / `TIMEOUT` / `PAYLOAD_TOO_LARGE`；HTTP 405 增加 `Allow: POST, OPTIONS` 头；上游响应透传原始 `Content-Type`
- **PWA 图标**：新增 `public/pwa-192.png`、`public/pwa-512.png`、`public/pwa-maskable-512.png` 三套图标，`vite.config.ts` 的 `manifest.icons` 配置三套图标
- **统一 cn 工具**：`src/shared/utils/cn.ts` 导出 `cn` 函数（`twMerge + clsx`），删除 wordbook / review 两个 `cn.ts` 副本，17 个引用文件统一改为 `from '@/shared/utils/cn'`
- **图标集中定义**：`src/shared/components/icons.tsx` 集中 `FlameIcon` / `BookIcon` / `BadgeIcon` / `ClockIcon` / `WordIcon` / `TargetIcon` / `SpeakerIcon` / `BellIcon` / `ChipIcon` 等图标
- **estimateSyllables 抽取**：`src/features/review/utils/phonetics.ts` 导出 `estimateSyllables` 函数
- **engines 字段**：`package.json` 添加 `"engines": { "node": ">=18", "npm": ">=9" }`；scripts 新增 `typecheck` 与 `serve`
- **测试用例**：新增 `ai-proxy-contract.test.ts`（前后端契约）、`sync-field-mapping.test.ts`（7 张表字段映射）、`sync-performance.test.ts`（1000 条记录不阻塞主线程）、`ErrorBoundary.test.tsx`（子组件异常捕获）、`articleService.integration.test.ts`（端到端流程含 fallback 降级）、ai-provider 重试策略测试（超时 / 5xx 重试 / 4xx 不重试）。共 9 个测试文件 111 个测试用例
- **文档补全**：新增 `docs/ARCHITECTURE.md`、`docs/ER_DIAGRAM.md`、`docs/TESTING.md`、`CONTRIBUTING.md`、`CHANGELOG.md`；README 新增"测试"与"故障排查"章节

### Changed

- **Supabase Schema 补齐**：`supabase-schema.sql` 新增 `reading_sessions` 与 `achievements` 表 CREATE TABLE（含 `(user_id, updated_at)` 复合索引与 RLS policy），表数量从 5 张扩展到 7 张
- **SyncService 字段映射**：新建 `fieldMappings: Record<TableName, { local: string; remote: string }[]>` 覆盖 7 张表的 camelCase ↔ snake_case 转换；实现 `toRemoteRecord` 与 `toLocalRecord` 转换函数；`pullChanges` / `pushChanges` 在 upsert 前调用转换；对齐 5 张现有表的字段集合（移除 `source/answer/quality` 冗余字段，补充 `translation/genre/topic/lexileRange/highlightedWords/correctIndex/locationClue/root/lastReview/interval/easeFactor/sourceArticleId/stubbornCount/achievementTags/stabilityScore/step/correct/correctRate/wordsReviewed` 等缺失字段）
- **registerSyncAdapters**：注册全部 7 张表的 Dexie 适配器（含之前缺失的 questions 表）
- **AI 代理契约统一**：`api/ai-proxy.ts` 从 URL 路径末段解析 provider（兼容 body 中 provider 字段）；OPTIONS 预检返回 204 + CORS 头；provider 大小写归一化（`toLowerCase().trim()`）；`readBody` 累计 size 超过 1MB 返回 413；三个 Provider 的 `callChat` 使用 `{ provider, body }` 信封格式包装请求体
- **AI_PROXY_TOKEN 严格校验**：未配置 `AI_PROXY_TOKEN` 时返回 503 `PROXY_NOT_CONFIGURED`，拒绝转发避免开放代理被滥用；token 比较使用严格相等 `!==`
- **ProfilePage 防抖**：`handleApiKeyBlur` 改为 onChange 防抖 500ms 持久化
- **SyncStatus 跨标签同步**：`SyncStatus.tsx` 改用 `window.addEventListener('storage', ...)` 监听替代 `setInterval` 轮询
- **字段校验**：`BaseAIProvider.generateArticle` 补全 `genre/wordCount/topic/difficulty/lexileRange/highlightedWords` 9 字段校验，缺失任一抛 `AIError('文章生成结果缺少必要字段: <字段名>')`
- **三 Provider 错误处理**：非 2xx 响应先尝试 `res.json()` 提取 `error.message`，失败回退 `res.text()`
- **大文件拆分**：`ArticleView.tsx`（707 行）拆分为 `ArticleParagraphMode` / `ArticleSentenceMode` / `WordPopover` / `BatchActionBar` + `useWordLookup` hook；`ReviewPage.tsx`（598 行）拆分为 `ReviewListView` / `ReviewSessionView` / `ReviewCompleteView`；`ProfilePage.tsx` 抽取 `useProfileSettings` 与 `useAIConnectionTest` hook；`ReadingPage.tsx` 抽取 `useReadingTimer` / `useReadingProgress` / `useSessionRecorder` hook；`DashboardPage.tsx` 内联 `StatCard` 重命名为 `DashboardStatCard`
- **图标统一**：`DashboardPage.tsx` / `ProfilePage.tsx` / `StatsPage.tsx` 删除内联 SVG 定义，改为从 `@/shared/components/icons` 导入
- **SyncService 数值校验**：`getLastSyncAt` 校验 `Number.isFinite(n)` 防止 NaN / Infinity
- **vite.config.ts**：注释与 `sourcemap: false` 实际配置对齐

### Fixed

- **AI 代理前后端契约不一致**：原前端 `body.provider` 与后端 URL 路径解析方式不匹配，统一为路径解析 + body 兼容回退
- **`reading_sessions` 与 `achievements` 表缺失**：原 schema 仅 5 张表，补齐 2 张新表
- **SyncService 字段命名错误**：原 `pullChanges` / `pushChanges` 未转换 camelCase ↔ snake_case 字段名，导致云端字段丢失
- **AI_PROXY_TOKEN 默认开放代理**：原未配置 token 时拒绝逻辑缺失，可被任意客户端利用消耗上游配额
- **`.gitignore` 缺失 `.env`**：原配置可能将含密钥的 `.env` 文件提交到仓库
- **crypto.ts 加密代码冗余**：原 `encrypt/decrypt` 等函数从未被实际使用，且 `crypto-js` 依赖增加 bundle 体积
- **PWA 图标缺失**：原 `manifest.icons` 配置指向不存在的图标文件
- **生产构建白屏**：未捕获的子组件异常导致整页白屏
- **环境变量文档不全**：原 README 缺失 `VITE_AI_PROXY_TOKEN` / `DEEPSEEK_API_KEY` 等说明
- **三 Provider 重复代码**：`callChat` / `withAIError` / 鉴权头设置代码重复
- **cn 工具三处副本**：wordbook / review / shared 各有一份 `cn.ts` 实现
- **fetch 超时无限等待**：原无超时控制，网络异常时永久挂起
- **同步性能瓶颈**：原 `for...of` 串行同步 7 张表，本地全表扫描，单表失败中断后续同步
- **首次同步回推全部本地数据**：原 `syncTable` push 阈值错误，首次同步会推送全部本地记录到云端

### Removed

- **crypto.ts**：删除 `src/shared/utils/crypto.ts` 全部内容与 `src/shared/services/index.ts` 中的 `encrypt/decrypt/encryptField/decryptField/encryptSensitiveFields/decryptSensitiveFields` 导出
- **crypto-js 依赖**：从 `package.json` 移除 `crypto-js` 依赖与 `@types/crypto-js` devDependency
- **cn.ts 副本**：删除 `src/features/wordbook/utils/cn.ts` 与 `src/features/review/utils/cn.ts`
- **VITE_AES_KEY 残留**：从 `.env.example` 清理
- **README 数据加密宣传**：删除"数据加密"特性说明
- **ProxyRequestBody.endpoint**：删除未使用的 `endpoint?` 字段

### Security

- **AI_PROXY_TOKEN 严格校验**：服务端未配置 token 时返回 503 拒绝转发，避免开放代理
- **`.gitignore` 补全**：忽略 `.env` / `.env.*`，防止密钥泄露
- **生产环境密钥隔离**：明确 `VITE_` 前缀变量会进入 bundle，生产环境必须走代理模式

---

## [1.2.0] - 2026-07

### 概述

执行 `add-deepseek-provider` spec：添加 DeepSeek AI 供应商支持。

### Added

- **DeepSeekProvider 实现**：继承 `BaseAIProvider`（v1.3.0 重构），实现 5 个抽象方法，调用 DeepSeek API（OpenAI 兼容协议，端点 `https://api.deepseek.com/chat/completions`）
- **9 个 AIProvider 方法**：DeepSeek 支持 `generateArticle` / `generateQuestions` / `generateTranslation` / `extractVocabulary` / `generateWordHint` / `generateWordBreakdown` / `generateMnemonic` / `generateExampleSentence` / `generateEmojiHint`
- **ProfilePage 设置 UI**：环境变量 `VITE_AI_PROVIDER=deepseek` 切换供应商；支持 `VITE_DEEPSEEK_API_KEY`（直连）与 `DEEPSEEK_API_KEY`（代理）两种密钥配置
- **模型切换**：默认 `deepseek-chat`，可改为 `deepseek-reasoner` 调用推理模型
- **测试用例**：新增 9 个 DeepSeekProvider 测试用例，覆盖 9 个公开方法
- **`AIProviderName` 类型**：`type AIProviderName = 'openai' | 'qwen' | 'deepseek'`，三处（ai/index.ts、ProfilePage.tsx、api/ai-proxy.ts）使用统一类型
- **`api/ai-proxy.ts` 分支**：新增 DeepSeek 上游端点 `https://api.deepseek.com/chat/completions` 与 `DEEPSEEK_API_KEY` 服务端密钥读取

### Changed

- **README 更新**：AI Provider 切换说明从"两种"改为"三种"，切换示例新增 `VITE_AI_PROVIDER=deepseek`；"OpenAI/Qwen 实现"改为"OpenAI/Qwen/DeepSeek 实现"
- **环境变量表格**：补充 `VITE_DEEPSEEK_API_KEY` / `VITE_DEEPSEEK_MODEL` / `DEEPSEEK_API_KEY` 行
- **Vercel 部署步骤**：服务端密钥列表补充 `DEEPSEEK_API_KEY` 与三家模型名变量

---

## [1.1.0] - 2026-07

### 概述

执行 `enhance-learning-experience` spec：增强学习体验，覆盖上下文与难度控制、分析增强、AI 助记、五步词汇记忆游戏化、错题本、学习提醒、离线可用等。

### Added

- **上下文与难度控制**：`ArticleGenerationResult` 新增 `topic` / `difficulty` / `lexileRange` / `highlightedWords` 字段；`articlePrompt` 强制指定题材、难度、蓝思值范围；`articleService.getDailyArticle` 支持 topic 与 difficulty 参数
- **分析增强**：`ReadingPage` 顶部显示题材标签、词数、预计阅读时间；正文中 `highlightedWords` 以浅黄色背景高亮渲染；点击高亮词弹出气泡（音标、释义、例句、加入生词本按钮）
- **AI 助记**：`AIProvider` 接口新增 `generateMnemonic`（趣味助记口诀）、`generateExampleSentence`（真题例句）、`generateEmojiHint`（emoji 助记）三个方法；`OpenAIProvider` 与 `QwenProvider` 实现新增方法
- **五步词汇记忆游戏化**：
  - **LearnStep** 词根词缀拆解动画（逐字浮现）+ 调用 `generateMnemonic` 展示趣味助记口诀 + 调用 `generateEmojiHint` 展示 emoji 助记
  - **ReadStep** 慢速/常速切换（rate 0.5/1.0）+ 基于音节数 SVG 波形动画 + Web Speech API 发音评分（星级反馈）
  - **PracticeStep** 听音选义 / 看义选音 / 填空 / 近义词反义词配对四类题型 + 错题自动加入"待强化"池（`stubbornCount += 1`）
  - **SpellStep** 提示分级（首尾字母 → 部分元音 → 键盘高亮）+ 移动端键盘高亮 + 拼错抖动动画 + 正确拼写闪现后清空
  - **WriteStep** 例句填空模式 + "你写的"vs"正确答案"对比视图 + 错误字母红色 / 正确字母绿色标注
- **SM-2 加权算法**：`sm2.ts` 接受三环节加权输入（炼 0.3 / 拼 0.3 / 写 0.4）；ease factor 计算结合加权正确率；返回 `stabilityScore`（稳固度 0-100）；`reviewService.applyReviewResult` 传递三环节结果
- **记忆稳固度可视化**：`WordCard` 新增稳固度进度条；显示"预计下次复习：明天/3天后/N 天后"相对时间文案；`reviewRepository` 支持按稳固度排序
- **每日复习上限**：设置中新增"每日复习上限"配置项（默认 50）；`getTodayReviewQueue` 限制返回数量；达到上限时提示"今日复习已完成"；逾期单词以红点标识
- **成就徽章系统**：成就规则定义（阅读之星 / 全对王者 / 连续打卡 7/30/100 天等）；`achievementService.checkAndUnlockAchievements` 实现；阅读 / 复习完成后触发检查；解锁时弹出徽章展示动画
- **庆祝动画**：`Celebration` 组件实现撒花 / 星星动画；五步流程全部通过后触发；附正向反馈文案
- **错题本与顽固词**：`reviewService.getStubbornWords`（`stubbornCount >= 3`）；复习队列中顽固词优先级提升；`WordCard` 显示"顽固词"徽章
- **首页仪表盘重构**：`DashboardPage` 仪表盘式布局；顶部连续打卡天数 + 今日待完成（阅读 N + 复习 M 词）；中部快捷卡片（开始今日阅读 / 复习单词）；底部本周正确率曲线 + 掌握单词数
- **单词复习页重构**：`ReviewPage` 待复习列表 + 五步流程集成视图；待复习列表按紧急度排序（逾期优先）；顶部进度条（1/5）+ 提示按钮；完成五步后弹窗评价；返回列表自动刷新
- **生词本卡片化与长按操作**：`WordbookPage` 卡片化布局；长按词卡弹出操作菜单（删除 / 立即复习）；卡片显示稳固度进度条与下次复习时间
- **"我的"页面**：新增 `features/profile` 模块；学习统计区（总阅读篇数 / 总学习词数 / 累计时长）；成就墙（已解锁徽章展示）；设置项（每日目标 / 发音源 / 提醒时间 / AI 模型配置 API Key）；数据同步状态展示；路由新增 `/profile`
- **底部导航重构**：`Layout` 顶部导航改为底部 Tab（首页 | 阅读 | 单词本 | 我的）；移动端优先设计；当前激活 Tab 高亮
- **学习提醒**：`notification.ts` 封装 Notification API；"我的"设置页配置每日提醒时间；前台时到点触发通知；未授权时提示开启浏览器通知
- **离线可用**：兜底素材库按题材分类（每类 ≥ 2 篇），附 `highlightedWords` 字段；AI 不可用时降级
- **阅读会话记录**：`statsService.recordReadingSession` 记录每次阅读（用时 / 字数 / 正确率）；`ReadingPage` 提交答题后调用记录
- **统计页新增图表**：统计页新增"阅读能力增长曲线"图表
- **答题反馈可视化**：原文依据（`locationClue`）以下划线标注呈现；每个错误选项附"为何错"解释；正确选项附"为何对"解释；支持点击题目跳转回原文对应位置
- **翻译增强**：翻译区支持点击单句切换原文 / 译文；保留段落对照模式与逐句显示模式；切换状态本地持久化
- **智能词汇表增强**：`vocabularyService` 调用 `generateExampleSentence` 与 `generateEmojiHint`；`VocabularyList` 展示新增字段
- **划词批量收藏**：划词浮层支持长按或拖选多词；显示"批量加入生词本（N 个词）"按钮；批量写入并显示成功 toast
- **新数据表**：`reading_sessions`（阅读会话）与 `achievements`（成就）两张表
- **新类型字段**：`Article` 新增 `topic/difficulty/lexileRange/highlightedWords`；`Word` 新增 `stubbornCount/achievementTags`

### Changed

- **Article 类型扩展**：新增 `topic/difficulty/lexileRange/highlightedWords` 字段
- **Word 类型扩展**：新增 `stubbornCount/achievementTags` 字段
- **articlePrompt 模板**：强制指定题材、难度、蓝思值范围，返回 `highlightedWords`

### Fixed

- **SM-2 算法精度**：原算法仅基于单一环节正确率，加权算法结合三环节提升预测准确度
- **错题无追踪**：原错题不会标记为顽固词，复习队列无法识别需强化的单词

---

## [1.0.0] - 2026-07

### 概述

初始版本，执行 `english-learning-app` spec：实现基础功能完成（每日阅读、答题、查词、复习、统计、PWA、Supabase 同步）。

### Added

- **每日阅读**：基于 AI 生成不同文体（新闻 / 故事 / 科普等）的英文文章，提供阅读理解题目、单词释义、整段翻译切换与发音朗读
- **生词本**：从阅读材料中一键收藏生词，自动查询释义 / 音标 / 词性；支持批量操作、笔记编辑、掌握度进度条与按状态筛选
- **五步背诵基础**：基于 SM2 间隔重复算法（学习 → 阅读 → 听写 → 拼写 → 写作）
- **学习统计**：基于 Recharts 提供阅读量、生词量、掌握度、连续打卡天数等 KPI 卡片与柱状图
- **多端同步**：通过 Supabase 提供用户认证与云端数据同步，基于 `updated_at` 时间戳实现增量同步与 Last-Write-Wins 冲突解决
- **PWA 离线访问**：通过 Service Worker 预缓存核心资源，断网情况下仍可查看已加载内容
- **夜间模式**：基于 Tailwind `darkMode: 'class'` 实现，可一键切换日 / 夜主题
- **本地存储**：学习数据明文存储于浏览器本地 IndexedDB（通过 Dexie.js 封装），无需服务端即可离线使用
- **AI Provider 抽象**：`AIProvider` 接口与 `OpenAIProvider` / `QwenProvider` 两个实现
- **Serverless AI 代理**：`api/ai-proxy.ts` 隐藏上游 API Key，前端通过 `x-user-token` 鉴权
- **数据表**：5 张表（articles / questions / words / reviews / stats）
- **SyncService**：增量同步服务，本地 Dexie ↔ 远端 Supabase
- **路由级懒加载**：React.lazy + Suspense
- **代码规范**：ESLint + Prettier + Husky + lint-staged 工作流
