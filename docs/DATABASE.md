# 数据库设计文档

本文档完整描述 `ydxl` 应用的数据库设计：服务器端 SQLite（权威数据源）与前端 Dexie.js（IndexedDB 离线缓存）的全部表结构、字段、索引、迁移与安全机制。字段定义来源：`server/src/db.ts`（服务器 SQLite）与 `src/shared/services/db.ts`（前端 Dexie）。

> ER 实体关系图见 [ER_DIAGRAM.md](./ER_DIAGRAM.md)；REST CRUD 行为见 [API_REFERENCE.md](./API_REFERENCE.md)；备份与监控见 [OPERATIONS.md](./OPERATIONS.md)。

## 1. 存储架构总览

| 维度 | 服务器 SQLite | 前端 Dexie（IndexedDB） |
| --- | --- | --- |
| 引擎 | better-sqlite3（同步绑定，WAL 模式） | Dexie.js 4（IndexedDB 封装） |
| 数据库名 / 文件 | `server/data/ydxl.db`（运行时自动创建目录） | `ydxl-db`（浏览器内） |
| 角色 | **唯一权威数据源**（写入仅落服务器） | **离线只读缓存**（服务器读取成功后同步） |
| 表数量 | 12 张（7 张业务表 + users / sessions / user_article_states / schema_meta / operation_logs） | 8 张（7 张业务表 + `aiCache` 缓存表），schema 保持 v8 |
| 可否离线 | —（服务器不可达时前端整体回退） | 断网时支撑只读浏览 |
| 反向同步 | 无（Dexie 不回写服务器） | 无 |

**数据同步方向**：前端 → localApi（fetch）→ Express REST → SQLite；读取成功后异步同步到 Dexie 缓存（`CachedRemoteRepository.shouldUpdate` 按 `updated_at` 比较，仅更新较新记录）；fetch 失败时回退 Dexie 读取。`aiCache` 是唯一纯前端写入的表（AI 响应永久缓存）。

## 2. 命名与类型约定

- **字段命名**：除 `updated_at` 保留 snake_case（与前端 `BaseEntity` 类型定义对齐）外，其余字段均为 camelCase；表名同样为 camelCase（如 `readingSessions`）。两端 schema 完全一致，**无字段映射转换**。
- **类型映射**：

| SQLite 类型 | TypeScript 类型 | 说明 |
| --- | --- | --- |
| `TEXT` | `string`（或 JSON 序列化后的 object/array） | 主键 id 亦为 TEXT |
| `INTEGER` | `number` | 时间戳均为毫秒级（`Date.now()`）；boolean 序列化为 `0`/`1` |
| `REAL` | `number` | 浮点数（`easeFactor`、`correctRate`） |

- **时间戳字段**：`createdAt`、`updatedAt`、`nextReview`、`lastReview`、`reviewedAt`、`unlockedAt`、`readAt`、`startedAt` 等均为 INTEGER 毫秒时间戳。`updated_at` 由 Express 在 POST / PUT 时自动填充（客户端无需传）。

## 3. 服务器 SQLite（权威存储）

### 3.1 运行参数

| 项 | 值 | 来源 |
| --- | --- | --- |
| 数据库路径 | `server/data/ydxl.db`（相对 `server/dist` 或 `server/src` 解析） | `DB_PATH` 可覆盖；`DB_PATH=:memory:` 或 `NODE_ENV=test` 时使用内存库（保护生产数据） |
| 日志模式 | WAL（`journal_mode = WAL`） | 提升并发读性能 |
| 写锁等待 | `busy_timeout = 5000`（5s） | 并发写排队缓冲，避免 `SQLITE_BUSY` 直接失败 |
| 初始化 | 启动时执行 `CREATE TABLE IF NOT EXISTS` + 增量迁移 | `server/src/db.ts` |

### 3.2 表清单

