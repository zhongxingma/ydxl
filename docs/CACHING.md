# 缓存架构文档

本文档描述 ydxl 项目的多层缓存体系，包括各层职责、TTL 策略、失效规则与存储上限。

## 架构概览

ydxl 采用 **三层缓存架构**，各层职责分离、协同工作：

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: AI Response Cache (responseCache)                 │
│  内存 LRU (100 条) + IndexedDB aiCache（永久缓存 + LRU）     │
│  适用：确定性 AI 调用结果（单词查询、拼读分解、emoji 助记）   │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Dexie SWR Cache (CachedRemoteRepository)          │
│  IndexedDB 本地优先读取 + 后台静默刷新                       │
│  适用：articles / questions / words / reviews / stats 等     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Cache Event Bus (cacheEvents)                     │
│  跨组件 UI 同步通知（写入后广播，订阅者重读本地缓存）         │
│  适用：所有跨页面数据变更场景                                 │
└─────────────────────────────────────────────────────────────┘
```

## Layer 1: AI Response Cache

**文件**：`src/shared/services/ai/responseCache.ts`

### 设计目标
对 **确定性** AI 调用结果做二级缓存（内存 LRU + IndexedDB），避免重复请求。仅适用于相同输入必然产生相同输出的场景。

> **2026-08-30 迁移说明**：持久化层由 localStorage（约 5MB 上限）迁移到 Dexie/IndexedDB 的 `aiCache` 表（schema v7 新增），容量大幅提升，全部确定性场景统一为**永久缓存**（`ttlMs = Infinity`）；淘汰机制从「TTL 过期」改为「LRU（按 `updatedAt` 最久未写入优先淘汰）」，避免 IndexedDB 无限制增长。

### 缓存 Key 格式
```
${scenario}[:${variant}]|${model}|${sha256(system+user)}
```
- `scenario`：场景标识，防止不同场景结果混淆
- `variant`（可选）：请求形态变体（如数组类场景跳过 `json_object` 后响应形态不同，传 `array` 与旧缓存隔离，避免命中 json_object 时代的坏响应）
- `model`：模型名，防止跨模型污染（v4-pro 与 v4-flash 结果可能不同）
- `sha256(system+user)`：确保同输入同 key

### 二级结构

| 层级 | 存储 | 容量 | 命中策略 |
|------|------|------|----------|
| 内存 LRU | `Map`（插入顺序） | 100 条 | 命中时 delete + set 移到末尾 |
| IndexedDB | Dexie `aiCache` 表（主键 id = 缓存 key） | 按场景上限 | 永久缓存 + LRU 淘汰（`updatedAt` 升序） |

### Scenario 与缓存策略

| Scenario | 用途 | TTL | 上限 | 清理规则 |
|----------|------|-----|------|----------|
| `wordLookup` | 单词查词（AI enrichment） | 永久 | 500 条 | LRU 淘汰（`enforceScenarioLimit`） |
| `wordBreakdown` | 单词拼读分解 | 永久 | - | 仅存储紧张紧急清空时移除 |
| `emojiHint` | emoji 助记 | 永久 | - | 仅存储紧张紧急清空时移除 |
| `wordCompletion` | 单词补全 | 永久 | - | 仅存储紧张紧急清空时移除 |

> **注**：永久缓存使用 `PERMANENT_EXPIRES_AT = Number.MAX_SAFE_INTEGER` 哨兵，规避 `JSON.stringify(Infinity)` 变为 `null` 的问题；`cleanupExpired()` 仅清理显式设置过 TTL 的过期项，永久项不受影响。

### 不适用场景
以下场景**不缓存**（每次请求必然产生新结果）：
- 文章生成（每次生成新内容，`avoidTopics` 已在 prompt 层防重）

> 题目生成 / 语法填空 / 词汇提取 / 短语提取**已纳入永久缓存**（2026-08-30 起）：以文章内容为 key（`sha256(system+user)`），同文章零 token 复用，不同文章自然生成新 key，无需失效机制。

### 容错策略
- IndexedDB 不可用 / 损坏 / 配额满：按未命中处理，降级为纯内存缓存，不抛错
- JSON 解析失败：清理损坏条目，按未命中处理
- 内存数据损坏（理论不应发生）：删除后降级到 IndexedDB 读取

## Layer 2: Dexie SWR Cache

**文件**：`src/shared/services/remoteRepository.ts`、`src/shared/services/repositories.ts`

### 设计目标
**本地优先（Local-First）**：读取时优先返回本地缓存，后台静默刷新；写入时先写服务器，成功后同步本地缓存。实现零 API 二次打开与离线访问。

### 数据表与索引

| 表 | 索引字段 | 数量上限 | 清理规则 |
|----|----------|----------|----------|
| articles | `id`, `updated_at`, `contentHash`, `readAt` | 500 | 仅清理未读重复，保留所有已读 |
| questions | `id`, `articleId`, `updated_at` | 1000 | 按 `updated_at` 升序清理最旧 |
| words | `id`, `word`, `updated_at`, `mastery` | - | 核心数据，不清理 |
| reviews | `id`, `updated_at`, `reviewedAt` | - | 核心数据，不清理 |
| stats | `id`, `updated_at` | - | 核心数据，不清理 |
| readingSessions | `id`, `updated_at` | - | 核心数据，不清理 |
| achievements | `id`, `updated_at` | - | 核心数据，不清理 |

### SWR 读取流程

```
getAllLocalFirst() / getByIdLocalFirst(id)
  │
  ├─ 1. 读取本地 Dexie 缓存
  │     ├─ 有数据 → 立即返回 + triggerBackgroundRefresh()
  │     └─ 无数据 → 同步等待 remote 拉取（避免空状态闪烁）
  │
  └─ 2. 后台静默刷新（triggerBackgroundRefresh）
        ├─ 30 秒节流（避免短时间内重复刷新）
        ├─ 并发去重（inflightRequests Map）
        ├─ 增量更新（基于 updated_at，避免不必要写入）
        └─ 完成后通过 cacheEvents 广播通知
