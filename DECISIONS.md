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