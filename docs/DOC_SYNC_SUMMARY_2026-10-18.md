# 文档同步变更摘要（2026-10-18）

> 本文件为**历史快照**性质的一次性变更记录（与 PROJECT_ANALYSIS_REPORT.md 同类处置），
> 记录本轮文档同步的最终留存改动，不随源码后续演进更新。
> 净留存改动：4 份文档 + 1 处代码注释；演练过程代码改动已全部还原并复验全绿。

## 1. CONTRIBUTING.md（核心改动）

| 变更 | 说明 |
| --- | --- |
| 新增第 8 节「如何新增 AI Provider」 | 9 个子节全流程：types.ts 注册 → Provider 类实现骨架 → index.ts 工厂 8 注册点 → 个人中心 UI → config/ai-providers.json → 服务端 UPSTREAMS → 环境变量 → 测试与验证 → 文档同步；开头含「OpenAI 兼容平台可直接用 custom，无需写代码」决策提示 |
| 8.4 重写（演练发现） | 原「下拉框自动派生，无需改动」声明有误——实为静态 `<option>` 列表且 typecheck 不报错（value 经 `as` 断言）；改为硬编码选项追加步骤 + 警示框 |
| 8.8 修正（演练发现） | 补齐 `npm --prefix server run build`（服务端无独立 typecheck 脚本，类型检查由 tsc build 承担）；标注服务端 UPSTREAMS 为宽类型 `Record<string, UpstreamConfig>`，漏加时 tsc 不报错、需人工对照 |
| 8.8 测试命令修正 | `npm test` 实为仅前端（vitest 只含 `src/**`）；补齐 `npm --prefix server test`，并同步修正第 1、5 节同源漂移 |
| 8.9 扩充至 10 个同步点 | 三轮检查：3 → 7（补 AI_API_CONFIGURATION / TESTING / ARCHITECTURE / OPERATIONS）→ 10（补 DEPLOYMENT / USER_GUIDE / LINUX_DEPLOY）+ 3 类显式排除附注（PROJECT_ANALYSIS_REPORT 历史快照 / AI_TOKEN_OPTIMIZATION 与 TECHNICAL_ANALYSIS 机制分析按需） |
| 第 2 节残留修复 | 「四供应商 + 降级/混合调度」→「四供应商 + 降级兜底」（WebChat 时代残留，HybridAIProvider 已移除） |

## 2. docs/OPERATIONS.md

- **5.3 漂移修复**：Dexie 版本路径原停留在 v3，修正为当前 v7（8 张表），改为引用 DATABASE.md 权威演进表（消除双源维护），并指向 UPGRADE.md 变更规范
- **5.4 扩充为「SQLite schema 迁移手册」**：原 5 行简述 → 完整 4 步流程（①开发侧两处缺一不可：`CREATE TABLE` 加列 + `PRAGMA table_info` 迁移段，附代码模板；索引与 JSON_COLUMNS / ENCRYPTED_COLUMNS 同步 ②升级前备份 ③部署重启自动迁移 ④验证 `PRAGMA table_info` / `index_list` / 健康检查）+ 回滚边界（新增列向后兼容可直接回滚代码 vs 破坏性变更走备份恢复）+ migrateMultiUser 机制交叉引用

## 3. docs/UPGRADE.md

- 第五节错误规则修正：「只需声明变更的表，Dexie 会合并」与代码实际矛盾（src/shared/services/db.ts v1-v7 每个版本均重新声明全部表）→ 修正为「必须重新声明全部表 schema」，规则清单与 v8 示例改为 8 张表全量声明，附 DATABASE.md 演进史交叉引用

## 4. src/shared/services/ai/types.ts（唯一代码留存）

- 修正 AIProviderMeta 上方「ProfilePage 下拉框由此派生」的过时注释（演练证实下拉框为静态列表），避免误导后续贡献者

## 5. docs/README.md（第 5 轮检查发现）

- 本摘要文件创建时未按维护约定（「新增文档请同时更新本索引与根 README 的文档表」）登记索引；已补「专项记录」表登记行（与 PROJECT_ANALYSIS_REPORT 同类，标注历史快照）
- 根 README 有意不登记：其现有惯例即不列历史快照类文档，保持一致

## 质量保证

- **演练式核对**：模拟新增第 5 家供应商完整走完 8.1-8.9——
  - Stage A：仅加联合类型跑 typecheck，恰好 4 个 TS2741 报错全部指向指南声称的 Record 映射，指路声明属实
  - Stage B：指南 8.2 骨架代码逐字采用、一次编译通过
  - Stage C：typecheck / lint / 前端 686 用例 / 服务端 tsc + 135 用例 / 构建全绿
  - Stage D：8.9 目标点抽查有效（AI_API_CONFIGURATION 第四节、TESTING 第 7 节）
  - Stage E：全部还原复验全绿，zhipu 零残留
- 演练实测发现并修正 2 处清单缺口（8.4 下拉框、8.8 服务端验证命令）
- 所有文档结论逐点对照源码，未新建源码文件；「文档与源码保持一致」约定闭环
- 项目分析报告的 2 项 P2 文档缺口（AI Provider 贡献指南、数据库迁移手册）全部完成

## 收尾全量验证（终验）

文档同步 + 演练还原后对仓库整体状态的最终验证：

| 验证项 | 结果 |
| --- | --- |
| ESLint（前端） | ✅ 0 错误 0 警告 |
| 前端测试 | ✅ 57 文件 / 686 用例全通过 |
| 服务端测试 | ✅ 11 文件 / 135 用例全通过（含 AI 代理契约 22 例、迁移幂等 5 例） |
| 生产构建 | ✅ `tsc -b && vite build` 成功，810 模块，PWA 41 precache 条目 |

合计 **68 文件 / 821 用例**，与测试基线完全一致；演练还原后无残留影响。
