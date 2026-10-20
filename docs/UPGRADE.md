# 生产环境升级手册

> 适用范围：英语学习 PWA 应用的功能新增、Bug 修复、Prompt 调整、数据结构变更等生产环境更新操作。
>
> 核心原则：**升级只动代码与派生缓存，绝不触碰用户历史源数据。**

---

## 一、数据架构总览

升级前必须理解三层存储的职责，才能判断"动什么、不动什么"。

### 第 1 层：用户源数据（IndexedDB，**禁止清空**）

数据库名 `ydxl-db`，由 Dexie.js 封装，当前 schema 版本 v7。共 8 张表（7 张业务表 + 1 张 AI 响应缓存表）：

| 表名 | 用途 | 主键 | 是否可重新生成 |
|------|------|------|----------------|
| `articles` | 文章（含 phrases/vocabulary/highlightedWords/contentHash/readAt） | id（日期串） | ❌ 不可清（用户阅读历史） |
| `words` | 生词本 | word | ❌ 不可清（用户收藏） |
| `reviews` | 复习记录 | `${wordId}-${step}-${ts}` | ❌ 不可清（学习进度） |
| `stats` | 学习统计 | id | ❌ 不可清（累计数据） |
| `readingSessions` | 阅读会话 | id | ❌ 不可清（历史记录） |
| `achievements` | 成就解锁 | id | ❌ 不可清（荣誉记录） |
| `questions` | 练习题 | `${articleId}-${n}` | ✅ 可清（由文章重新调 AI 生成） |
| `aiCache` | AI 响应缓存（v7 新增，突破 localStorage 5MB 上限） | 缓存 key | ✅ 可清（重新调 AI 生成，消耗 token） |

> ⚠️ **关键区分**：`articles` 是**源数据**（用户阅读的成果），`questions` / `aiCache` 是**派生缓存**（可由 article 重新生成）。清空 `questions` / `aiCache` 不会丢失阅读历史，只会触发重新出题（消耗 token）；清空 `articles` 会丢失全部阅读记录。

### 第 2 层：AI 响应缓存（Dexie aiCache 表 + localStorage 遗留，**按需清理**）

- 主存储：Dexie `aiCache` 表（v7 起，两级缓存：内存 LRU + Dexie）
- 遗留兼容：旧版本 localStorage 键前缀 `ydxl-ai-cache-`（键格式 `ydxl-ai-cache-${scenario}|${model}|${sha256(system+user)}`），升级后新写入走 aiCache 表
- TTL：v7（2026-08-30）起全部确定性场景统一为永久缓存（`ttlMs = Infinity`），淘汰机制为 LRU（按 `updatedAt` 最久未写入优先），见 CACHING.md
- 缓存内容：AI 返回的题目、词汇、短语、单词拆解、补全等结果
- 清理影响：下次调用会重新请求 AI（消耗 token），不丢任何用户数据

### 第 3 层：PWA 资源缓存（Service Worker，**每次升级必须更新**）

- `dist/sw.js`：由 `vite-plugin-pwa` 生成，`registerType: 'autoUpdate'`
- 预缓存：`**/*.{js,css,html,ico,png,svg}`
- **陷阱**：SW 会缓存旧 JS bundle，即便服务器更新了 `dist/`，客户端仍可能加载旧代码
- 更新方式：unregister SW + 关闭所有标签页后重新打开

### 服务器端

- SQLite 数据库（`better-sqlite3`）+ Express（端口 3001）
- 数据落盘以服务器为主，Dexie 作为离线只读缓存
- 升级若涉及 server 代码，需重启 server 进程

---

## 二、改动类型分类与决策树

升级前先判断改动属于哪类，决定清理范围：

```
本次改动涉及什么？
│
├─ A. 纯前端 UI/逻辑（组件、样式、页面交互）
│   → 只需 rebuild + 部署 + SW 更新，不清任何数据
│
├─ B. AI Prompt 修改（prompts.ts 中 system/user 指令变化）
│   → rebuild + 部署 + SW 更新
│   → 清 questions 表（旧题目按旧 prompt 生成，需重新出题）
│   → 清 localStorage AI 缓存（ydxl-ai-cache- 前缀）
│   → 不动 articles/words/reviews 等源数据
│
├─ C. 数据结构/Schema 变更（增删字段、改索引）
│   → Dexie 版本迁移：db.ts 新增 version(N+1).stores({...})
│   → rebuild + 部署 + SW 更新
│   → 不需要清表（Dexie 自动迁移数据行，只重建索引）
│   → 若是破坏性变更（如改主键），必须先备份导出
│
└─ D. 新增功能模块（新页面、新路由，不改现有逻辑）
    → rebuild + 部署 + SW 更新
    → 不清任何数据（新功能读现有数据，无历史缓存冲突）
```