| 表 | 实体 | 主键格式 | 共享 / 私有 | 职责 |
| --- | --- | --- | --- | --- |
| `articles` | Article | `YYYY-MM-DD` | 共享 | AI 生成的每日阅读文章（含翻译、词汇、短语、去重指纹）；阅读状态剥离至 user_article_states |
| `questions` | Question | `${articleId}-${n}` | 共享 | 阅读理解题 + 语法填空题（AI 生成一次全站使用） |
| `words` | Word | 单词本身（存储形态 `${userId}:单词`） | 私有 | 生词本（SM-2 复习调度字段在此表） |
| `reviews` | Review | `${wordId}-${step}-${timestamp}`（存储加 `userId:` 前缀） | 私有 | 五步背诵的逐次复习流水 |
| `stats` | Stats | `YYYY-MM-DD`（存储加 `userId:` 前缀） | 私有 | 按日聚合的学习统计 |
| `readingSessions` | ReadingSession | `${articleId}-${timestamp}` 或 UUID（存储加 `userId:` 前缀） | 私有 | 单次阅读会话（用时/正确率） |
| `achievements` | Achievement | 成就规则 ID（存储加 `userId:` 前缀） | 私有 | 已解锁成就 |
| `users` | AuthUser | UUID（`crypto.randomUUID`） | 系统 | 登录账号（用户名唯一、scrypt 密码哈希、登录锁定计数） |
| `sessions` | — | 256 位随机 hex 令牌 | 系统 | 登录会话（7 天滑动过期、可即时吊销、改密/禁用全端失效） |
| `user_article_states` | — | `userId + articleId`（复合主键） | 系统 | 每用户的文章阅读状态（readAt / startedAt） |
| `schema_meta` | — | key（如 `multi_user_migrated`） | 系统 | 迁移幂等标记（key-value） |

**多用户存储形态（P0 已实施）**：

- 五张私有表（words / reviews / stats / readingSessions / achievements）每行携带 `userId` 列（归属用户；服务端在 POST / PUT 时强制覆盖，忽略客户端传值），存储主键统一为 `${userId}:${业务 id}`，`reviews.wordId` 引用列同样带前缀。REST 响应时剥离前缀并删除 `userId` 字段，前端实体形态与单用户时代完全一致（前端零改动）。
- 共享表（articles / questions）无 userId 列，行内阅读状态 `readAt` / `startedAt` 改存 user_article_states，articles 路由在读写时按当前用户合并；`DELETE /api/articles/:id` 同步清理全部用户的阅读状态。

### 3.3 字段详表

> 下文字段详表为 **REST 响应 / 前端实体视角**：业务 id 不带前缀、不含 userId（服务端在响应层剥离）。SQLite 存储层的多用户映射规则见 3.2「多用户存储形态」。

#### articles（文章）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 日期字符串 `YYYY-MM-DD` |
| `title` | TEXT NOT NULL | 文章标题 |
| `content` | TEXT NOT NULL | 英文正文 |
| `translation` | TEXT | 中文全文翻译 |
| `genre` | TEXT | 文体（narrative / expository / practical / argumentative） |
| `wordCount` | INTEGER | 词数 |
| `createdAt` | INTEGER | 创建时间（毫秒） |
| `updated_at` | INTEGER | 更新时间（服务端自动填充） |
| `topic` | TEXT | 题材 |
| `difficulty` | TEXT | 难度（easy / medium / hard） |
| `lexileRange` | TEXT | 蓝思值区间 JSON `{ min, max }` |
| `highlightedWords` | TEXT | AI 预标注重点生词 JSON 数组 `HighlightedWord[]` |
| `contentHash` | TEXT | 内容指纹（SHA-256(标题+正文) 前 16 位），去重用 |
| `readAt` | INTEGER | 完成阅读时间戳（已读历史）；实际按用户存于 user_article_states，API 响应时按当前用户合并 |
| `startedAt` | INTEGER | 开始阅读时间戳；实际按用户存于 user_article_states，API 响应时按当前用户合并 |
| `phrases` | TEXT | 重点短语 JSON 数组 `ArticlePhrase[]` |
| `vocabulary` | TEXT | 重点词汇 JSON 数组 `ArticleVocabulary[]` |

#### questions（题目）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `${articleId}-${n}` |
| `articleId` | TEXT | 所属文章 id（应用层关联，无外键约束） |
| `type` | TEXT | 题型（阅读理解 / 语法填空） |
| `stem` | TEXT | 题干 |
| `options` | TEXT | 选项 JSON 数组（4 元素字符串数组） |
| `correctIndex` | INTEGER | 正确选项下标 |
| `explanation` | TEXT | 解析 |
| `locationClue` | TEXT | 原文定位线索 |
| `createdAt` / `updated_at` | INTEGER | 时间戳 |

