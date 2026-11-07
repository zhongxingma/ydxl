# 决策日志

> 本文件只追加，不删除、不重写历史条目。每条决策以日期开头，按时间线排列。
> 当新决策与历史决策在影响面上重叠且结论相反时，追加冲突标注，等待人工裁决，不得自行覆盖。

<!-- 格式示例：
- [2026-10-26]｜决策：xxx｜理由：xxx｜放弃的备选：xxx｜影响面：src/auth/
-->

<a id="d-2026-10-26-1"></a>
- [2026-10-26]｜决策：覆盖率防回退阈值始终取实测基线下方约 4 个百分点（当前 91 / 81 / 91 / 93）｜理由：拦截明显回退，同时为跨平台 V8 统计差异留余量，避免 CI 误报｜放弃的备选：阈值等于实测基线（跨平台波动易阻断 CI）｜影响面：vitest.config.ts、docs/TESTING.md、.github/workflows/ci.yml

<a id="d-2026-10-26-2"></a>
- [2026-10-26]｜决策：每批补测约 5 个测试文件 / 30-60 个用例，独立执行 typecheck、lint、全量覆盖率、构建后单独提交推送｜理由：控制单批风险与回滚粒度，CI 失败可快速定位到单批｜放弃的备选：一次性大批量补测（失败定位与回滚成本高）｜影响面：src/**/__tests__、.github/workflows/ci.yml