---

## 三、标准升级流程（通用步骤）

适用于所有改动类型，按顺序执行：

### 3.1 升级前准备

```bash
# 1. 确认当前在稳定分支，工作区干净
git status

# 2. 拉取最新代码（或切换到待发布分支）
git checkout <release-branch>
git pull

# 3. 【可选但推荐】升级前备份服务器 SQLite
cp /var/lib/ydxl/data.db /var/lib/ydxl/data.db.bak.$(date +%Y%m%d%H%M)
```

### 3.2 构建

```bash
# 安装依赖（如 package.json 有变更）
npm ci

# 类型检查 + 构建
npm run typecheck
npm run build
# 产物在 dist/

# 如涉及后端
cd server && npm ci && npm run build && cd ..
```

### 3.3 部署（Linux）

```bash
# 1. 部署前端静态资源到 web 服务器目录
rsync -av --delete dist/ /var/www/ydxl/

# 2. 重启后端（如后端有变更）
pm2 restart ydxl-server   # 或 systemctl restart ydxl-server

# 3. 验证服务可用
curl -s http://localhost:3001/health || echo "后端异常"
curl -s -o /dev/null -w "%{http_code}" http://localhost/  # 前端
```

### 3.4 客户端缓存清理（按改动类型，见第四节）

### 3.5 验证（见第六节清单）

---

## 四、缓存清理操作手册

### 何时需要清理

| 改动类型 | 清 questions 表 | 清 AI 缓存 | 更新 SW |
|----------|:---------------:|:----------:|:-------:|
| A. 纯 UI/逻辑 | ❌ | ❌ | ✅ |
| B. Prompt 修改 | ✅ | ✅ | ✅ |
| C. Schema 变更 | ❌ | ❌ | ✅ |
| D. 新增功能 | ❌ | ❌ | ✅ |

### 客户端清理脚本（浏览器 F12 → Console 执行）

> 首次粘贴需先在 Console 输入 `allow pasting` 回车，解除浏览器 self-XSS 保护。

**仅清 questions 表（Prompt 修改时用）**：

```js
(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ydxl-db')
    r.onsuccess = e => res(e.target.result)
    r.onerror = () => rej(r.error)
  })
  const tx = db.transaction('questions', 'readwrite')
  tx.objectStore('questions').clear()
  await new Promise(res => { tx.oncomplete = () => { db.close(); res() } })
  console.log('✓ questions 表已清空')
})()
```

**清 AI 响应缓存（localStorage）**：

```js
;(() => {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('ydxl-ai-cache-')) keys.push(k)
  }
  keys.forEach(k => localStorage.removeItem(k))
  console.log(`✓ AI 缓存已清空（${keys.length} 条）`)
})()
```

**更新 Service Worker（每次升级必做）**：

```js
;(async () => {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    for (const r of regs) await r.unregister()
    console.log(`✓ 已 unregister ${regs.length} 个 service worker`)
  }
  console.log('⚠ 请关闭所有应用标签页后重新打开')
})()
```

**一键全清理（B 类改动用）**：

```js
(async () => {
  // 1. 清 AI 缓存
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('ydxl-ai-cache-')) keys.push(k)
  }
  keys.forEach(k => localStorage.removeItem(k))
  // 2. 清 questions 表
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ydxl-db')
    r.onsuccess = e => res(e.target.result)
    r.onerror = () => rej(r.error)
  })
  if (db.objectStoreNames.contains('questions')) {
    const tx = db.transaction('questions', 'readwrite')
    tx.objectStore('questions').clear()
    await new Promise(res => { tx.oncomplete = () => res() })
  }
  db.close()
  // 3. unregister SW
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    for (const r of regs) await r.unregister()
  }
  console.log(`✓ 清理完成：AI缓存 ${keys.length} 条 / questions 表 / SW`)
  console.log('⚠ 请关闭所有标签页后重新打开应用')
})()
```

> ⚠️ **绝对不要**执行 `indexedDB.deleteDatabase('ydxl-db')`——这会删除整个数据库（含 articles/words/reviews 等全部历史数据）。除非有意重置全部数据。

---

## 五、Dexie Schema 变更规范（C 类改动）

新增字段或索引时，**必须新增版本号**，不可修改旧版本：

