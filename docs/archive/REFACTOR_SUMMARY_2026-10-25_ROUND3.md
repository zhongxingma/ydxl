# 重构总结报告（第三轮：生词本与个人中心，2026-10-25）

> 历史快照：本报告记录 2026-10-25 第三轮结构化重构的完成情况，内容不随代码更新。
> 第一轮见 [REFACTOR_SUMMARY_2026-10-25](./REFACTOR_SUMMARY_2026-10-25.md)，第二轮见 [REFACTOR_SUMMARY_2026-10-25_ROUND2](./REFACTOR_SUMMARY_2026-10-25_ROUND2.md)。

## 1. 概述

- **目标**：继续收敛前端较大文件，将列表数据、持久化读写与统计逻辑从页面 / hook 中拆出，保持对外接口与用户可见行为不变，并补充测试护栏。
- **起点**：`9a29b07`（第二轮重构总结归档，CI 全绿）。
- **终点**：`0d0ce8a`（文档同步），共 3 个提交，1 次 GitHub Actions 运行全部成功。
- **结论**：`WordbookPage` 与 `useProfileSettings` 均完成拆分；新增 1 个测试文件 / 3 个用例；无接口破坏、无依赖变更、无 schema 变更。

## 2. 实施清单

| # | 事项 | 代码提交 | 拆分前 → 拆分后 | 新增产出 |
| --- | --- | --- | --- | --- |
| 1 | WordbookPage 拆分 | `8c3981e` | `WordbookPage.tsx` 493 → 262 行 | `useWordbookList`（245 行）、`WordbookActionMenu`（82 行）、3 个冒烟测试 |
| 2 | useProfileSettings 拆分 | `12ccc09` | `useProfileSettings.ts` 453 → 246 行 | `profileSettingsStorage`（168 行）、`useProfileStats`（88 行） |
| 3 | 文档与基线同步 | `0d0ce8a` | 测试基线 / 构建体积 / 模块边界 | CHANGELOG、ARCHITECTURE、TESTING 等 8 份文档 |

## 3. 结构变化明细

### 3.1 生词本页面

- [WordbookPage.tsx](../../src/features/wordbook/pages/WordbookPage.tsx)：仅保留 store 选中态、删除 / 批量删除、Modal 编排与渲染。
- [useWordbookList.ts](../../src/features/wordbook/hooks/useWordbookList.ts)：
  - 列表数据：`items / total / hasMore / loading / loadingMore / stats`
  - 查询状态：`searchInput`（300ms 防抖 → `keyword`）、`sortBy`、`onlyFavorite`
  - 分页：首屏加载、无限滚动（`IntersectionObserver`，距视口 200px 预加载、按 id 去重）
  - 刷新：`words` 缓存事件联动、`loadFirstPage` / `refreshStats` 暴露给删除与 Modal 回调
  - 竞态保护：`mountedRef`、`offsetRef`、`queryRef`、`initializedRef`
- [WordbookActionMenu.tsx](../../src/features/wordbook/components/WordbookActionMenu.tsx)：长按菜单（立即复习 / 删除 / 取消）、Escape 关闭与背景滚动锁定。
- 新增 [WordbookPage.test.tsx](../../src/features/wordbook/pages/__tests__/WordbookPage.test.tsx)：卡片网格、空状态、全部已掌握三种渲染分支。

### 3.2 个人中心设置

- [useProfileSettings.ts](../../src/features/profile/hooks/useProfileSettings.ts)：仅保留设置表单状态、通知权限流程、AI 供应商 / Key / 模型的变更编排。
- [profileSettingsStorage.ts](../../src/features/profile/hooks/profileSettingsStorage.ts)：
  - localStorage：通知开关、供应商选择、模型名、自定义端点与模型 ID
  - secureStorage：按供应商隔离的 API Key 读写、旧版 legacy key 一次性迁移
  - 初始值读取统一委托运行时配置（`getCurrentAIProviderName` / `getCustomModelConfig`），保证表单值与实际生效值一致
