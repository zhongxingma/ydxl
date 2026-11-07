# 项目上下文交接板

> 本文件由 context-archive Skill 在会话收尾时更新。新会话开始时优先阅读本文件。

## 项目当前状态

ydxl 仓库已由 private 转为 public（2026-11-07）以启用 Code scanning，Security 流水线自 #25 起连续全绿；`js/clear-text-logging`（error 级）已修复并关闭，open 告警 9 → 8 条，全部为 warning。

## 已完成并验证

- Code scanning 启用｜交付：仓库可见性 `private → public`；Security #25（f4d9b1e）/ #26（c0a62b3）均 success，CodeQL 分析记录已上传｜验证：`GET /code-scanning/analyses` 返回 2 条记录，`results_count` 9
- 管理员初始密码落盘｜交付：`server/src/migrateMultiUser.ts` 新增 `writeInitialPasswordFile()`（0600），控制台仅打印路径；同步 `.env.example`、DATABASE、API_REFERENCE、MULTI_USER_DESIGN、CHANGELOG｜验证：`npm --prefix server test` 24 文件 / 247 用例通过；`npm run typecheck` 无输出；`npm run docs:verify` 8/8；`npm run lint` 0 error
- 迁移日志去除 env 派生值｜交付：同上文件，日志不再输出 `ADMIN_USERNAME` 派生值｜验证：`npm --prefix server test` 24/247 通过、`npm run typecheck` 通过；commit 914b346
- `js/clear-text-logging` 告警关闭｜交付：Security #27（914b346）success｜验证：`GET /code-scanning/alerts?state=open` 由 9 条降为 8 条，该 rule 不再出现；`?state=closed` 返回 0 条（GitHub 以重扫未复现关闭）
- CI 链路修复验证｜交付：ci.yml e2e job 补装后端依赖（f4d9b1e）｜验证：Actions run 42376629780（CI #71）与 42380911122（CI #72）均 completed/success
- 开发痕迹清理（两轮）｜交付：65 文件 95 行 + Phase 代号清理（59 行注释、16 处标题/字符串、8 标识符、2 测试文件重命名）；报告 `docs/CLEANUP_CHANGE_REPORT.md`｜验证：Grep `Phase|PHASE|verify-deepseek|[LMSPR]\d` 注释零残留；`npm test` 203/1764、`npm --prefix server test` 24/247
- 版本管理初始化 v1.9.0｜交付：CHANGELOG `[1.9.0] - 2026-11-03`、`package.json`×2 对齐、annotated tag v1.9.0（823686f）｜验证：`git describe --tags` = v1.9.0
- 项目目录清理（约 400MB）｜交付：删 dist / coverage / test-results / `.e2e-tmp` / `.screenshots` / node_modules×2（验证后重装）｜验证：typecheck、lint、build、bundle:check、docs:verify 8/8、启动探活 `/api/health` ok
- 推送与远端清理｜交付：删 20 个 dependabot 分支，push main 与 tag｜验证：`git ls-remote --heads --tags origin` 仅含 main 与 v1.9.0
- （历史压缩）第八至二十批补测、i18n 双语迁移、图表按需加载、容器化与蓝绿发布、健康检查、CI 自动部署骨架、Sentry 可选集成、协作治理件、性能护栏｜验证：CI 全绿；CHANGELOG `[1.9.0]` 记载（203/1764 + 24/247）

## 进行中

- 剩余 8 条 CodeQL warning｜进度：清单已获取（`js/file-system-race` 1、`js/loop-bound-injection` 1、`js/incomplete-url-substring-sanitization` 2、`js/missing-rate-limiting` 4 均为 `server/src/__tests__` 内测试桩）｜下一步：定夺修复或为测试目录配置查询过滤｜阻塞：需用户决定
- 关闭远端失效 PR #1–#20｜进度：20 个 dependabot 分支已删，`refs/pull/1-20/head` 存留｜下一步：用户在 GitHub 网页逐个 Close pull request｜阻塞：用户手工操作
- 自动部署激活与运行核对｜进度：deploy-gate 骨架已合入 ci.yml｜下一步：配置 `DEPLOY_SSH_KEY` / `DEPLOY_HOST` / `DEPLOY_USER` 后核对首跑｜阻塞：需用户凭据

