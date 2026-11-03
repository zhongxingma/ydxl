# 开发痕迹清理变更报告

> 范围：两轮清理（内部开发痕迹 + Phase 1/2/3 标记）；基线提交 `052d2f3`，变更均在工作区待提交。
> 验证规模：前端 203 文件 / 1764 用例、后端 24 文件 / 247 用例（清理前后一致）。

## 1. 背景与范围界定

目标为清理代码与文档中的开发过程标记。经确认采用「机械式定向清理」方案，红线如下：

- **清理**：路线图编号（M/S/L/P/R 系列）、修复与实测日期戳、内部分析文档引用、补测批次标记、开发过程措辞、Phase 1/2/3 阶段代号、工具来源注释。
- **保留**：业务逻辑与代码、测试断言与用例数据、有价值的技术注释与文档、locale 字典、业务性日期（显示格式示例、上游弃用日期、镜像 tag 示例）。
- **方法**：固定模式脚本只处理整行注释 → dry-run 全量人工审查 → 落盘 → diff 审计（零非注释行改动）→ 全量门禁验证；非注释位置（测试标题、字符串、标识符、文件名）一律定点处理并逐项验证。

## 2. 第一轮：内部开发痕迹清理（65 文件 / 95 行）

全部为注释行替换（94 行 1:1 替换 + 1 行基线新增，零删行）。

| 类别 | 数量 | 示例（前 → 后） |
|---|---|---|
| 路线图编号 | 40 处 / 31 文件 | `// 窗口化虚拟滚动列表（M1）` → `// 窗口化虚拟滚动列表` |
| | | `// 用户管理与审计日志查询路由（多用户 P1/P2）` → `（多用户）` |
| | | `// 审计：重置密码（P2，不记录密码本身）` → `（不记录密码本身）` |
| 修复/实测日期戳 | 约 50 处 | `// 防覆盖守卫（2026-08-29 修复「文章与练习题/词汇不对应」）` → `（修复「文章与练习题/词汇不对应」）` |
| | | `// 2026-08-29 修复：旧逻辑按 locationClue 去重…` → `// 修复：旧逻辑按 locationClue 去重…` |
| 内部分析文档引用 | 2 处 | `// 背景：docs/COMPREHENSIVE_ANALYSIS_REPORT.md §4.2 建议补一次…` → `// 背景：建议补一次…` |
| 补测批次标记 | 1 处 | `2026-10-26 第二十批补测后实测基线` → `实测基线` |
| 开发过程措辞 | 1 处 | `// 修复历史缺陷：POST /api/words 通过…` → `// POST /api/words 通过…` |
| 工具来源注释 | 1 处 | `.gitignore：# Trae IDE 本地配置…` → `# IDE 本地配置…` |
| i18n 基线顺带修复 | 1 行 | `scripts/i18n-baseline.json` 新增 `sentry.ts: 1`（Sentry 提交时遗漏的存量漂移） |

编组编号删除连同后随空格（避免 `aiQuota.test.ts` 续行缩进错位）；括号内标记删除后整理空洞（`（多用户 P1/P2）`→`（多用户）` 而非 `（多用户 ）`）。

## 3. 第二轮：Phase 1/2/3 标记清理

### 3.1 代码注释（59 行 / 18 文件）

标签位删除、名词引用按语义改写，保证语句通顺：

| 位置类型 | 示例（前 → 后） |
|---|---|
| 标签位 | `// Phase 3 优化：10 → 5，节省约 50 token/次` → `// 优化：10 → 5…` |
| | `// Phase 2 fine-tune: max_tokens 4096 → 3072` → `// fine-tune: max_tokens 4096 → 3072` |
| | `// ---------- Phase 2: deepseekCacheHitRate 计算 ----------` → `// ---------- deepseekCacheHitRate 计算 ----------` |
| 名词引用 | `// 1. Phase 2 总 token 应小于 Phase 1 × 0.8` → `// 1. 优化后总 token 应小于基线 × 0.8` |
| | `// 因 Phase 2 代码已合入，无法实际运行 Phase 1 路径` → `// 因优化代码已合入，无法实际运行优化前路径` |
| | `// 2. Phase 3 后热启动仅 article 不缓存` → `// 2. 优化后热启动仅 article 不缓存` |

语义映射：`Phase 1`→基线/优化前，`Phase 2/3`→优化后（对照叙述保语义）。严格匹配「Phase + 空格 + 数字」，`deepseekPhase2` 等标识符/文件名不命中（杜绝路径误伤）。

### 3.2 测试标题与 console 字符串（16 处 / 4 文件）

- `describe('DeepSeek Phase 2 优化效果验证')` → `describe('DeepSeek 优化效果验证')`
- `it('Phase 2 相比 Phase 1 基线…')` → `it('优化后相比基线…')`
- 报告输出 `【Phase 1 基线】`/`【Phase 2 实际】` → `【基线】`/`【优化后实际】`
- it 标题内 `（Phase 2 fine-tune）`/`（Phase 2 关闭思考）`/`（Phase 2）` 括号整体删除

### 3.3 标识符改名（8 个 / 82 处，单测试文件内）