- [useProfileStats.ts](../../src/features/profile/hooks/useProfileStats.ts)：阅读会话数 / 生词总数 / 掌握数 / 成就解锁与累计时长文案，`formatDuration` 一并迁入。
- 对外表面保持：`AIProviderType`、`ProfileStats`、`formatDuration`、`PronunciationSource` 仍可从 `useProfileSettings` 导入。

## 4. 兼容性保证

- **接口不变**：`WordbookPage` 无 props；`useProfileSettings` 的返回字段、类型与导出名称完全保持。
- **行为不变**：搜索防抖 300ms、分页页大小 20、按 id 去重、缓存事件重载、通知权限流程、API Key 500ms 防抖与失焦立即保存、legacy 迁移策略均按原逻辑迁移。
- **数据不变**：未修改 SQLite / Dexie schema、REST 路由或 localStorage key。
- **依赖不变**：未新增任何运行时或开发依赖。

## 5. 验证结果

| 项目 | 结果 |
| --- | --- |
| 前端 typecheck | 通过 |
| ESLint | 通过（仅保留 ReadingPage 既有的 1 条 ref cleanup 告警） |
| 前端单元测试 | 63 → **64 文件 / 725 用例**（净增 1 文件 / 3 用例） |
| 服务端单元测试 | 18 文件 / 216 用例通过 |
| 生产构建 | 通过；全部 JS 1,651,810 bytes / gzip 约 435 KB |
| PWA 预缓存 | 45 entries / 1709.39 KiB |
| Playwright dev E2E | 10 / 10 通过（含生词本添加流程） |
| Playwright 生产 SW E2E | 1 / 1 通过 |
| GitHub Actions | [run 40190189807](https://github.com/zhongxingma/ydxl/actions/runs/40190189807) 5 个 job 全部成功 |

## 6. 文档同步

- `CHANGELOG.md`：新增 2 条 Changed 记录，测试基线更新为 64 文件 / 725 用例（合计 941）。
- `docs/ARCHITECTURE.md`：补充生词本页面与个人中心设置的模块边界。
- `docs/TESTING.md`：新增 `WordbookPage.test.tsx` 条目，文件与用例计数同步。
- `README.md` / `docs/README.md` / `docs/CODING_STANDARDS.md` / `docs/MULTI_USER_DESIGN.md`：测试基线统一。
- `docs/TECHNICAL_ANALYSIS.md`：按最新产物更新 WordbookPage / ProfilePage chunk 与合计体积。

## 7. 风险与遗留

| 项目 | 说明 | 建议 |
| --- | --- | --- |
| `baseProvider.ts`（1015 行） | 业务编排集中，已拆分传输层 | 无新增需求前不再拆 |
| `requestRunner.ts`（685 行） | 传输层单一职责 | 保持现状 |
| `cachedRemoteRepository.ts`（503 行） | 缓存策略内聚 | 保持现状 |
| `WordCard.tsx`（462 行） | 单词卡片交互集中 | 可作为下一轮候选 |
| `useQuizRunner.ts`（456 行） | 阅读答题流程集中 | 暂不拆 |
| Wordbook 测试深度 | 仅 3 个渲染分支冒烟用例，交互细节依赖 E2E | 后续可补充分页 / 删除用例 |
| profile 测试的 act 警告 | 统计异步加载产生的既有测试告警模式 | 非本轮引入，可按需改为 `waitFor` |

## 8. 提交记录

| 提交 | 类型 | 说明 |
| --- | --- | --- |
| `8c3981e` | refactor | WordbookPage 列表逻辑与操作菜单拆分 |
| `12ccc09` | refactor | useProfileSettings 存储与统计逻辑拆分 |
| `0d0ce8a` | docs | 同步生词本与个人中心拆分说明 |

## 9. 结论

本轮完成后，生词本页面与个人中心设置 hook 均降至约 250 行，职责边界清晰；对外导出与行为保持一致，测试与 CI 全绿。前端剩余较大文件主要集中在 AI 传输 / 业务编排与单词卡片组件，后续可按实际需求再评估。
