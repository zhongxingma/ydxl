# 数据库 ER 关系图

本文档使用 Mermaid `erDiagram` 描述 `ydxl` 应用的数据表结构与关系：服务器 SQLite 12 张表（7 张业务表 + 多用户 P0 新增 users / sessions / user_article_states / schema_meta，P2 新增审计表 operation_logs）+ 前端 Dexie 独有的 `aiCache` 缓存表（schema v7）。多用户存储形态：私有表每行携带 `userId` 列、存储主键为 `${userId}:${业务 id}`；下方 ER 图为 **REST 响应 / 前端实体视角**（业务 id 无前缀、不含 userId）。字段定义来源于 `server/src/db.ts`（服务器 SQLite，camelCase 字段）与 `src/shared/services/db.ts`（前端 Dexie，camelCase 字段）。两端字段命名完全一致，无需字段映射转换。

> 字段命名约定：除 `updated_at` 保留 snake_case 以与前端 `BaseEntity` 类型对齐外，其余字段均使用 camelCase。SQLite 表名与 Dexie 表名一致，均为 camelCase（如 `readingSessions`）。

## ER 关系总览

```mermaid
erDiagram
    articles ||--o{ questions : "articleId"
    articles ||--o{ readingSessions : "articleId"
    articles }o--o{ words : "highlightedWords"

    words ||--o{ reviews : "wordId"

    users ||--o{ sessions : "userId"
    users ||--o{ words : "userId"
    users ||--o{ reviews : "userId"
    users ||--o{ stats : "userId"
    users ||--o{ readingSessions : "userId"
    users ||--o{ achievements : "userId"
    users ||--o{ user_article_states : "userId"
    articles ||--o{ user_article_states : "articleId"
    users ||--o{ operation_logs : "userId（逻辑关联，无外键）"

    articles {
        TEXT id PK
        TEXT title
        TEXT content
        TEXT translation
        TEXT genre
        INTEGER wordCount
        INTEGER createdAt
        INTEGER updated_at
        TEXT topic
        TEXT difficulty
        TEXT lexileRange
        TEXT highlightedWords
        TEXT contentHash
        INTEGER readAt
        INTEGER startedAt
        TEXT phrases
        TEXT vocabulary
    }

    questions {
        TEXT id PK
        TEXT articleId FK
        TEXT type
        TEXT stem
        TEXT options
        INTEGER correctIndex
        TEXT explanation
        TEXT locationClue
        INTEGER createdAt
        INTEGER updated_at
    }

    words {
        TEXT id PK
        TEXT word
        TEXT phonetic
        TEXT pos
        TEXT definition
        TEXT example
        TEXT exampleTranslation
        TEXT note
        TEXT root
        INTEGER mastery
        INTEGER nextReview
        INTEGER lastReview
        INTEGER reviewCount
        INTEGER interval
        REAL easeFactor
        TEXT sourceArticleId FK
        INTEGER createdAt
        INTEGER stubbornCount
        INTEGER achievementTags
        INTEGER stabilityScore
        INTEGER favorite
        TEXT phrases
        INTEGER updated_at
    }

    reviews {
        TEXT id PK
        TEXT wordId FK
        TEXT step
        INTEGER correct
        REAL correctRate
        INTEGER timeSpent
        INTEGER reviewedAt
        INTEGER updated_at
    }

    stats {
        TEXT id PK
        INTEGER articlesRead
        INTEGER wordsLearned
        INTEGER wordsReviewed
        INTEGER wordsMastered
        INTEGER streak
        INTEGER updated_at
    }

    readingSessions {
        TEXT id PK
        TEXT articleId FK
        INTEGER durationSec
        INTEGER wordCount
        REAL correctRate
        INTEGER reviewedAt
        INTEGER updated_at
    }

    achievements {
        TEXT id PK
        TEXT name
        TEXT description
        TEXT icon
        INTEGER unlockedAt
        INTEGER updated_at
    }

    aiCache {
        TEXT id PK
        TEXT value
        TEXT scenario
        INTEGER expiresAt
        INTEGER updatedAt
    }

    users {
        TEXT id PK
        TEXT username UNIQUE
        TEXT displayName
        TEXT passwordHash "scrypt$N$salt$hash"
        TEXT role "admin/teacher/student"
        TEXT status "active/disabled"
        INTEGER failedLogins
        INTEGER lockedUntil
        INTEGER createdAt
        INTEGER updated_at
    }

    sessions {
        TEXT token PK "256 位随机 hex"
        TEXT userId FK
        INTEGER createdAt
        INTEGER expiresAt "7 天滑动过期"
        TEXT ip
        TEXT userAgent
    }

    user_article_states {
        TEXT userId PK, FK
        TEXT articleId PK, FK
        INTEGER startedAt
        INTEGER readAt
        INTEGER updated_at
    }

    schema_meta {
        TEXT key PK
        TEXT value
    }

    operation_logs {
        TEXT id PK
        TEXT userId
        TEXT username
        TEXT action
        TEXT resource
        TEXT resourceId
        TEXT result
        TEXT detail
        TEXT ip
        INTEGER createdAt
    }
```

> `aiCache` 为**前端 Dexie 独有**的第 8 张表（schema v7 新增、v8 沿用，索引 `id, scenario, updatedAt`），用于 AI 响应缓存（突破 localStorage 5MB 上限，`value` 为 JSON 序列化的缓存值，`expiresAt` 支持永久哨兵）；服务器 SQLite 不含此表。

## 关系说明