#### words（生词本）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 单词本身 |
| `word` | TEXT | 单词拼写 |
| `phonetic` | TEXT | 音标 |
| `pos` | TEXT | 词性 |
| `definition` | TEXT | 释义 |
| `example` | TEXT | 例句 |
| `exampleTranslation` | TEXT | 例句中文翻译（迁移补充列） |
| `note` | TEXT | 用户笔记（**加密存储**，见 3.6） |
| `root` | TEXT | 词根 |
| `mastery` | INTEGER | 掌握度（1-5 级，5 级进入已掌握） |
| `nextReview` | INTEGER | 下次复习时间（SM-2 调度） |
| `lastReview` | INTEGER | 上次复习时间 |
| `reviewCount` | INTEGER | 累计复习次数 |
| `interval` | INTEGER | SM-2 当前间隔（天） |
| `easeFactor` | REAL | SM-2 难度因子 |
| `sourceArticleId` | TEXT | 来源文章 id |
| `createdAt` | INTEGER | 收藏时间 |
| `stubbornCount` | INTEGER | 顽固词计数（连续答错次数） |
| `achievementTags` | TEXT | 成就标签 JSON 数组 `string[]` |
| `stabilityScore` | INTEGER | 记忆稳定度评分 |
| `favorite` | INTEGER DEFAULT 0 | 收藏标记（0 普通 / 1 重点收藏） |
| `phrases` | TEXT | 相关短语 JSON 数组 `WordPhrase[]`（迁移补充列） |
| `updated_at` | INTEGER | 更新时间 |

#### reviews（复习流水）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `${wordId}-${step}-${timestamp}` |
| `wordId` | TEXT | 关联单词 |
| `step` | TEXT | 背诵步骤（learn / read / dictation / spell / write） |
| `correct` | INTEGER | 是否正确（0/1，boolean 序列化） |
| `correctRate` | REAL | 正确率 |
| `timeSpent` | INTEGER | 用时（秒） |
| `reviewedAt` | INTEGER | 复习时间 |
| `updated_at` | INTEGER | 更新时间 |

#### stats（每日统计）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 日期 `YYYY-MM-DD` |
| `articlesRead` | INTEGER | 当日阅读文章数 |
| `wordsLearned` | INTEGER | 当日新学单词数 |
| `wordsReviewed` | INTEGER | 当日复习单词数 |
| `wordsMastered` | INTEGER | 当日掌握单词数 |
| `streak` | INTEGER | 连续打卡天数 |
| `updated_at` | INTEGER | 更新时间 |

#### readingSessions（阅读会话）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `${articleId}-${timestamp}` 或 UUID |
| `articleId` | TEXT | 关联文章 |
| `durationSec` | INTEGER | 阅读用时（秒） |
| `wordCount` | INTEGER | 阅读词数 |
| `correctRate` | REAL | 练习正确率 |
| `reviewedAt` | INTEGER | 会话时间 |
| `updated_at` | INTEGER | 更新时间 |

#### achievements（成就）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 成就规则 ID |
| `name` | TEXT | 成就名称 |
| `description` | TEXT | 达成条件描述 |
| `icon` | TEXT | 图标标识 |
| `unlockedAt` | INTEGER | 解锁时间 |
| `updated_at` | INTEGER | 更新时间 |

#### users（用户，多用户 P0）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | UUID（`crypto.randomUUID`） |
| `username` | TEXT NOT NULL UNIQUE | 登录用户名（唯一约束，注册竞态返回 409） |
| `displayName` | TEXT NOT NULL | 显示名（布局右上角展示） |
| `passwordHash` | TEXT NOT NULL | scrypt 哈希，格式 `scrypt$N$saltHex$hashHex`（N=16384，r=8，p=1；16 字节随机盐） |
| `role` | TEXT DEFAULT 'student' | 角色（admin / teacher / student；RBAC 权限校验已于 P1 落地，见 `server/src/permissions.ts`） |
| `status` | TEXT DEFAULT 'active' | 状态（active / disabled 软删除；禁用用户会话即时失效） |
| `failedLogins` | INTEGER DEFAULT 0 | 连续登录失败计数（达 5 触发锁定，成功登录清零） |
| `lockedUntil` | INTEGER | 锁定截止时间戳（锁 15 分钟） |
| `createdAt` / `updated_at` | INTEGER | 时间戳 |