## 关键决策索引

> 完整决策理由见 DECISIONS.md。

- [2026-10-26] 覆盖率阈值取实测基线下方约 4 个百分点 → DECISIONS.md#d-2026-10-26-1
- [2026-10-26] 每批约 5 文件 / 30-60 用例，独立验证提交 → DECISIONS.md#d-2026-10-26-2
- [2026-10-26] 测试文件按职责拆分且单文件 ≤400 行 → DECISIONS.md#d-2026-10-26-3
- [2026-10-26] secureStorage 错误路径用伪 IDB + `vi.resetModules` → DECISIONS.md#d-2026-10-26-4
- [2026-10-26] 页面接线测试用子组件替身 + 路由探针 → DECISIONS.md#d-2026-10-26-5
- [2026-11-03] 大规模注释清理用机械式定向脚本 + dry-run 全审 → DECISIONS.md#d-2026-11-03-1
- [2026-11-03] Phase 代号清理用语义映射保通顺 → DECISIONS.md#d-2026-11-03-2
- [2026-11-03] 版本策略 v1.9.0 承接 CHANGELOG 谱系 → DECISIONS.md#d-2026-11-03-3
- [2026-11-03] 远端清理限于 dependabot 分支，不重写历史 → DECISIONS.md#d-2026-11-03-4
- [2026-11-07] 私有仓库转 public 以启用 Code scanning → DECISIONS.md#d-2026-11-07-1
- [2026-11-07] 管理员初始密码改为写入 0600 受限文件 → DECISIONS.md#d-2026-11-07-2
- [2026-11-07] 日志不输出 `process.env` 派生值 → DECISIONS.md#d-2026-11-07-3

## 已知问题与风险

- practiceQuestionGenerator 剩余未覆盖行为防御性兜底分支，公共 API 基本不可达｜状态：已规避｜依据：coverage/lcov.info 未覆盖行清单
- secureStorage 告警仅在 DEV 分支执行｜状态：已规避｜依据：src/shared/services/secureStorage.ts 第 76-91 行
- github.com 直连 DNS 不稳定（`Could not resolve host`），push 需 DoH 解析后 `-c http.curloptResolve=github.com:443:<IP>`｜状态：已规避｜依据：2026-11-07 两次 push 均以该方式成功
- CodeQL `security-extended` 对 `process.env` 一律视为敏感源，且 `server/src/__tests__` 内测试桩触发 `js/missing-rate-limiting`｜状态：待解决｜依据：open 告警清单（4 条位于测试目录）
- 远端 PR #1–#20 为已删分支的失效引用，git 无法删除｜状态：待解决｜依据：`git ls-remote` refs/pull/1-20/head

## 下一步计划

- 取得 Security #27 / CI #73 结论，确认 `js/clear-text-logging` 告警关闭
- 定夺剩余 8 条 warning 的处理方式（修复或配置查询过滤）
- 用户在 GitHub 网页关闭 PR #1–#20；配置部署 Secrets 后核对自动部署首跑

## 新会话优先阅读的文件

- server/src/migrateMultiUser.ts｜首管理员创建、初始密码落盘、迁移事务｜先
- .github/workflows/security.yml｜CodeQL 扫描配置与权限｜先
- DECISIONS.md｜历史决策 + 2026-11-07 启用/凭据/日志决策｜先
- docs/DEPLOYMENT.md｜自动部署 Secrets 清单与蓝绿切流流程｜后
- docs/CLEANUP_CHANGE_REPORT.md｜两轮清理变更清单与事故教训｜后
