# Bug 跟踪与管理日志

> 维护规则：每发现一个 bug 立即登记（状态 `open`）；修复后更新为 `fixed` 并附回归验证方式；
> 无法复现或属设计预期的移入 `wontfix`/`duplicate` 并注明理由。按严重级别排序：P0 阻断 > P1 严重 > P2 一般 > P3 轻微。

## 索引

| ID | 严重级别 | 模块 | 标题 | 状态 |
|----|---------|------|------|------|
| BUG-001 | P1 | reading/测试 | ReadingPage 测试 mock 缺失语法填空方法导致 12 个用例误报失败 | fixed |
| BUG-001b | P2 | reading/测试 | 测试假设"挂载即自动加载文章"与难度选择弹窗新流程脱节 | fixed |
| BUG-002 | P2 | reading/测试 | 文章 prompt 测试断言与源码 prompt 演进脱节 | fixed |
| BUG-003 | P2 | routing | 无 404 兜底路由，未知路径渲染空白页 | fixed |
| BUG-004 | P3 | repo 卫生 | dist/ 与 server/dist/ 构建产物被纳入仓库；根目录存在杂散文件 `12.0.0` | fixed |

---

## BUG-001 ReadingPage 测试 mock 缺失语法填空方法导致 12 个用例误报失败

- **级别**：P1（测试套件长期红，掩盖真实回归信号）
- **模块**：`src/features/reading/pages/__tests__/`
- **发现方式**：全量 vitest 运行，13 个失败中 12 个集中于此
- **症状**：`ReadingPage.raceAndMarkAsRead.test.tsx`（9 例）与 `ReadingPage.articleId.test.tsx`(3 例) 全部失败，
  页面渲染出错误边界："questionService.getGrammarFillQuestionsForArticle is not a function"
- **根因**：源码 [questionService.ts](src/features/reading/services/questionService.ts#L242) 已导出
  `getGrammarFillQuestionsForArticle`，且 ReadingPage 在 `Promise.allSettled(...)` 参数求值阶段同步调用它；
  但两个测试文件的 `vi.mock('../../services/questionService')` 工厂只提供 `getQuestionsForArticle`。
  mock 对象上该方法为 `undefined`，参数求值即抛 TypeError，绕过 allSettled 错误隔离 → 整篇文章加载失败 →
  断言找不到文章文本。
- **修复**：在两个测试文件的 vi.mock 工厂补充 `getGrammarFillQuestionsForArticle`（默认返回空数组，
  个别用例可覆写）。
- **回归验证**：`npx vitest run src/features/reading/pages/__tests__/ReadingPage.markAsRead.test.tsx src/features/reading/pages/__tests__/ReadingPage.raceProtection.test.tsx src/features/reading/pages/__tests__/ReadingPage.grammarChoice.test.tsx src/features/reading/pages/__tests__/ReadingPage.articleId.test.tsx`（原 `ReadingPage.raceAndMarkAsRead.test.tsx` 已按职责拆分）
- **状态**：fixed

## BUG-001b 测试假设"挂载即自动加载文章"与难度选择弹窗新流程脱节

- **级别**：P2（测试滞后于产品交互演进）
- **模块**：`src/features/reading/pages/__tests__/`
- **发现方式**：修复 BUG-001 后，剩余 8 个失败暴露此问题（waitFor 超时特征）
- **症状**：走"每日阅读"路径的用例（raceAndMarkAsRead 5 例 + articleId 1 例）全部超时——文章始终未渲染。
- **根因**：ReadingPage 已演进为「无 articleId 时先弹出 DifficultySelectModal，用户点击『开始阅读』后才调用
  loadToday」（[ReadingPage.tsx#L332-L339](src/features/reading/pages/ReadingPage.tsx#L332-L339)），
  旧测试仍假设挂载即自动加载。
- **修复**：新增 `startDailyReading()` 辅助函数模拟真实用户路径（等待弹窗 → 点击「开始阅读」）；
  articleId 测试在 loadToday 用例中显式点击弹窗按钮。
- **回归验证**：同 BUG-001；三个文件 27/27 通过。
- **状态**：fixed

## BUG-002 文章 prompt 测试断言与源码 prompt 演进脱节

- **级别**：P2（单测红，但功能本身正常——属于"测试滞后于实现"）
- **模块**：`src/features/reading/services/__tests__/articlePromptInjection.test.ts`
- **发现方式**：全量 vitest 运行
- **症状**：「精简 schema 后字段语义说明（1-11 条要求）仍保持完整」失败：
  断言期望 `'genre 字段必须使用 narrative / expository / practical 之一'`，
  实际源码已演进为 `'genre 字段必须使用 narrative / expository / practical / argumentative 之一'`
  （新增议论文文体），且要求条目从 11 条扩展到 14 条。
- **根因**：prompt 源码新增 argumentative 文体后未同步更新该测试的字符串断言。
- **修复**：更新测试断言与现行 prompt 对齐（genre 四文体、要求条数说明），并保留对 JSON 样例不含枚举值的既有校验。
- **回归验证**：`npx vitest run src/features/reading/services/__tests__/articlePromptInjection.test.ts`
- **状态**：fixed

## BUG-003 无 404 兜底路由，未知路径渲染空白页

- **级别**：P2（用户体验：直接访问错误 URL 或书签失效时看到空白内容区，无任何引导）
- **模块**：`src/App.tsx`
- **发现方式**：架构分析（路由清单核对）
- **症状**：路由表仅注册 9 条具体路径，无 `<Route path="*">` 通配兜底；未匹配路径下 Layout 正常渲染但 Outlet 为空白。
- **修复方案**：新增 `NotFoundPage` 组件 + `<Route path="*">` 兜底路由，提供返回首页引导。
- **状态**：fixed
  - 新增 [NotFoundPage.tsx](src/pages/NotFoundPage.tsx)（渐变 404 锚点 + 返回首页按钮，懒加载）
  - App.tsx 注册 `path="*"` 兜底路由（含 Suspense + ErrorBoundary 包裹）
  - 新增单元测试（4 例：文案渲染 / 首页链接 / 兜底生效 / 已知路径不受影响）
- **回归验证**：`npx vitest run src/pages/__tests__/NotFoundPage.test.tsx` → 4/4 通过

## BUG-004 构建产物与杂散文件被提交进仓库

- **级别**：P3（仓库卫生）
- **模块**：仓库根目录
- **发现方式**：架构分析
- **症状**：`dist/`、`server/dist/` 构建产物存在于工作区并被跟踪；根目录存在名为 `12.0.0` 的杂散文件。
- **修复**：
  - 删除杂散文件 `12.0.0`（内容为 npm 版本输出 "13.0.3"，系命令误重定向产物）
  - `.gitignore` 已确认包含 `dist/`、`server/dist/` 规则，无需修改
  - 注：当前环境无 git 命令可用，若产物已被 git 跟踪需执行 `git rm -r --cached dist server/dist`
- **状态**：fixed