#### sessions（登录会话，多用户 P0）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `token` | TEXT PK | 不透明令牌（`crypto.randomBytes(32)` hex，64 字符），不透明、可即时吊销 |
| `userId` | TEXT NOT NULL | 归属用户 |
| `createdAt` / `expiresAt` | INTEGER | 创建 / 过期时间（7 天滑动过期：剩余 < 3.5 天时自动续期） |
| `ip` / `userAgent` | TEXT | 登录来源信息（审计辅助） |

#### user_article_states（每用户阅读状态，多用户 P0）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userId` + `articleId` | 复合主键 | 归属用户 + 文章 id |
| `startedAt` / `readAt` | INTEGER | 开始 / 完成阅读时间戳（从共享 articles 行内剥离） |
| `updated_at` | INTEGER | 更新时间 |

#### schema_meta（迁移标记，多用户 P0）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | TEXT PK | 标记名（如 `multi_user_migrated`），存在即表示对应数据迁移已执行 |
| `value` | TEXT | 标记值 |

#### operation_logs（操作审计日志，多用户 P2）

只追加（append-only，无更新/删除 API）；保留 180 天，启动时自动将过期数据归档 CSV 至 `server/data/log-archive/` 后删除。写入方为 `server/src/audit.ts` 的 `logOperation()`（内部吞异常，绝不阻塞业务）；detail 经防御性脱敏（键名匹配 password/token/secret/apiKey/note/hash 的键整键剔除）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `userId` / `username` | TEXT | 操作者（匿名场景如登录失败可为 NULL；username 冗余存储，用户删除后日志仍可追溯） |
| `action` | TEXT NOT NULL | 动作（枚举见 API_REFERENCE 1.14.4：认证 / 用户管理 / 数据写 / 敏感读 / AI 调用 / 权限拒绝） |
| `resource` / `resourceId` | TEXT | 资源类型与业务 id（无用户前缀，透明映射对审计不可见） |
| `result` | TEXT NOT NULL | success / denied / failed |
| `detail` | TEXT | 脱敏后的 JSON 上下文 |
| `ip` | TEXT | 来源 IP |
| `createdAt` | INTEGER | 时间戳 |

### 3.4 关系与约束

- 外键关系（`questions.articleId`、`reviews.wordId`、`readingSessions.articleId`、`words.sourceArticleId`）**不在数据库层强制约束**，由应用层维护；删除文章不级联删除相关记录，但会级联清理全站 user_article_states（articles 路由 DELETE 处理）。
- `sessions.userId` / `user_article_states.userId` 与 users 无外键约束；修改密码或禁用用户时由应用层删除全部会话（全端下线）。
- `id` 为主键索引；`title`/`content` 为 NOT NULL，其余字段均可空（宽松 schema，由应用层保证业务完整性）。

### 3.5 JSON 序列化列

对象/数组字段在 SQLite 中存为 TEXT（JSON 字符串），由 `server/src/db.ts` 的 `JSON_COLUMNS` 声明，写入时 `JSON.stringify`、读取时 `JSON.parse`（解析失败保留原值并在开发环境告警），对上层透明：

| 表 | JSON 字段 | TypeScript 类型 |
| --- | --- | --- |
| `articles` | `lexileRange` | `{ min: number; max: number }` |
| `articles` | `highlightedWords` | `HighlightedWord[]` |
| `articles` | `phrases` | `ArticlePhrase[]` |
| `articles` | `vocabulary` | `ArticleVocabulary[]` |
| `questions` | `options` | `[string, string, string, string]` |
| `words` | `achievementTags` | `string[]` |
| `words` | `phrases` | `WordPhrase[]` |

其余表无 JSON 字段。`boolean` 值写入时序列化为 `1`/`0`，`undefined` 序列化为 `null`。

### 3.6 加密列与敏感数据

由 `ENCRYPTED_COLUMNS` 声明，当前仅 `words.note`（用户笔记可能含个人学习心得）：