```ts
// db.ts —— 在现有最高版本（当前 v7）之后追加 v8
this.version(7).stores({
  // ...原有定义保持不变（全部 8 张表）
})

// 新增 v8：给 articles 表加一个索引
// ⚠️ 项目约定：新版本必须重新声明全部已有表的 schema（与 db.ts 现有 v1-v7 写法一致），
// 未声明的表会被当作删除处理
this.version(8).stores({
  articles: 'id, genre, createdAt, updated_at, contentHash, readAt, startedAt, newFieldIndex',
  questions: 'id, articleId, type, createdAt, updated_at',
  words: 'id, word, sourceArticleId, mastery, nextReview, updated_at, favorite',
  reviews: 'id, wordId, step, reviewedAt, updated_at',
  stats: 'id, updated_at',
  readingSessions: 'id, articleId, reviewedAt, updated_at',
  achievements: 'id, updated_at',
  aiCache: 'id, scenario, updatedAt',
})
```

**规则**：
- ✅ 只新增 version，不改旧 version 的 stores 定义
- ✅ 新版本的 `stores()` **重新声明全部表的 schema**（复制上一版本定义、追加新索引）
- ✅ 新增索引/字段：Dexie 自动建索引，数据行不动，**无需数据迁移**
- ⚠️ 删除索引：从 stores 字符串中移除即可，数据行不受影响
- ❌ **禁止**修改主键（如把 articles 主键从 id 改成别的）——这会丢数据，需先导出再导入

> 版本演进历史（v1 → v7）与当前各表索引全表见 [DATABASE.md](./DATABASE.md) 4.2 / 4.3 节。

---

## 六、升级验证清单

部署后逐项验证：

- [ ] 应用可访问（前端返回 200）
- [ ] 后端 `/health` 正常
- [ ] 新功能/修复点按预期工作（手动走一遍核心流程）
- [ ] 历史数据完好：首页「最近阅读」有记录、生词本有单词、复习页有进度
- [ ] 控制台无红色错误（F12 → Console）
- [ ] 移动端布局正常（响应式）
- [ ] 暗色模式下显示正常

---

## 七、回滚方案

### 代码回滚

```bash
# 回滚到上一个稳定版本
git checkout <previous-stable-commit>
npm ci && npm run build
rsync -av --delete dist/ /var/www/ydxl/
pm2 restart ydxl-server

# 客户端需再次 unregister SW + 重开标签页
```

### 数据回滚（仅当 schema 迁移破坏数据时）

```bash
# 用升级前备份恢复服务器 SQLite
systemctl stop ydxl-server
cp /var/lib/ydxl/data.db.bak.<timestamp> /var/lib/ydxl/data.db
systemctl start ydxl-server
```

> 客户端 IndexedDB 是服务器数据的缓存，服务器恢复后客户端会逐步同步。若客户端数据与服务器冲突异常，可清空客户端 IndexedDB 重新同步（会重新拉取服务器数据，不丢失服务器侧记录）。

---

## 八、常见陷阱

### 陷阱 1：改了代码但用户看不到效果
**原因**：PWA Service Worker 缓存了旧 JS bundle。
**解决**：每次升级后，告知用户关闭所有标签页重新打开；或在 Console 执行 unregister SW 脚本。

### 陷阱 2：改了 Prompt 但题目还是旧内容
**原因**：三层缓存叠加——IndexedDB questions 表存了旧题目（命中不调 AI）+ localStorage AI 缓存 + SW 旧代码。
**解决**：执行第四节"一键全清理"脚本，三步缺一不可。

### 陷阱 3：build 部署模式下改源码不生效
**原因**：dev 模式有 HMR 热更新，但 build 部署模式必须重新 `npm run build` 才能让改动进入 `dist/` 产物。
**解决**：改源码后必须 rebuild + 重新部署 dist/。

### 陷阱 4：浏览器 Console 禁止粘贴脚本
**原因**：Chrome/Edge 的 self-XSS 保护。
**解决**：先在 Console 手动输入 `allow pasting` 回车，再粘贴脚本。

### 陷阱 5：清错表导致数据丢失
**原因**：误执行 `indexedDB.deleteDatabase('ydxl-db')` 或清了 articles 等源数据表。
**解决**：严格按第四节的脚本，只清 `questions` 表和 `ydxl-ai-cache-` 前缀。源数据表（articles/words/reviews/stats/readingSessions/achievements）永远不清。

---

## 九、快速参考卡

| 场景 | 操作 |
|------|------|
| 改前端组件/样式 | `npm run build` → 部署 dist/ → 用户重开标签页 |
| 改 AI Prompt | rebuild → 部署 → Console 执行"一键全清理"脚本 → 重开标签页 |
| 加新功能页面 | rebuild → 部署 → 用户重开标签页（不清数据） |
| 改数据库索引 | db.ts 加 version(N+1) → rebuild → 部署 → 重开标签页 |
| 紧急回滚 | git checkout 旧版 → rebuild → 部署 → 重开标签页 |
| 修后端 Bug | cd server && npm run build → pm2 restart → 不需要清客户端 |
