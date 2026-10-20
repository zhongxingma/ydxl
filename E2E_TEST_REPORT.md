# E2E 测试总结报告

> 日期：2026-10-20 ｜ 项目：ydxl（英语学习应用）｜ 执行环境：Windows + 系统 Chrome

## 1. 测试概述

本次工作为项目引入浏览器级 E2E 测试（Playwright），为三条关键用户路径建立回归保障。经确认采用两项决策：

- **技术路线：前端级 + API 拦截** —— Playwright 驱动真实浏览器访问 vite dev server（5173），所有 `/api` 请求由 `page.route()` 在网络层拦截并返回预置 fixture，**不启动真实后端**
- **CI 集成** —— `.github/workflows/ci.yml` 新增 e2e job

## 2. 测试环境

| 项 | 值 |
| --- | --- |
| Node.js | v20.17.0（`@playwright/test` 1.64.1 要求 Node ≥ 20） |
| 浏览器 | 本地系统 Chrome（`channel: 'chrome'`）；CI 使用 `npx playwright install --with-deps chromium` |
| Web Server | Playwright 自动启动 `npm run dev`（vite dev，端口 5173） |
| 执行配置 | workers 1 ｜ 用例超时 30s（spec 内放宽至 60-90s）｜ 失败重试：本地 0 / CI 1 ｜ trace retain-on-failure |

## 3. 测试方案要点

**API 拦截分发（`e2e/helpers.ts` 单入口）**：

| 请求 | fixture 行为 | 目的 |
| --- | --- | --- |
| `POST /api/auth/login` | 200 `{token, user}` | 登录流程放行 |
| `/api/v1/ai-proxy/**` | **404**（4xx 不触发指数退避） | 验证 AI 不可用时的前端降级路径，秒级失败 |
| `GET /api/{表}?limit=1000` | 200 空集合 | 增量同步对空 remote 不覆盖本地缓存 |
| `GET /api/articles/e2e-article-1` | 200 fixture 文章 | 阅读路径数据源 |
| `POST/PUT/DELETE /api/**` | 200 回显请求体 | repository 写回本地缓存 |
| 其余 GET | 404 | 触发调用方本地缓存回退 |

**数据预置**：先访问生词本页触发 Dexie 建库（`ydxl-db` v7），再用原生 IndexedDB API 直写 `questions` / `words` 表。fixture 设计约定：

- 文章 `vocabulary` 为「增强版」（每条含 `exampleSentence` / `exampleSentenceTranslation` / `emojiHint`），vocabularyService 检测后**短路 AI 调用**直接渲染
- 复习词 `luminous` 五字段齐全（不触发 enrichWord 的 AI 补全）、`nextReview: 0` 确保命中今日队列、`example` 含单词本身（保证例句填空题型可出）
- 练习题 3-5 题随机且选项打乱 → 测试按**内容**定位正确项（单词类点 `word.word`，释义类点 `word.definition`）

## 4. 测试用例与结果

**结论：4/4 全部通过，连续三轮运行稳定**（19.4s / 19.1s / 22.5s）。

| # | 用例 | 验证路径 | 结果 |
| --- | --- | --- | --- |
| 1 | 断网后本地缓存仍可支撑阅读页与复习队列 | 在线加载文章写 Dexie 缓存 → `context.setOffline(true)` → OfflineBanner 出现 → 文章本地渲染不中断 → SPA 导航复习队列纯本地可用 | ✓ 6.4s |
| 2 | 失败分支：AI 不可用时提示生成失败并提供重试入口 | 增强版词汇短路（无「重点词汇生成失败」）→ 语法填空 404 提示条 → 「阅读完成」→ 练习题生成失败 toast + 错误态 + 重试按钮 | ✓ 2.4s |
| 3 | 成功分支：预置本地题目，完成阅读理解并查看成绩单 | 本地题目命中 → 答题视图 → 逐题作答全对 → 「查看成绩」→ 跳过语法填空 → 成绩单正确率 100% | ✓ 3.8s |
| 4 | 五步复习全流程 | 列表队列命中 → 识记 → 朗读 → 练习（随机 3-5 题循环作答全对）→ 拼写 → 默写 → 「已掌握」评价 → 「今日复习已完成 🎉」 | ✓ 4.5s |

## 5. 调试过程中解决的关键问题

| # | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | 启动即报「Executable doesn't exist … chromium_headless_shell」 | 本地 shell 自动注入 `CI=true`，配置走 CI 分支去找未安装的内置 Chromium | 运行前清除 `CI` 环境变量，走系统 Chrome 渠道 |
| 2 | 成绩单断言 `getByText('100%')` strict mode violation | 页面 4 处渲染 100%（成绩卡、成绩分析、答题详解） | 改用 `.first()` 定位成绩单卡片 |
| 3 | 断网后文章 h1 断言失败 | `seedIndexedDB` 会导航到生词本页建库，之后未回到文章页就断网 | 调整顺序：先 seed，再进入文章页，后断网 |
| 4 | 离线点击「生词背诵」触发 ErrorBoundary：`Failed to fetch dynamically imported module: ReviewPage.tsx` | **`page.goto` 是整页加载，会清空 JS 模块缓存**；React.lazy 的页面 chunk 在离线后无法再拉取（dev 无 SW 预缓存） | 在**同一文档生命周期内**预热：客户端导航进复习页 → `goBack()` 返回（chunk 留在内存）→ 再断网导航 |