- 算法：**AES-256-GCM** 应用层字段加密（`server/src/encryption.ts`），随机 IV，存储格式 `enc:v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`。
- 密钥：环境变量 `ENCRYPTION_KEY`（32 字节 hex，或经 SHA-256 派生的长 passphrase）。**生产环境未配置时服务端拒绝启动（fail-fast）**；开发环境未配置则禁用加密。
- 兼容：未带 `enc:v1:` 前缀的旧明文值按原值返回（平滑迁移）；解密失败返回空串并记录警告。
- 加密仅在存储层生效，REST API 返回的是解密后的明文。

### 3.7 索引

| 索引 | 表（列） | 用途 |
| --- | --- | --- |
| `idx_articles_content_hash` | `articles(contentHash)` | AI 生成文章去重查询 |
| `idx_articles_updated_at` | `articles(updated_at)` | 列表查询倒序扫描（`GET /api/articles` 默认 `ORDER BY updated_at DESC`） |
| `idx_questions_updated_at` | `questions(updated_at)` | 同上 |
| `idx_words_updated_at` | `words(updated_at)` | 同上 |
| `idx_reviews_updated_at` | `reviews(updated_at)` | 同上（reviews 增长最快，收益最大） |
| `idx_stats_updated_at` | `stats(updated_at)` | 同上 |
| `idx_readingSessions_updated_at` | `readingSessions(updated_at)` | 同上 |
| `idx_achievements_updated_at` | `achievements(updated_at)` | 同上 |
| `idx_words_userId` 等 × 5 | 5 张私有表 `(userId)` | 私有表强制 `WHERE userId=?` 过滤，必须走索引 |
| `idx_sessions_userId` | `sessions(userId)` | 改密 / 禁用时按用户吊销全部会话 |
| `idx_sessions_expiresAt` | `sessions(expiresAt)` | 过期会话扫描清理 |
| `idx_uas_user_readAt` | `user_article_states(userId, readAt)` | 按用户查询已读历史（`WHERE userId=? ORDER BY readAt`） |
| `idx_words_user_mastery` | `words(userId, mastery)` | 生词本列表按用户过滤已掌握单词（`WHERE userId=? AND mastery<?`） |
| `idx_words_user_nextReview` | `words(userId, nextReview)` | 复习队列到期查询（`WHERE userId=? AND nextReview<=?`） |
| `idx_words_user_createdAt` | `words(userId, createdAt)` | 生词本默认排序（按用户隔离的添加时间倒序） |
| `idx_reviews_user_reviewedAt` | `reviews(userId, reviewedAt)` | 复习记录按用户 + 时间范围统计 |
| `idx_sessions_user_reviewedAt` | `readingSessions(userId, reviewedAt)` | 阅读会话按用户 + 时间范围统计 |

所有索引使用 `CREATE INDEX IF NOT EXISTS`，幂等创建。项目约定：**列表查询必须走索引**，新增高频查询前先补对应索引（避免全表扫描 + 排序）。

### 3.8 迁移机制

采用「启动时增量迁移」，无独立迁移脚本：

1. `CREATE TABLE IF NOT EXISTS` 保证新库一次建全表（新库字段即最新 schema）。
2. 对旧库，通过 `PRAGMA table_info(<table>)` 检查列是否存在，缺失则 `ALTER TABLE ... ADD COLUMN`。当前迁移项：

| 目标列 | 表 | 类型 | 说明 |
| --- | --- | --- | --- |
| `contentHash` | articles | TEXT | 去重指纹 |
| `readAt` | articles | INTEGER | 已读时间 |
| `startedAt` | articles | INTEGER | 开始阅读时间 |
| `phrases` | articles | TEXT | 重点短语 JSON |
| `vocabulary` | articles | TEXT | 重点词汇 JSON |
| `favorite` | words | INTEGER DEFAULT 0 | 收藏标记 |
| `exampleTranslation` | words | TEXT | 例句翻译（修复旧 schema 静默丢字段缺陷） |
| `phrases` | words | TEXT | 相关短语 JSON |
| `userId` | words / reviews / stats / readingSessions / achievements | TEXT | 私有表用户归属列（P0，循环 PRAGMA 检查逐表添加） |

3. 索引同样以 `IF NOT EXISTS` 幂等创建。

**新增列规范**：在 `CREATE TABLE` 语句中追加列定义 + 在迁移段补一条 `PRAGMA table_info` 检查，两处缺一不可（前者保证新库、后者保证旧库升级）。

