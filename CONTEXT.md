# 项目上下文交接板

> 本文件由 context-archive Skill 在会话收尾时更新。新会话开始时优先阅读本文件。

## 项目当前状态

ydxl 前端测试覆盖率补测进行至第二十批：194 个前端测试文件 / 1718 用例全部通过，覆盖率 statements 95.05% / branches 85.36% / functions 95.17% / lines 97.11%，提交 22d32a0 已推送 main 且 CI 全绿；下一批尚未启动。

## 已完成并验证

- 第二十批补测（6 个文件 / 34 用例）｜交付：`src/pages/__tests__/DashboardPage.navigation.test.tsx`、`src/pages/hooks/__tests__/useDashboardOverview.test.tsx`、`src/shared/services/ai/__tests__/providerCore.test.ts`、`src/shared/services/__tests__/secureStorage.errors.test.ts`、`src/features/review/pages/__tests__/ReviewPage.test.tsx` 新建，`src/features/wordbook/services/__tests__/wordbookService.mutation.test.ts` 扩展｜验证：`npx vitest run` 上述 6 个文件全部通过
- 全量回归与覆盖率｜交付：194 文件 / 1718 用例通过，覆盖率 95.05% / 85.36% / 95.17% / 97.11%｜验证：`npm run test:coverage`
- 防回退阈值上调｜交付：`vitest.config.ts` 阈值 91 / 81 / 91 / 93｜验证：`npm run test:coverage` 阈值校验通过
- 文档同步｜交付：TESTING.md、README、CONTRIBUTING、CODING_STANDARDS、MULTI_USER_DESIGN、CHANGELOG、ci.yml 数值与批次记录更新｜验证：`Select-String -Path README.md,CONTRIBUTING.md,CHANGELOG.md,docs/TESTING.md,docs/CODING_STANDARDS.md,docs/MULTI_USER_DESIGN.md,.github/workflows/ci.yml -Pattern '189 个|1684|1900|94\.40|96\.41'`（仅 CHANGELOG 历史条目命中，属预期）
- 类型检查 / Lint / 生产构建｜交付：无错误（lint 仅 1 条既有 warning）｜验证：`npm run typecheck`、`npm run lint`、`npm run build`
- 提交与 CI｜交付：提交 22d32a0（test: 补测仪表盘交互、复习路由与存储容错）｜验证：push 成功；GitHub Actions run 40342709391 的 lint / test-frontend / test-server / build / e2e 五 job 均 completed/success
- 历史批次（第八至十九批）测试治理与补测｜交付：测试文件按职责拆分至 ≤400 行，前端用例 1219 → 1684｜验证：各批 `npm run test:coverage` 与 CI run（40297708376、40322260616、40339314267 等）全绿

## 进行中

- 无

## 关键决策索引

> 完整决策理由见 DECISIONS.md。

- [2026-10-26] 覆盖率阈值取实测基线下方约 4 个百分点 → 详见 DECISIONS.md#d-2026-10-26-1
- [2026-10-26] 每批约 5 个文件 / 30-60 用例，独立验证提交 → DECISIONS.md#d-2026-10-26-2
- [2026-10-26] 测试文件按职责拆分且单文件 ≤400 行 → DECISIONS.md#d-2026-10-26-3
- [2026-10-26] secureStorage 错误路径用伪 IDB + `vi.resetModules` → DECISIONS.md#d-2026-10-26-4
- [2026-10-26] 页面接线测试用子组件替身 + 路由探针 → DECISIONS.md#d-2026-10-26-5

## 已知问题与风险

- practiceQuestionGenerator 剩余未覆盖行为防御性兜底分支，公共 API 基本不可达｜状态：已规避｜依据：coverage/lcov.info 未覆盖行清单
- secureStorage 告警仅在 DEV 分支执行｜状态：已规避｜依据：src/shared/services/secureStorage.ts 第 76-91 行
- github.com 直连不稳定，需 `-c http.curloptResolve=github.com:443:20.205.243.166` 推送｜状态：已规避｜依据：本次 push 成功记录
- CONTEXT.md / DECISIONS.md 尚未纳入 git 跟踪｜状态：待解决｜依据：`git status` 显示 `?? CONTEXT.md`、`?? DECISIONS.md`

## 下一步计划

- 继续下一批补测：优先 ReadingPage.tsx（13 行）、DashboardPage 剩余骨架分支、providerCore / aiConfig 残余分支；防御性不可达分支（practiceQuestionGenerator）不投入
- 若用户决定，将 CONTEXT.md / DECISIONS.md 纳入版本库跟踪

## 新会话优先阅读的文件

- src/pages/__tests__/DashboardPage.navigation.test.tsx｜页面回调接线测试范式｜先
- src/shared/services/__tests__/secureStorage.errors.test.ts｜伪 IndexedDB 错误路径测试范式｜先
- vitest.config.ts｜覆盖率阈值唯一配置入口｜后
- docs/TESTING.md｜测试规模、覆盖率基线与文件清单权威文档｜后
- CHANGELOG.md｜批次记录与覆盖率演进｜后