| 前 | 后 | 处数 |
|---|---|---|
| `PHASE1_BASELINE` | `BASELINE` | 15 |
| `PHASE2_ACTUAL` | `OPTIMIZED` | 4 |
| `phase1ByScenario` | `baselineByScenario` | 22 |
| `phase1Total` | `baselineTotal` | 8 |
| `phase2Responses` | `optimizedResponses` | 2 |
| `phase2Stats` | `optimizedStats` | 8 |
| `phase2ByScenario` | `optimizedByScenario` | 16 |
| `phase2Total` | `optimizedTotal` | 7 |

### 3.4 文件重命名（git mv 保留历史，自引用同步）

- `src/__tests__/deepseekPhase2.verification.test.ts` → `deepseekOptimization.verification.test.ts`
- `src/shared/services/ai/__tests__/ai-provider-phase2.test.ts` → `ai-provider-finetune.test.ts`

### 3.5 文档（5 文件 / 42 处）

| 文档 | 处理 |
|---|---|
| `docs/AI_TOKEN_OPTIMIZATION.md` | 35 处 `Phase 1/2/3` → `第一轮/第二轮/第三轮`（保留优化分批叙事，去除阶段代号）；悬空引用 `scripts/verify-deepseek-phase2.ts`（文件不存在）3 处改指 `src/__tests__/deepseekOptimization.verification.test.ts`；标题日期戳 1 处删除 |
| `docs/archive/REFACTOR_SUMMARY_2026-10-26_TEST_SUITE.md` | 3 处（历史文件名 `ai-provider-phase2`→`ai-provider-finetune`、`Phase 2 调优`→`参数调优`、验证脚本引用措辞） |
| `docs/ARCHITECTURE.md` / `docs/API_REFERENCE.md` ×2 / `docs/TECHNICAL_ANALYSIS.md` | 行内标记 4 处（`Phase 3 从 10 精简到 5`→`从 10 精简到 5` 等），API_REFERENCE 与 `types.ts` 注释同步 |

## 4. 变更规模汇总（git 视角）

- **79 文件 / 248 增 / 247 删**（含 2 个重命名）；其中 docs 5 文件 / 31 行。
- 注释类改动全部 1:1 行替换（增删行数对等），无任何文件删除。
- 测试文件数与用例数清理前后完全一致（203/1764 + 24/247）。

## 5. 验证结果（全部通过）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✓（标识符改名零悬空引用） |
| `npm run lint` | ✓ 0 error，823 warnings 与基线持平（无新增） |
| `npm test`（前端） | ✓ 203 文件 / 1764 用例 |
| `npm --prefix server test`（后端） | ✓ 24 文件 / 247 用例 |
| `npm run docs:verify` | ✓ 8/8（测试规模数值未变，无需同步） |
| `npm run i18n:check` | ✓ |
| 残留扫描 | ✓ 全仓库 `M/S/L/P/R` 编号、日期戳、`Phase`/`phase`、`verify-deepseek` 零残留 |

diff 审计：第一轮改动行 100% 位于整行注释；第二轮非注释改动（测试标题/字符串/标识符/文件名）均定点、逐项验证。

## 6. 事故与处置记录

| 事故 | 根因 | 处置 | 结果 |
|---|---|---|---|
| 并行子代理清理破坏代码（typecheck/docs:verify/i18n:check 三门禁失败，148 文件） | 跨百文件注释级清理超出并行子代理精细控制能力（`Topic` 类型被改、测试文件疑似被删、README 锚点损坏） | `git stash push -u` 保留现场，恢复 HEAD；改用机械式定向脚本重做 | 重做后全门禁通过；stash 保留可查 |
| 文档空格清理误删「第N轮」字样 | `node -e "…'$1'…"` 双引号中 `$1` 被 PowerShell 展开为空，替换退化为删除 | 当场 `git checkout` 恢复文档，改用 Edit 工具逐项重做；修复重做过程中暴露的 12 处 markdown 结构空格（`## 第二轮` 等） | 全文逐行核验通过 |

## 7. 保留项与依据

| 保留内容 | 依据 |
|---|---|
| `phrases/types.ts`「2026-08-05」、`deepseekProvider.ts` 2026/07/24、`blue-green-deploy.mjs` 镜像 tag 示例 | 业务性日期（显示格式示例 / 上游弃用日期 / 用法示例），非开发痕迹 |
| Phase 类描述词（`优化`、`fine-tune`、`关闭思考` 等） | 属技术语义，仅去除阶段代号 |
| `docs/archive/` 归档文档其余内容、文档内技术叙事 | 有价值文档保留；仅中性化标记与失效引用 |
| AI 提示词中文（articlePrompts / promptShared / wordPrompts） | 内部中文，按约定不纳入 UI i18n 与本次清理 |
| 业务注释（如「审计：…」「防覆盖守卫（修复…）」） | 有价值技术注释，仅删除其上的过程标记 |

## 8. 经验教训

1. **机械脚本 + dry-run 全审**是大规模注释清理的可靠模式：固定正则只碰整行注释、1:1 替换、逐行 diff 审查后再落盘，可守住「不动代码」红线。
2. **标识符/文件名敏感的模式必须收紧匹配**：`Phase␣数字`（带空格）才能避开 `deepseekPhase2` 这类路径与标识符。
3. **批量文本替换禁用 `node -e` 双引号传参**（PowerShell 展开 `$1` 等变量）；复杂替换一律落盘为 `.mjs` 文件执行。
4. 并行子代理不适合跨百文件的精细文本手术；错误恢复手段（stash / checkout）先行保底，再换方法重做。