```

### 写入流程

```
add() / update() / delete()
  │
  ├─ 1. 写入远程服务器
  ├─ 2. 成功后同步写入本地 Dexie 缓存
  ├─ 3. 通过 cacheEvents 广播通知（触发 UI 重读）
  └─ 4. 远程 404 时降级写入本地缓存（保证 UI 可见）
```

### 高效查询方法

`Repository` 类提供以下基于 Dexie 索引的查询方法，**避免全表扫描**：

| 方法 | 用途 | 索引使用 |
|------|------|----------|
| `whereEquals(field, value)` | 精确匹配 | ✅ 索引查询 |
| `whereEqualsFiltered(field, value, filter)` | 精确匹配 + 内存过滤 | ✅ 索引查询 |
| `whereBetween(field, lower, upper)` | 范围查询 | ✅ 索引查询 |
| `whereAbove(field, value)` | 大于查询 | ✅ 索引查询 |
| `whereAboveOrEqual(field, value)` | 大于等于查询 | ✅ 索引查询 |
| `whereBelowOrEqual(field, value)` | 小于等于查询 | ✅ 索引查询 |
| `countWhereAbove(field, value)` | 大于计数 | ✅ 索引 count |
| `countWhereBelowOrEqual(field, value)` | 小于等于计数 | ✅ 索引 count |
| `getRecent(limit)` | 最近 N 条 | ✅ `updated_at` 索引倒序 |
| `getById(id)` | 主键查询 | ✅ 主键查询 |

> **禁止**：`getAll().filter(...)` 全表扫描模式。对于非索引字段的过滤，先 `whereEquals` 缩小范围再内存过滤。

## Layer 3: Cache Event Bus

**文件**：`src/shared/services/cacheEvents.ts`、`src/shared/hooks/useCacheInvalidated.ts`

### 设计目标
跨组件 UI 同步：当某表数据变更（写入或后台刷新完成），广播事件通知所有订阅该表的组件重读本地缓存。

### 事件订阅

```typescript
// 订阅 articles 表的缓存失效事件
useCacheInvalidated('articles', () => {
  // 重读当前文章（后台刷新可能更新了 translation/phrases）
  void reloadCurrentArticle()
})

// 订阅 words 表的缓存失效事件
useCacheInvalidated('words', () => {
  void loadFirstPage()
  void refreshStats()
})
```

### 已订阅的页面

| 页面 | 订阅事件 | 触发场景 |
|------|----------|----------|
| `ReadingPage` | `articles` | 后台刷新文章后重读当前文章 |
| `WordbookPage` | `words` | 生词本变更后重载列表与统计 |
| `MasteredPage` | `words` | 已掌握单词变更后重载列表 |
| `HistoryPage` | `articles` | 历史记录变更后重载 |
| `StatsPage` | `articles` / `readingSessions` | 统计数据变更后重载 |
| `DashboardPage` | `articles` / `words` / `reviews` | 首页数据变更后重载 |

### ReadingPage 的竞态保护
`ReadingPage` 的 `articles` 事件回调包含多重守卫，防止历史文章选择竞态：
- `status === 'loading'` 时跳过（加载中不干扰）
- `fresh.id !== currentArticle.id` 时跳过（文章已切换）
- `fresh.id !== articleId` 时跳过（URL 参数为源真相）
- `fresh.updated_at <= currentArticle.updated_at` 时跳过（避免 stale 覆盖）

## 单词查词 4 级缓存

**文件**：`src/features/reading/services/wordLookup.ts`

划词查词按以下顺序查询，命中即返回，未命中逐级降级：

```
lookupWord(text)
  │
  ├─ Tier 1: LOCAL_DICT（内存，20 个高频词）
  │   └─ 命中 → 立即返回（零开销）
  │
  ├─ Tier 2: wordRepository.whereEquals('word', text)
  │   └─ 命中 → 返回 wordbook 中的 phonetic/pos/definition/example（零 API）
  │
  ├─ Tier 3: responseCache（scenario='wordLookup'）
  │   └─ 命中 → 返回之前 AI enrichment 的结果（零 API）
  │
  └─ Tier 4: aiProvider.enrichSingleWord(text)
      ├─ 调用 AI 生成音标/词性/释义/例句
      ├─ 写入 responseCache（永久缓存，scenario='wordLookup'，500 条 LRU 上限）
      └─ 返回结果（首次查询后后续命中 Tier 3）