<a id="d-2026-10-26-3"></a>
- [2026-10-26]｜决策：测试文件按职责拆分且单文件 ≤400 行，非测试源文件 ≤500 行｜理由：可读性与维护性，符合既有治理约定｜放弃的备选：单文件堆叠全部用例（超长难维护）｜影响面：src/**/__tests__/**

<a id="d-2026-10-26-4"></a>
- [2026-10-26]｜决策：secureStorage 密钥加载错误路径测试采用 `vi.stubGlobal` 注入伪 IndexedDB 请求 + `vi.resetModules` 动态 import｜理由：模块级密钥缓存需重置，伪请求可在微任务中精确触发 onsuccess/onerror、importKey 与 generateKey 失败分支｜放弃的备选：依赖 fake-indexeddb 真实失败（无法稳定构造密钥 API 失败）｜影响面：src/shared/services/__tests__/secureStorage.errors.test.ts

<a id="d-2026-10-26-5"></a>
- [2026-10-26]｜决策：页面级回调接线测试用子组件替身 + MemoryRouter Routes 探针｜理由：隔离 Modal / 图表依赖，直接断言路由跳转与 onClose 副作用｜放弃的备选：渲染真实子组件（依赖多、断言间接）｜影响面：src/pages/__tests__/DashboardPage.navigation.test.tsx、src/features/review/pages/__tests__/ReviewPage.test.tsx

<a id="d-2026-11-03-1"></a>
- [2026-11-03]｜决策：大规模注释清理采用机械式定向脚本（只匹配整行注释固定模式 + dry-run 全量人工审查 + 落盘后 diff 审计与全量门禁验证）｜理由：此前 3 个并行子代理清理曾误伤 148 文件（类型/测试/文档锚点破坏），机械式 + 逐步验证可守住「不动代码」红线｜放弃的备选：并行子代理逐文件清理（精细控制不足）、只清最明确痕迹（范围过窄）｜影响面：src/ 与 server/src/ 共 65 文件注释、scripts/i18n-baseline.json

<a id="d-2026-11-03-2"></a>
- [2026-11-03]｜决策：Phase 1/2/3 代号清理采用语义映射保语句通顺（代码 `Phase 1`→基线/优化前、`Phase 2/3`→优化后；文档→第一轮/第二轮/第三轮），严格匹配「Phase+空格+数字」防文件名/标识符误伤｜理由：直接删除产生病句（如「基线代表「未应用优化」」需整体改写）与 `deepseekPhase2` 文件名误改｜放弃的备选：机械整体删除（dry-run 已证明破坏语义与路径）｜影响面：18 文件注释、4 测试文件标题/字符串、8 个标识符、2 测试文件重命名（ai-provider-finetune.test.ts / deepseekOptimization.verification.test.ts）、docs/AI_TOKEN_OPTIMIZATION.md 等 5 文档

<a id="d-2026-11-03-3"></a>
- [2026-11-03]｜决策：版本策略取 v1.9.0 承接既有 CHANGELOG 谱系（v1.0.0–v1.8.0 记录保留），v1.9.0 为版本库首个正式标签，[Unreleased] 全部内容收拢为 [1.9.0]｜理由：CHANGELOG 已有 2026-07 的 v1.0.0 历史条目，字面首发 v1.0.0 会让同一版本号指代两个状态｜放弃的备选：重写谱系为 v1.0.0 首发（破坏既有记录语义）、为历史版本补打近似 tag（无法精确对应 commit）｜影响面：CHANGELOG.md、package.json、server/package.json、git tag v1.9.0

<a id="d-2026-11-03-4"></a>
- [2026-11-03]｜决策：远端清理限于删除 20 个 dependabot 分支，不重写提交历史；失效 PR（#1–#20）由用户网页关闭｜理由：用户选定「推送 + 清理远端分支/发行版」，历史重写为另一选项未被选择；refs/pull/* 为 GitHub 服务端数据 git 无法删除｜放弃的备选：仅推送不清理、force push 重写远端历史｜影响面：origin 分支列表（20 个 dependabot 分支）

<a id="d-2026-11-07-1"></a>
- [2026-11-07]｜决策：将仓库 `zhongxingma/ydxl` 从 private 转为 public，以启用 Code scanning（workflow 式 advanced setup），而非升级套餐或长期跳过 | 理由：私有仓库使用 Code scanning 需 GitHub Pro/Team 或 GHAS，Free 套餐下 `code-scanning/default-setup` 恒为 `not-configured`，连续 5 轮 codeql job 均在同一处报 `Code scanning is not enabled`；转 public 后同一条 workflow 一次通过（Security #25/#26 全绿），依赖审查亦随之可用 | 放弃的备选：升级 GitHub Pro（需付费）、给 codeql job 加 public 条件后跳过（Security 流水线长期失效）| 影响面：仓库可见性设置、.github/workflows/security.yml（无需改动即生效）、code scanning 分析记录

<a id="d-2026-11-07-2"></a>
- [2026-11-07]｜决策：首次启动随机生成的管理员初始密码不再打印到控制台/容器日志，改为写入 `server/data/admin-initial-password.txt`（`writeFileSync` 的 `mode: 0o600`），日志仅输出文件路径；`ADMIN_INITIAL_PASSWORD` 显式配置时行为不变 | 理由：容器日志常被集中采集，明文凭据会扩散到日志系统；该处触发 CodeQL `js/clear-text-logging`（error 级）| 放弃的备选：保留控制台打印 + 内联抑制注释（属掩盖而非修复）、按环境区分打印（开发路径仍泄露）| 影响面：server/src/migrateMultiUser.ts、.env.example、docs/DATABASE.md、docs/API_REFERENCE.md（2 处）、docs/MULTI_USER_DESIGN.md（2 处）、CHANGELOG.md

<a id="d-2026-11-07-3"></a>
- [2026-11-07]｜决策：迁移日志中不再输出任何 `process.env` 派生值（当前为 `ADMIN_USERNAME` 对应的管理员用户名），日志改为固定文案 | 理由：CodeQL `js/clear-text-logging` 把 `process.env` 一律视为敏感源，密码落盘改造后告警文案由 `initialPassword` 变为 `process.env`，说明仅修密码不足以关闭告警；用户名以配置为准不写日志可完整消除该数据流 | 放弃的备选：对用户名做正则净化后输出（taint 仍可追踪，无法保证告警消失）、dismiss 告警为误报（会掩盖同规则的真实问题）| 影响面：server/src/migrateMultiUser.ts（runMultiUserMigration 创建首管理员分支的两个 logger.info 调用）