#### 3.8.1 单用户 → 多用户数据迁移（`server/src/migrateMultiUser.ts`，P0）

服务器启动时执行一次，与上述列迁移相互独立：

1. **幂等**：`schema_meta` 已存在 `multi_user_migrated` 标记时直接返回。
2. **备份**：文件库先 `wal_checkpoint(TRUNCATE)` 再复制到 `server/data/backups/ydxl-pre-multiuser-<时间戳>.db`；备份失败仅告警不阻断（`:memory:` 跳过）。
3. **单事务**（任一步失败整体回滚，下次启动重试）：
   - 取 users 中最早的用户作为存量数据归属；无用户时创建首个 admin（`ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD` 环境变量，未配置密码则生成随机初始密码并写入 `server/data/admin-initial-password.txt`（权限 0600），控制台仅打印文件路径）；
   - 5 张私有表：`UPDATE ... SET userId=? WHERE userId IS NULL`、`SET id=?||':'||id WHERE instr(id,':')=0`（instr 条件保证不双重前缀）；`reviews.wordId` 同样加前缀；
   - articles 行内 `readAt` / `startedAt` 拷贝到 user_article_states（`INSERT OR REPLACE ... SELECT`；articles 保留原列一个版本用于回滚，新代码不再读写）；
   - 写入 `multi_user_migrated` 标记（与数据同事务，保证标记与数据一致）。

### 3.9 写入路径与幂等性

`server/src/routes.ts` 的写入序列化顺序：**加密字段（encryptField）→ JSON 字段（stringify）→ boolean（0/1）→ undefined（null）**。

- `POST /api/{table}`：`INSERT OR REPLACE`（主键冲突覆盖旧记录），具备幂等性，适配客户端重试场景。
- `PUT /api/{table}/{id}`：部分更新，自动刷新 `updated_at`。
- 请求体经 `sanitizeBody` 白名单过滤（仅保留表内合法列名，非法列名静默忽略），字符串字段长度上限 1MB。
- `POST /api/words/bulk`：事务 + `INSERT OR IGNORE` 批量插入（已存在的词跳过，不覆盖复习进度），单次最多 1000 条；每条归属当前用户（P0）。
- **多用户写入（P0）**：私有表 POST / PUT 服务端强制覆盖 `userId`、id 与 `reviews.wordId` 加 `${userId}:` 前缀入库，响应前剥离（见 3.2「多用户存储形态」）；articles 的 `readAt` / `startedAt` 先从 body 分离，共享表写入与状态表 upsert 在**同一事务**内完成（POST / PUT / DELETE 均已事务化，2026-11-01）。

### 3.10 写入扩展性与 Postgres 迁移评估（L1，2026-11-01）

**现状**
- `better-sqlite3` 同步 API + 单进程单写者；WAL 允许读写并行，但写事务仍全局串行。
- 已采取的写入加固：`busy_timeout = 5000`（写锁排队）；`POST /api/words/bulk` 单事务最多 1000 条；articles 的「业务表 + 用户状态表」写入/删除均包裹事务。
- 单条写事务通常为亚毫秒到数毫秒级，WAL checkpoint 由 SQLite 自动触发。

**容量判断**
- 当前单机 SQLite 可覆盖「单校/年级」规模（数十教师、数百学生、峰值写入 <50 TPS）。
- 读多写少（阅读、查词、统计）场景下瓶颈主要来自非索引查询，已由 M2 复合索引缓解。

**迁移 Postgres 的触发条件（满足任一即启动专项）**
1. 需要多实例/水平扩展（SQLite 文件锁无法跨主机共享）。
2. 持续写入 >50 TPS，或写入 P95 延迟 >100ms（先以 `busy_timeout` 命中率与慢写日志度量）。
3. 需要跨表复杂分析、窗口函数、全文检索或细粒度行级锁。
4. 备份/恢复窗口或数据规模超出单文件运维能力。

**迁移设计要点**
- 前置重构：把散布在 `routes/*` 的 `db.prepare` 收敛为数据访问层（repository），统一 JSON 序列化与加密列处理，屏蔽 SQLite/Postgres 方言差异。
- 12 张表可一一映射；`INTEGER` 时间戳保持，JSON TEXT 列可先沿用再评估 `jsonb`。
- 采用「双写 + 校验 + 切读」的灰度路径，迁移脚本复用现有 `migrateMultiUser` 的幂等思路。