```

## 存储维护策略

**文件**：`src/shared/services/storageManager.ts`

### 触发时机
1. **应用启动时**（`main.tsx`）：
   - 立即调用 `cleanupExpired()` 清理上次会话遗留的过期 AI 缓存
   - 延迟 5 秒调用 `runStorageMaintenance()` 执行完整维护
2. **Dexie 写入 QuotaExceededError 时**：
   - 触发 `cleanupDerivedData()` 紧急清理后重试一次
3. **存储使用率 > 85% 时**：
   - `runStorageMaintenance()` 触发完整清理流程

### 清理规则

| 数据类别 | 清理条件 | 保留策略 |
|----------|----------|----------|
| **核心数据**（articles/words/reviews/stats/sessions/achievements） | 永不主动清理 | 用户主动产生，仅在数量超限时按 updated_at 淘汰 |
| **派生数据**（questions） | 30 天未更新 | 按 `updated_at` 升序清理 |
| **vocab 缓存**（`ydxl-vocab-*`） | 触发清理时全清 | 可由 AI 重新生成 |
| **AI 响应缓存**（IndexedDB `aiCache` 表） | 过期项清理（确定性场景为永久缓存，通常不受影响） | 存储紧张时紧急清空（可重建） |
| **wordLookup 缓存** | 500 条上限 | 按 `updatedAt` 升序 LRU 淘汰 |

### 紧急清理（存储紧张时）
当 `isStorageLow()` 返回 true（usageRatio > 0.85）：
1. `cleanupDerivedData()`：清理过期 questions + vocab 缓存 + AI 缓存过期项 + wordLookup 上限
2. `enforceQuestionLimit(1000)`：强制 questions 表 1000 条上限
3. `enforceArticleLimit(500)`：强制 articles 表 500 条上限（仅清理未读重复）
4. `clearCache()`：紧急清空全部 AI 响应缓存（可由下次调用重建）

## HTTP 缓存策略

**文件**：`server/src/ai-proxy.ts`

AI 代理响应统一设置禁用 HTTP 缓存头：
```
Cache-Control: no-cache, no-store, must-revalidate
Pragma: no-cache
Expires: 0
```

**原因**：
- AI 响应由前端 `responseCache` 显式管理（内存 LRU + IndexedDB `aiCache`），与 HTTP 缓存层职责分离
- 避免双层缓存（HTTP 缓存 + responseCache）导致不一致
- 429 限流响应同样禁用缓存，避免重试逻辑读取过期响应

## 缓存失效规则汇总

| 场景 | 失效方式 |
|------|----------|
| 用户添加生词 | 写入 words 表 → `cacheEvents.broadcast('words')` → WordbookPage/MasteredPage 重载 |
| 用户标记文章已读 | 更新 articles 表 → `cacheEvents.broadcast('articles')` → ReadingPage/HistoryPage 重载 |
| 后台 SWR 刷新完成 | 增量写入本地 → `cacheEvents.broadcast(tableName)` → 订阅页面重读 |
| 单词查词 AI enrichment | 写入 responseCache（永久缓存 + 500 条 LRU 上限）→ 后续查询命中缓存 |
| 存储紧张 | `runStorageMaintenance()` 触发清理 → 核心数据保留，派生数据按规则清理 |

## 性能指标

| 指标 | 目标 | 实现方式 |
|------|------|----------|
| 二次打开页面 API 请求数 | 0 | SWR 本地优先 + responseCache 命中 |
| 后台刷新节流 | 30 秒 | `triggerBackgroundRefresh` 节流 |
| 并发去重 | 同 key 单次 in-flight | `inflightRequests` Map |
| 内存 LRU 上限 | 100 条 | `MEMORY_LRU_MAX` |
| wordLookup 上限 | 500 条 | `enforceScenarioLimit` |
| articles 上限 | 500 条 | `enforceArticleLimit` |
| questions 上限 | 1000 条 | `enforceQuestionLimit` |
| 存储清理触发阈值 | 85% | `isStorageLow` |