| 关系 | 基数 | 说明 |
| --- | --- | --- |
| `articles` ↔ `questions` | 一对多 | 一篇文章对应多道阅读理解题（通过 `articleId` 关联） |
| `articles` ↔ `readingSessions` | 一对多 | 一篇文章可被多次阅读（每次会话独立记录用时 / 正确率） |
| `articles` ↔ `words` | 多对多 | 通过 `articles.highlightedWords` JSON 字段关联 AI 预标注生词列表；`words.sourceArticleId` 反向记录生词来源文章 |
| `words` ↔ `reviews` | 一对多 | 一个生词对应多次复习记录（通过 `wordId` 关联） |
| `users` ↔ `sessions` | 一对多 | 一个用户多个登录会话；登出即吊销，改密 / 禁用全端下线（P0） |
| `users` ↔ 五张私有表 | 一对多 | 私有数据归属（words / reviews / stats / readingSessions / achievements），SQL 层强制 `WHERE userId=?`（P0） |
| `users` + `articles` ↔ `user_article_states` | 多对多 | 每用户独立的阅读进度（复合主键 userId + articleId，P0） |

> **注意**：所有外键关系未在数据库层强制约束，通过应用层维护。`readingSessions.articleId` 与 `words.sourceArticleId` 不加外键约束，避免删除文章时级联删除相关记录；删除文章时应用层级联清理全站 user_article_states。

## 字段类型说明

| SQLite 类型 | 对应 TypeScript 类型 | 说明 |
| --- | --- | --- |
| `TEXT` | `string` | 字符串（含主键 id，格式如 `YYYY-MM-DD` 或 UUID） |
| `INTEGER` | `number` | 整数（时间戳为毫秒级 BIGINT） |
| `REAL` | `number` | 浮点数（如 `easeFactor`、`correctRate`） |

### 时间戳字段

所有时间戳字段（`createdAt`、`updated_at`、`nextReview`、`lastReview`、`reviewedAt`、`unlockedAt`）均为 INTEGER 毫秒时间戳（`Date.now()` 生成）。`updated_at` 由 Express REST API 在 POST / PUT 时自动填充。

## JSON 字段序列化

以下字段在 SQLite 中存储为 TEXT（JSON 字符串），由 `server/src/db.ts` 的 `JSON_COLUMNS` 声明，写入时 `JSON.stringify`、读取时 `JSON.parse`，对前端透明：

| 表 | JSON 字段 | TypeScript 类型 |
| --- | --- | --- |
| `articles` | `lexileRange` | `{ min: number; max: number }` |
| `articles` | `highlightedWords` | `HighlightedWord[]` |
| `articles` | `phrases` | `ArticlePhrase[]` |
| `articles` | `vocabulary` | `ArticleVocabulary[]` |
| `questions` | `options` | `[string, string, string, string]` |
| `words` | `achievementTags` | `string[]` |
| `words` | `phrases` | `WordPhrase[]` |

其余表（`reviews`、`stats`、`readingSessions`、`achievements`）无 JSON 字段，全部为标量类型。

## 索引

服务器 SQLite 在主键之外显式创建 16 个二级索引（`server/src/db.ts`，`CREATE INDEX IF NOT EXISTS` 幂等创建）：

| 索引 | 表（列） | 用途 |
| --- | --- | --- |
| `idx_articles_content_hash` | `articles(contentHash)` | AI 生成文章去重查询 |
| `idx_*_updated_at`（7 张表各一个） | `articles / questions / words / reviews / stats / readingSessions / achievements` 的 `updated_at` | 列表查询按 `updated_at DESC` 倒序扫描，避免全表扫描 + 排序（reviews 增长最快，收益最大） |
| `idx_*_userId`（5 张私有表各一个） | `words / reviews / stats / readingSessions / achievements` 的 `userId` | 私有表强制 `WHERE userId=?` 过滤（P0） |
| `idx_sessions_userId` | `sessions(userId)` | 改密 / 禁用时按用户吊销会话（P0） |
| `idx_sessions_expiresAt` | `sessions(expiresAt)` | 过期会话清理（P0） |
| `idx_uas_user_readAt` | `user_article_states(userId, readAt)` | 按用户查询已读历史（P0） |

前端 Dexie（当前 v8 schema）为各表声明外键 / 筛选 / 排序索引（如 `words` 的 `sourceArticleId, mastery, nextReview, favorite, createdAt`），完整索引清单见 [DATABASE.md](./DATABASE.md#43-当前-v8-schema-索引全表)。

## 存储引擎

- **服务器**：better-sqlite3（同步 SQLite 绑定，WAL 模式）
  - 数据库文件路径：`server/data/ydxl.db`（运行时自动创建 `data/` 目录）
  - WAL 模式：`db.pragma('journal_mode = WAL')` 提升并发读性能
  - 备份方式：`sqlite3 server/data/ydxl.db .dump > backup.sql`（详见 [OPERATIONS.md](./OPERATIONS.md)）
- **前端**：Dexie.js（IndexedDB 封装，离线只读缓存）
  - 7 张业务表与服务器 SQLite（业务字段）完全一致，另有 `aiCache` 缓存表（v7 新增，仅前端）；多用户隔离完全在服务端实现（P0），Dexie 实体形态零改动
  - 作为 `CachedRemoteRepository` 的离线回退数据源

## 相关文档

- [数据库设计](./DATABASE.md)：字段详表、索引、迁移与加密机制（本文档的完整版）
- [架构文档](./ARCHITECTURE.md)：分层架构与数据流（前端 → REST API → Express → SQLite）
- [API 参考](./API_REFERENCE.md)：7 张表 REST API 与 /api/auth/* 认证端点说明
- [README](../README.md)：项目概述与快速开始
- [运维手册](./OPERATIONS.md)：SQLite 备份策略与 Express 服务监控