> 问题 4 是本次最有价值的发现：**dev 模式下 React.lazy 与离线天然冲突**，此约束已写入 `e2e/offline.spec.ts` 注释与 docs/TESTING.md，后续任何离线相关测试都需遵守「同文档预热」。

## 6. 配套变更

| 文件 | 变更 |
| --- | --- |
| `e2e/helpers.ts` + 3 个 spec（新建） | E2E 测试本体 |
| `.gitignore` | 排除 `test-results/` / `playwright-report/` / `blob-report/` |
| `.github/workflows/ci.yml` | 新增 e2e job：Node 20（Playwright 1.x 要求 ≥20，不复用全局 Node 18）+ `npx playwright install --with-deps chromium` + `npx playwright test` |
| `docs/TESTING.md` | §1.3 由「占位，未来计划」重写为「已引入」：技术路线、用例表、关键约定 |
| `CHANGELOG.md` | Unreleased/Added 新增 E2E 条目，修正 CI 条目过时的用例数 |
| `README.md` / `docs/README.md` | 测试框架行、运行命令、测试规模、文档索引同步 |

## 7. 运行方式

```bash
# 本地（需 Node 20+ 与系统 Chrome；自动启动 vite dev）
npm run test:e2e

# CI 中自动执行（Ubuntu + 内置 Chromium），push / PR 触发
```

## 8. 已知边界与后续建议

**已知边界**：

- dev 模式不生成 Service Worker（VitePWA 仅 build 启用），离线测试验证的是 **Dexie 本地缓存回退**；生产构建的 SW 预缓存路径未被 E2E 覆盖
- 仅覆盖 Chromium 单浏览器；e2e 目录不参与 `tsc -b` 类型检查（根 tsconfig 仅 references app+node）

**后续可扩展方向**：

1. 生产构建 + SW 离线验证（`vite preview` 模式，验证 Workbox 预缓存真实生效）
2. 补充生词本添加、打印工作表、多用户切换等路径的 E2E 用例
3. 需要时接入 Firefox / WebKit 项目矩阵与视觉回归

---
*报告由 TraeWork 生成 ｜ 详细测试代码见 `e2e/` 目录 ｜ 测试策略文档见 `docs/TESTING.md`*

## 附录：后续扩展执行记录（2026-10-20 同日）

报告第 8 节列出的扩展方向 1、2 已执行完成：

**方向 1 —— 生产构建 + SW 离线验证（✅）**

- 新增 [playwright.sw.config.ts](../playwright.sw.config.ts)（`vite build` + `vite preview` 4173，仅匹配 `*-sw.spec.ts`）与 [e2e/offline-sw.spec.ts](../e2e/offline-sw.spec.ts)：SW 激活（预缓存 45 项）→ 断网**整页重载**由 Workbox 预缓存提供文档 → OfflineBanner + 本地数据照常可用 → 离线 SPA 导航复习队列可用
- 新增脚本 `npm run test:e2e:sw`；CI e2e job 依次运行两轮（dev 拦截 + 生产 SW）
- **新经验**：生产构建下登录整页跳转后页面即处于 SW 控制中，`page.route()` 不拦截 SW 透传的网络请求，fixture 必须改用 `context.route` 注册（helpers 已拆分 `setupApiFixturesOnContext`）
- 构建验证：`registerSW.js` 由 vite-plugin-pwa 自动注入 index.html（`injectRegister: auto`），45 个预缓存条目约 1.7MB

**方向 2 —— 补充用例（✅ 生词本 + 打印 + 多用户切换）**

- [e2e/wordbook.spec.ts](../e2e/wordbook.spec.ts)：添加单词全流程（五字段填写 → 保存 → 生词卡出现列表）
- [e2e/print.spec.ts](../e2e/print.spec.ts)：打印降级分支（AI 404 → 「仅打印文章内容」）+ 完整分支（预置题目 → 工作表含题干）；技术要点：`.print-portal` 屏幕上 `display:none`，断言用 `toHaveCount` + `window.print` 桩计数（headless 无打印对话框）
- [e2e/multiuser.spec.ts](../e2e/multiuser.spec.ts)（同日追加）：登出拦截 / 换账号登录清空上一账号本地缓存 / 同账号重复登录保留缓存。fixture 改为按用户名派生用户 id 驱动 cache-owner 检测；因已登录访问 /login 会被重定向回首页，场景 2/3 用 `sessionStorage.clear()` 模拟「会话丢失未登出」（登出按钮本身也会清缓存，绕过它才能精确覆盖账号切换检测）
- 多浏览器矩阵与视觉回归（方向 3）按「需要时」原则继续暂缓

**最终规模**：7 个 spec 共 11 个用例，全部通过（dev 10 用例 37.5s + preview SW 1 用例），lint 全绿，CI 已接入两轮 E2E。