**结论**：本季度维持 SQLite，完成低风险加固与评估；不迁移 Postgres，待上述触发条件出现后再立项。

## 4. 前端 Dexie（IndexedDB）

### 4.1 定位

- 数据库名 `ydxl-db`（`src/shared/services/db.ts`），作为 `CachedRemoteRepository` 的离线回退数据源。
- 业务表**只读缓存**：服务器读取成功后异步同步；断网时支撑只读浏览（生词本/统计/已加载文章等）。
- `aiCache` 是唯一纯前端写入的表。
- **多用户缓存隔离（P0）**：Dexie schema 保持 v8 不变（前端实体形态零改动）。登录时通过 localStorage `ydxl-cache-owner` 记录缓存归属用户 id；换账号登录或登出时清空 7 张业务表（保留 `aiCache`，内容寻址、无用户隐私），防止跨账号数据串号。会话令牌存 sessionStorage（`ydxl-auth-token`），关标签页即失效。

### 4.2 schema 演进（v1 → v8）

> Dexie 升级版本必须**重新声明全部已有表 schema**，否则会被当作删除处理。仅新增索引不需数据迁移。

| 版本 | 变更 |
| --- | --- |
| v1 | 初始 5 张表：articles / questions / words / reviews / stats（含 genre、articleId、wordId、mastery、nextReview 等基础索引） |
| v2 | 新增 `readingSessions`、`achievements` 两张表 |
| v3 | 为 questions / words / reviews 补 `updated_at` 索引（至此 7 张表全覆盖） |
| v4 | articles 新增 `contentHash`、`readAt` 索引 |
| v5 | articles 新增 `startedAt` 索引 |
| v6 | words 新增 `favorite` 索引 |
| v7 | 新增 `aiCache` 表（AI 响应永久缓存） |
| v8 | words 新增 `createdAt` 索引（生词列表默认排序走索引有序扫描） |

### 4.3 当前 v8 schema 索引全表

| 表 | 索引声明 |
| --- | --- |
| `articles` | `id, genre, createdAt, updated_at, contentHash, readAt, startedAt` |
| `questions` | `id, articleId, type, createdAt, updated_at` |
| `words` | `id, word, sourceArticleId, mastery, nextReview, updated_at, favorite, createdAt` |
| `reviews` | `id, wordId, step, reviewedAt, updated_at` |
| `stats` | `id, updated_at` |
| `readingSessions` | `id, articleId, reviewedAt, updated_at` |
| `achievements` | `id, updated_at` |
| `aiCache` | `id, scenario, updatedAt` |

索引设计原则：主键 `id` + 外键索引（关联查询）+ 筛选索引（genre/mastery/type/step/favorite）+ 排序索引（createdAt/reviewedAt/updated_at）+ 到期查询索引（nextReview）。

### 4.4 aiCache 表（AI 响应缓存）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 缓存 key：`${scenario}[:${variant}]|${model}|${sha256(system+user)}`（variant 用于数组场景缓存隔离） |
| `value` | TEXT | JSON 序列化的缓存值 |
| `scenario` | TEXT | 调用场景标识（按场景精确清理） |
| `expiresAt` | INTEGER | 过期时间戳（含永久缓存哨兵） |
| `updatedAt` | INTEGER | 最后写入时间（LRU 淘汰排序） |

设计动机：突破 localStorage 5MB 上限；确定性 AI 调用（同文章再次请求）零 token 消耗。缓存策略详见 [CACHING.md](./CACHING.md)。

## 5. 数据生命周期与规模

- 单用户年增量约 6MB（主要来自 `reviews` 流水表，每次复习新增一行）。
- 用户学习数据加密存储（`words.note`）；其余数据不含个人标识。
- 备份、恢复、WAL 维护等运维操作见 [OPERATIONS.md](./OPERATIONS.md)。

## 相关文档

- [ER 关系图](./ER_DIAGRAM.md)：实体关系与字段可视化
- [API 参考](./API_REFERENCE.md)：REST CRUD 与序列化行为
- [架构文档](./ARCHITECTURE.md)：分层架构与数据流
- [运维手册](./OPERATIONS.md)：备份策略与监控
- [缓存策略](./CACHING.md)：AI 响应缓存与 Dexie 缓存
