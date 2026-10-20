# API 参考文档

本文档是 `ydxl` 项目的 API 参考手册，覆盖 Local Server REST API、认证端点（`/api/auth/*`，多用户 P0）、AI 代理端点、AIProvider 接口、BaseAIProvider 抽象基类、Repository 数据访问层、核心数据类型、错误码与请求/响应示例。

- 语言：中文（简体），技术术语保留英文
- 代码示例：TypeScript / Bash
- 源码基准：当前 `main` 分支（技术栈精简与本地存储迁移后）

---

## 目录

- [1. Local Server REST API](#1-local-server-rest-api)
- [2. AI 代理端点](#2-ai-代理端点)
- [3. AIProvider 接口](#3-aiprovider-接口)
- [4. BaseAIProvider 抽象基类](#4-baseaiprovider-抽象基类)
- [5. Repository 接口](#5-repository-接口)
- [6. 核心数据类型](#6-核心数据类型)
- [7. 请求/响应示例](#7-请求响应示例)
- [8. AIProviderName 类型](#8-aiprovidername-类型)

---

## 1. Local Server REST API

后端采用 **Express 4 + better-sqlite3（本地 SQLite）**，为前端提供 7 张业务表的 RESTful CRUD 端点与 `/api/auth/*` 认证端点（多用户会话认证，P0 已实施）。源码位于 `server/src/`。

> 表数口径说明：服务器 SQLite 共 **12 张表 = 7 业务表 + 5 多用户表**（users / sessions / user_article_states / schema_meta / operation_logs），多用户表中仅 operation_logs 提供只读查询端点（1.14 节）；本文档的「7 张表」均指提供 REST 端点的业务表，与 [DATABASE.md](./DATABASE.md) 的 12 张表口径一致。

### 1.1 基础信息

| 项 | 值 |
| --- | --- |
| 基础 URL | `http://localhost:3001/api` |
| 开发环境代理 | Vite dev server 将 `/api` 转发到 `http://localhost:3001`（见 `vite.config.ts`） |
| 端口 | `process.env.PORT`（默认 `3001`） |
| 鉴权 | 会话令牌：除 `/api/health` 与 `/api/auth/*` 外，全部 `/api` 端点均需携带有效会话令牌 `x-user-token`（见 1.11） |
| CORS | 白名单模式（`CORS_ORIGIN` 环境变量配置；未配置时生产环境默认仅本机，开发环境允许所有） |
| 请求体上限 | `10mb`（文章内容较长） |

### 1.2 表端点（7 张业务表）

每张表自动生成如下 5 个端点（表名白名单见 `server/src/routes.ts` 的 `TABLES`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/{table}` | 返回分页记录，按 `updated_at` 倒序，支持 `?limit=N&offset=N`，响应 `{ items, total, limit, offset }` |
| GET | `/api/{table}/{id}` | 返回单条记录，不存在返回 404 |
| POST | `/api/{table}` | 新增或覆盖记录（使用 `INSERT OR REPLACE`，自动填充 `updated_at`），返回 201。主键重复时**覆盖旧记录**，具备幂等性 |
| PUT | `/api/{table}/{id}` | 更新记录（自动刷新 `updated_at`），不存在返回 404；可用于更新 `readAt`（如 `markAsRead`） |
| DELETE | `/api/{table}/{id}` | 删除记录，成功返回 204 |

7 张表及其路由名：

| 表名（路由段） | 对应实体 | 主键格式 | 隔离（多用户 P0） |
| --- | --- | --- | --- |
| `articles` | Article | `YYYY-MM-DD` | 共享（阅读状态按用户隔离，见 1.12） |
| `questions` | Question | `${articleId}-${n}` | 共享 |
| `words` | Word | 单词本身 | 私有 |
| `reviews` | Review | 业务层生成（如 `${wordId}-${step}-${timestamp}`） | 私有 |
| `stats` | Stats | `YYYY-MM-DD` | 私有 |
| `readingSessions` | ReadingSession | `${articleId}-${timestamp}` 或 UUID | 私有 |
| `achievements` | Achievement | 成就规则 ID（如 `reading-star`） | 私有 |

> 表名使用 camelCase，与前端 Dexie 表名、`src/shared/types/index.ts` 类型定义完全一致，**无需字段映射转换**。

> 多用户数据隔离（P0）在服务端路由层完成：私有表 SQL 强制 `WHERE userId = ?`，共享表全站可见；REST 请求/响应实体形态与单用户时代一致（见 1.12 节）。

#### words 表批量插入端点

生词批量加入场景专用（消除 N+1 HTTP 调用），注册于 `POST /api/words/bulk`（在 `/api/words` 通用路由**之前**注册，避免 `bulk` 被当作 `:id`）：

| 项 | 说明 |
| --- | --- |
| 请求体 | `{ items: Word[] }`，单次最多 1000 条（超出返回 400 `INVALID_INPUT`） |
| 写入语义 | 事务 + `INSERT OR IGNORE`：已存在的词**跳过**，不覆盖已有复习进度与笔记 |
| 归属 | 每条生词归属当前登录用户（服务端强制写入 userId），「已存在」判定同样以用户为单位（跨用户同名单词互不冲突，见 1.12） |
| 响应 | `201 { added: number, skipped: number, errors: Array<{ index: number, error: string }> }` |
| 错误隔离 | 单条校验失败不中断整体，记入 `errors`（index 为 items 数组下标） |

### 1.3 字段序列化

SQLite 中 JSON 类型字段（object / array）存储为 TEXT，服务端自动序列化/反序列化。JSON 字段清单定义于 `server/src/db.ts` 的 `JSON_COLUMNS`：

| 表 | JSON 字段 |
| --- | --- |
| articles | `lexileRange`、`highlightedWords`、`phrases`、`vocabulary` |
| questions | `options` |
| words | `achievementTags`、`phrases` |
| 其余 4 张表 | 无 |

`boolean` 字段存储为 `0` / `1`（如 `reviews.correct`），`undefined` 存储为 `null`。

#### 加密字段

敏感字段在写入前经 **AES-256-GCM** 应用层加密（`enc:v1:` 前缀格式），读取后自动解密，清单定义于 `ENCRYPTED_COLUMNS`，对 API 调用方透明（请求/响应均为明文，加密仅发生在存储层）：

| 表 | 加密字段 | 说明 |
| --- | --- | --- |
| words | `note` | 用户笔记可能含个人学习心得 |

密钥来自环境变量 `ENCRYPTION_KEY`（生产环境未配置时服务端拒绝启动）。详见 [DATABASE.md](./DATABASE.md#36-加密列与敏感数据)。

### 1.4 请求示例

#### 新增文章（POST）

```bash
curl -X POST 'http://localhost:3001/api/articles' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "2026-07-11",
    "title": "The Quiet Power of Mushrooms",
    "content": "Mushrooms are not plants...",
    "translation": "蘑菇不是植物...",
    "genre": "expository",
    "wordCount": 245,
    "createdAt": 1720000000000,
    "topic": "science",
    "difficulty": "medium",
    "lexileRange": { "min": 700, "max": 850 },
    "highlightedWords": [
      { "word": "decompose", "phonetic": "/ˌdiːkəmˈpoʊz/", "pos": "v.", "definition": "分解", "example": "Bacteria decompose organic matter." }
    ]
  }'
```

> **幂等性说明**：POST 端点底层使用 `INSERT OR REPLACE` SQL 语句，当请求体携带的主键 `id` 与表中已有记录冲突时，**新记录会覆盖旧记录**（包含未在新请求体中提供的字段也会被新值整体替换）。因此对同一 `id` 多次 POST 相同请求不会产生重复记录，具备幂等性。适合同步 / 重试场景——客户端在网络抖动时重复提交不会产生副作用。

#### 查询单条文章（GET）

```bash
curl 'http://localhost:3001/api/articles/2026-07-11'
```

#### 更新文章（PUT）

```bash
curl -X PUT 'http://localhost:3001/api/articles/2026-07-11' \
  -H 'Content-Type: application/json' \
  -d '{ "wordCount": 250 }'
```

#### 删除文章（DELETE）

```bash
curl -X DELETE 'http://localhost:3001/api/articles/2026-07-11'
```

### 1.5 响应示例

#### GET 单条文章成功（200）

```json
{
  "id": "2026-07-11",
  "title": "The Quiet Power of Mushrooms",
  "content": "Mushrooms are not plants...",
  "translation": "蘑菇不是植物...",
  "genre": "expository",
  "wordCount": 245,
  "createdAt": 1720000000000,
  "updated_at": 1720000000000,
  "topic": "science",
  "difficulty": "medium",
  "lexileRange": { "min": 700, "max": 850 },
  "highlightedWords": [
    { "word": "decompose", "phonetic": "/ˌdiːkəmˈpoʊz/", "pos": "v.", "definition": "分解", "example": "Bacteria decompose organic matter." }
  ],
  "contentHash": "a1b2c3d4e5f67890",
  "readAt": null
}
```

#### POST 新增成功（201）

返回写入的记录（含服务端填充的 `updated_at`）。

#### 记录不存在（404）

```json
{ "error": "Not found" }
```

#### 服务器内部错误（500）

当服务器处理请求时发生未捕获异常（如数据库写入失败、序列化异常、未知 bug 等），全局错误处理中间件会捕获并返回结构化 JSON 错误响应：

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "数据库写入失败"
  }
}
```

- `code` 固定为 `INTERNAL_ERROR`
- `message` 为错误描述字符串（可能包含原始异常的 message）
- HTTP 状态码 `500`

#### DELETE 成功（204）

空 body。

### 1.6 健康检查

```
GET /api/health
```

响应（200）：

```json
{ "status": "ok" }
```

用于 Nginx 健康检查、PM2/systemd 存活探针与部署验证。

### 1.7 分页

GET 列表端点（`GET /api/{table}`）支持分页查询参数：

| 参数 | 类型 | 默认值 | 上限 | 说明 |
| --- | --- | --- | --- | --- |
| `limit` | number | 100 | 1000 | 单页返回条数 |
| `offset` | number | 0 | — | 偏移量（跳过前 N 条） |

请求示例：

```bash
curl 'http://localhost:3001/api/articles?limit=20&offset=0'
```

响应格式（从数组改为分页对象）：

```json
{
  "items": [ { "id": "2026-07-11", "...": "..." } ],
  "total": 365,
  "limit": 20,
  "offset": 0
}
```

- `items`：当前页记录数组（按 `updated_at` 倒序）
- `total`：全表记录总数（`SELECT COUNT(*)`）；私有表统计当前用户的记录数
- `limit` / `offset`：实际生效的分页参数（回显）

> `limit` 超过 1000 时自动截断为 1000；`limit` 缺省或非正数时使用默认值 100。

### 1.8 限流

服务端引入 `express-rate-limit` 中间件，采用**分层限流**策略：

#### 1.8.1 全局限流

适用于除健康检查与 AI 代理外的所有 REST API 端点：

| 项 | 值 |
| --- | --- |
| 窗口 | 60 秒 |
| 窗口内最大请求数 | 60 次 / IP |
| 超限状态码 | 429 |
| 豁免端点 | `GET /api/health`（便于监控探针） |
| 叠加独立限流 | `/api/auth/login` 另有 5 次/60s/IP 登录限流（见 1.11.6）；`/api/v1/ai-proxy/*` 另有 20 次/60s/用户 代理限流（见 1.8.2）。两者均与全局限流叠加生效 |
| 响应头 | `RateLimit-*` 标准 headers（`legacyHeaders: false`） |

超限响应体（429）：

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

#### 1.8.2 AI 代理独立限流

AI 代理端点（`/api/v1/ai-proxy/*`）消耗服务端 DeepSeek 配额，全局限流 60/min 不足以防止滥用，单独收紧：

| 项 | 值 |
| --- | --- |
| 窗口 | 60 秒 |
| 窗口内最大请求数 | 20 次 / 用户（P3 起主计量维度由 IP 改为 userId） |
| 计量键 | `keyGenerator` 取 `req.user.id`（认证门后必存在）；缺失时回退 `req.ip`，再回退 `anonymous` |
| 超限状态码 | 429 |
| 响应头 | `RateLimit-*` 标准 headers |

> 改为按用户计量后，机房 / NAT 共享出口下单个用户刷满配额不再误伤同网段其他学员。限流器实现为 `createAiProxyLimiter()` 工厂（默认实例 `aiProxyLimiter` 挂载于 `server/src/index.ts`），测试环境默认 `skip` 以避免有状态计数桶跨用例累积。

超限响应体（429）：

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many AI requests, please slow down"
  }
}
```

### 1.9 CORS 白名单

CORS 通过 `CORS_ORIGIN` 环境变量配置，采用**环境感知的安全默认**策略：

- **配置 `CORS_ORIGIN` 时**：按逗号分割为白名单数组，仅允许白名单内来源（如 `CORS_ORIGIN=https://ydxl.example.com,https://www.ydxl.example.com`）。
- **未配置 `CORS_ORIGIN` 时**：
  - 生产环境（`NODE_ENV=production`）：默认仅允许本机 `http://localhost`、`http://127.0.0.1`，避免误开放。
  - 开发环境：允许所有来源（`*`），便于 localhost 调试。
- 允许方法：`GET / POST / PUT / DELETE / OPTIONS`。
- 允许请求头：`Content-Type`、`x-user-token`。

> 生产环境部署时**必须**配置 `CORS_ORIGIN` 为实际前端域名白名单，否则跨域请求将被拒绝。

### 1.10 全局错误处理中间件

Express 应用在所有路由之后注册了一个**全局错误处理中间件**（位于 `server/src/index.ts`），作为最后一道兜底防线：

- **捕获范围**：所有路由处理函数与中间件抛出的未捕获异常（同步 throw 与异步 Promise reject）。
- **响应格式**：始终返回结构化 JSON 而非 Express 默认的 HTML 错误页，便于前端统一解析错误响应。响应体结构：

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "<错误描述>"
  }
}
```

- **状态码**：`500`（Internal Server Error）。
- **错误信息脱敏**：
  - 生产环境（`NODE_ENV=production`）：`message` 固定为 `'Internal Server Error'`，不向客户端暴露原始错误消息与堆栈，避免泄露内部实现细节。
  - 开发环境：`message` 保留原始错误消息，便于调试。
  - 服务端日志始终通过 `console.error` 输出完整错误堆栈，便于运维侧排查。
- **前置中间件**：在到达错误处理中间件前，已知业务错误（如 404 Not Found、429 限流、AI 代理错误）已在各自路由 / 中间件中直接返回对应状态码与结构化错误体，不会被此兜底中间件覆盖。

### 1.11 认证端点（/api/auth/*）

多用户 P0 引入会话认证。认证路由定义于 `server/src/authRoutes.ts`，会话与密码逻辑见 `server/src/auth.ts`：`login` / `logout` 无需登录；`/me` 与 `/change-password` 在路由内部自挂 `authMiddleware`，令牌无效返回 401。

#### 1.11.1 端点表

| 方法 | 路径 | 登录要求 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 无需 | 账号密码登录，返回会话令牌与用户信息 |
| POST | `/api/auth/logout` | 无需（幂等） | 吊销当前会话；令牌缺失或无效同样返回 204 |
| GET | `/api/auth/me` | 需登录 | 返回当前登录用户（可作会话有效性探针） |
| POST | `/api/auth/change-password` | 需登录 | 修改密码；成功后吊销该用户**全部**会话（全端下线） |

#### 1.11.2 POST /api/auth/login（登录）

请求体：

```json
{ "username": "admin", "password": "your-password" }
```

成功响应（200）：

```json
{
  "token": "6f9c0d8eb2a4...（共 64 位十六进制，256 位随机，不透明令牌）",
  "user": {
    "id": "0b9ee6b2-8f2a-4c1d-9a67-2d5f1e4c7a88",
    "username": "admin",
    "displayName": "管理员",
    "role": "admin"
  }
}
```

- 令牌通过 `x-user-token` 请求头携带；前端存 sessionStorage（`ydxl-auth-token`，关闭标签页即失效），由 `src/shared/services/authService.ts` 管理
- `user.role` 取值 `admin` / `teacher` / `student`（RBAC 权限矩阵已于 P1 落地，见 1.13）

错误响应：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `INVALID_INPUT` | 用户名与密码必填 | `username` / `password` 缺失或为空 |
| 401 | `INVALID_CREDENTIALS` | 用户名或密码错误 | 用户不存在 / 密码错误 / 用户被禁用（统一文案，防用户名枚举） |
| 403 | `ACCOUNT_LOCKED` | 失败次数过多，账号已锁定，请 {N} 秒后重试 | 连续失败 5 次锁定 15 分钟（登录成功即清零） |
| 429 | `RATE_LIMITED` | Too many login attempts, please try again later | 登录端点独立限流超限（5 次/60s/IP，`NODE_ENV=test` 跳过） |

#### 1.11.3 POST /api/auth/logout（登出）

通过 `x-user-token` 请求头携带令牌，服务端吊销对应会话并返回 204（无 body）。令牌缺失或已失效同样返回 204（幂等，客户端无需区分）。

#### 1.11.4 GET /api/auth/me（当前用户）

成功响应（200）：

```json
{ "user": { "id": "0b9ee6b2-...", "username": "admin", "displayName": "管理员", "role": "admin" } }
```

令牌无效（含会话过期、用户被禁用）返回 401 `UNAUTHORIZED`。

#### 1.11.5 POST /api/auth/change-password（修改密码）

请求体：

```json
{ "oldPassword": "your-old-password", "newPassword": "new-password" }
```

- 成功：204（无 body），该用户**全部**会话被吊销（含当前端），前端应引导重新登录
- 400 `INVALID_INPUT`（`新密码至少 6 位`）：`newPassword` 少于 6 位（`MIN_PASSWORD_LENGTH`）
- 401 `INVALID_CREDENTIALS`（`原密码错误`）：`oldPassword` 校验失败

#### 1.11.6 会话与安全机制总览

| 项 | 值 |
| --- | --- |
| 令牌格式 | 64 位 hex（256 位随机），不透明，服务端 `sessions` 表存储，可即时吊销 |
| 会话 TTL | 7 天滑动过期：剩余不足一半（< 3.5 天）时自动顺延 7 天 |
| 密码哈希 | 服务端 scrypt（存储格式 `scrypt$N$saltHex$hashHex`，N=16384），哈希不经 API 传输 |
| 登录限流 | 5 次 / 60s / IP（独立于全局限流 60/min；`NODE_ENV=test` 跳过） |
| 登录锁定 | 连续失败 5 次锁定 15 分钟；登录成功清零 |
| 认证门 | `/api` 下除 `/api/health` 与 `/api/auth/*` 外全部端点（含 7 张表 REST、`/api/admin/*`、`/api/v1/ai-proxy/*`），见 `server/src/index.ts` |
| 统一 401 响应 | `{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required" } }` |
| 首个管理员 | 数据迁移时创建：`ADMIN_USERNAME`（默认 `admin`）/ `ADMIN_INITIAL_PASSWORD`（未配置则启动随机生成并打印一次） |

> 前端 `localApi` 与 AI 代理请求（baseProvider）自动注入 `x-user-token`；收到 401 时前端广播 `ydxl:unauthorized` 事件并引导重新登录。

### 1.12 多用户数据隔离行为（P0 已实施）

隔离在服务端 `server/src/routes.ts` 完成；REST 请求/响应实体形态与单用户时代**完全一致**（前端零改动）。

| 划分 | 表 | 服务端行为 |
| --- | --- | --- |
| 共享 | `articles`、`questions` | 全站所有用户可见同一份数据（AI 生成内容省 token） |
| 私有 | `words`、`reviews`、`stats`、`readingSessions`、`achievements` | SQL 强制 `WHERE userId = ?`，跨用户数据不可见 |

- **透明 id 前缀映射**：私有表存储层主键为 `` `${userId}:${业务 id}` ``（引用列如 `reviews.wordId` 同样加前缀），路由层写入时注入、读取时剥离——API 层看到的 id 与单用户时代相同（存储形态详见 DATABASE.md 3.2）
- **响应剥离**：私有表响应不含 `userId` 字段
- **articles 阅读状态按用户隔离**：`readAt` / `startedAt` 属于 API 实体，但存储层实际写入 `user_article_states`（复合主键 userId + articleId）：

| 操作 | 服务端行为 |
| --- | --- |
| GET（列表 / 单条） | 响应合并当前用户的阅读状态 |
| POST | 业务字段进共享表（`INSERT OR REPLACE` 覆盖写，全站可见）；`readAt`/`startedAt` 写入当前用户状态 |
| PUT `/:id` | 仅状态字段（如 `markAsRead` 写入 `readAt: Date.now()`）→ 只更新当前用户阅读状态；含业务字段 → 更新共享文章（全站生效） |
| DELETE `/:id` | 删除共享文章，并级联清理**全站** `user_article_states`（孤儿数据清理） |

- **POST /api/words/bulk**：每条生词归属当前登录用户，「已存在」判定以用户为单位（见 1.2 批量端点）

### 1.13 用户管理端点（/api/admin/*，P1 已实施）

RBAC 权限体系定义于 `server/src/permissions.ts`（权限矩阵与角色映射，见 docs/MULTI_USER_DESIGN.md 第 3.1 节），用户管理路由定义于 `server/src/adminRoutes.ts`。**全部端点要求 `users:manage` 权限（仅 admin 角色持有）**：未登录返回 401 `UNAUTHORIZED`；已登录但角色无权限返回 403 `FORBIDDEN`（`缺少权限：users:manage`）。

#### 1.13.1 端点表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/users` | 用户列表（按创建时间升序） |
| POST | `/api/admin/users` | 创建用户（用户名冲突 409） |
| PUT | `/api/admin/users/:id/status` | 禁用 / 启用（禁用即时吊销目标用户全部会话） |
| POST | `/api/admin/users/:id/reset-password` | 重置密码（成功后目标用户全端下线） |
| PUT | `/api/admin/users/:id/role` | 修改角色（目标用户旧会话吊销，降权即时生效） |

#### 1.13.2 用户对象（响应形态）

所有端点的用户响应均不含 `passwordHash`（服务端 `toPublicUser` 白名单过滤）：

```json
{
  "id": "0b9ee6b2-8f2a-4c1d-9a67-2d5f1e4c7a88",
  "username": "alice",
  "displayName": "爱丽丝",
  "role": "student",
  "status": "active",
  "failedLogins": 0,
  "lockedUntil": null,
  "createdAt": 1760000000000
}
```

- `role` 取值 `admin` / `teacher` / `student`；`status` 取值 `active` / `disabled`
- 列表端点响应为 `{ "items": [用户对象...] }`；单对象端点响应为 `{ "user": 用户对象 }`

#### 1.13.3 行为细则

| 端点 | 行为与约束 |
| --- | --- |
| POST `/users` | 请求体 `{ username, displayName, password, role? }`；`role` 缺省为 `student`；用户名格式 `^[a-zA-Z0-9_]{2,32}$`；密码最少 6 位；成功 201 |
| PUT `/users/:id/status` | 请求体 `{ status: 'active' \| 'disabled' }`；禁用即吊销全部会话 + 登录被拒；启用同时清除失败计数与锁定期；**不能操作自己**（400） |
| POST `/users/:id/reset-password` | 请求体 `{ newPassword }`（最少 6 位）；成功 204，目标用户全部会话吊销 |
| PUT `/users/:id/role` | 请求体 `{ role: 'admin' \| 'teacher' \| 'student' }`；成功后目标用户旧会话吊销（重新登录获取新角色）；**不能修改自己**（400） |

通用错误：404 `NOT_FOUND`（用户不存在）、400 `INVALID_INPUT`（字段校验失败）、409 `USERNAME_TAKEN`（用户名已被占用，仅创建端点）。

前端管理页 `/admin`（`src/features/admin/pages/AdminUsersPage.tsx`）经 `src/shared/services/adminService.ts` 调用上述端点；路由守卫 `RequireAdmin` 仅放行 admin 角色（体验层隐藏，授权权威在服务端）。

### 1.14 审计日志端点（/api/admin/logs，P2 已实施）

审计日志定义于 `server/src/audit.ts`（写入/查询/CSV 渲染/保留策略），查询端点位于 `server/src/adminRoutes.ts`。**全部端点要求 `logs:view` 权限（admin 与 teacher 角色持有，见 1.13 RBAC）**：未登录 401；student 访问 403 `FORBIDDEN`。日志本身只追加（无更新/删除 API），保留 180 天，启动时自动归档 CSV 到 `server/data/log-archive/` 后清理过期数据。

#### 1.14.1 端点表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/logs` | 分页查询审计日志（查询行为本身留痕 `logs.query`） |
| GET | `/api/admin/logs/export` | 导出 CSV（同样过滤条件；导出行为留痕 `logs.export`） |

#### 1.14.2 查询参数（两端点通用）

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `userId` | string | 按操作者精确过滤 |
| `action` | string | 按动作精确过滤（如 `auth.login.failed`、`words.create`、`permission.denied`） |
| `from` / `to` | number | 时间窗（ms 时间戳，含边界） |
| `limit` / `offset` | number | 分页（limit 默认 50，上限 500） |

#### 1.14.3 日志条目（响应形态）

```json
{
  "items": [
    {
      "id": "UUID",
      "userId": "0b9ee6b2-...",
      "username": "alice",
      "action": "words.create",
      "resource": "words",
      "resourceId": "apple",
      "result": "success",
      "detail": "{\"role\":\"student\"}",
      "ip": "192.168.1.10",
      "createdAt": 1760000000000
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

- `result` 取值 `success` / `denied` / `failed`；`detail` 为脱敏后的 JSON 字符串（绝不含密码/token/笔记明文/AI 密钥，服务端 `sanitizeDetail` 键名过滤）
- CSV 导出响应：`Content-Type: text/csv; charset=utf-8`（含 UTF-8 BOM）+ `Content-Disposition: attachment`，列与上表字段一致

#### 1.14.4 动作字典（action 枚举）

| 类别 | 动作 |
| --- | --- |
| 认证 | `auth.login.success` / `auth.login.failed` / `auth.logout` / `auth.locked` / `auth.change_password` |
| 用户管理 | `user.create` / `user.disable` / `user.enable` / `user.reset_password` / `user.change_role` |
| 数据写操作 | `<table>.create` / `<table>.update` / `<table>.delete`（words/reviews/stats/readingSessions/achievements/questions）+ `articles.create` / `articles.update` / `articles.delete` / `articles.mark_read` / `words.bulk_import` |
| 敏感读 | `logs.query` / `logs.export` / `class_stats.view`（谁在查日志、谁在查他人学习数据必须留痕） |
| AI 调用 | `ai.proxy.invoke`（detail 仅记 provider/model/stream，不记 prompt） |
| 权限拒绝 | `permission.denied`（任何 403，入侵探测信号） |

普通读操作（GET 列表/详情）不记录。前端日志页 `/admin/logs`（`src/features/admin/pages/AuditLogsPage.tsx`）供 teacher/admin 查看；`RequireAdmin` 以 `roles={['admin','teacher']}` 放行。

### 1.15 班级学情聚合端点（/api/admin/class-stats，P3 已实施）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/class-stats?days=N` | `stats:class`（teacher / admin） | 全班学员学习统计汇总（只读） |

**查询参数**

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `days` | number | 30 | 统计窗口天数；服务端上限 180，非正数或非数字回退默认 30 |

**统计口径**

- 学员范围：`role = 'student' AND status = 'active'`（禁用账号及其数据不计入）
- `stats` 按业务日期（id 前缀后的 `YYYY-MM-DD`）落在 `[today - days + 1, today]` 内聚合；`streak` 取窗口内最新一天的值
- 正确率按阅读会话数加权（`readingSessions.correctRate` 均值，保留两位小数），无会话记 0

**响应形态**

```json
{
  "days": 30,
  "from": "2026-09-21",
  "to": "2026-10-20",
  "summary": {
    "studentCount": 2,
    "activeStudentCount": 2,
    "totalArticlesRead": 7,
    "totalWordsLearned": 7,
    "totalWordsReviewed": 7,
    "avgArticlesRead": 3.5,
    "avgCorrectRate": 0.8,
    "totalReadingDurationSec": 1000,
    "totalSessions": 3
  },
  "students": [
    {
      "userId": "0b9ee6b2-...",
      "username": "bob",
      "displayName": "鲍勃",
      "articlesRead": 4,
      "wordsLearned": 0,
      "wordsReviewed": 7,
      "wordsMastered": 0,
      "activeDays": 1,
      "streak": 1,
      "lastActiveDate": "2026-10-20",
      "correctRate": 1
    }
  ]
}
```

- 仅返回显示名与统计数值，**不含任何学习内容**（文章/生词/笔记文本）
- 每次查询写审计日志 `class_stats.view`，detail 记录 `days` / `from` / `to` / `studentCount`
- 错误：未认证 401 `UNAUTHORIZED`；student 访问 403 `FORBIDDEN`（并留痕 `permission.denied`）

### 1.16 会话管理端点（/api/auth/sessions，P3 已实施）

自助式「我的设备」管理，路由定义于 `server/src/authRoutes.ts`，会话查询/删除逻辑见 `server/src/auth.ts`。三端点均要求登录（`authMiddleware`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/sessions` | 列出当前用户全部有效会话（脱敏指纹） |
| DELETE | `/api/auth/sessions/:id` | 移除指定设备（吊销该会话） |
| DELETE | `/api/auth/sessions` | 全端下线（吊销该用户**全部**会话，含当前端） |

#### 1.16.1 GET /api/auth/sessions（我的设备）

- 返回前惰性清理已过期会话（`DELETE FROM sessions WHERE userId = ? AND expiresAt <= now`），避免 sessions 表无限增长
- 响应（200）：

```json
{
  "items": [
    {
      "sessionId": 42,
      "tokenFingerprint": "6f9c0d8e…a1b2",
      "ip": "203.0.113.10",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": 1792372800000,
      "expiresAt": 1792977600000,
      "current": true
    }
  ]
}
```

- `sessionId` 为会话在 `sessions` 表的 `rowid`，供移除端点使用
- `tokenFingerprint` 为脱敏指纹（前 8 位 + `…` + 尾 4 位），**列表响应绝不返回完整令牌**
- `current` 标记当前请求令牌对应的设备（明文比对，前端据此禁用「移除」按钮）
- 按 `createdAt DESC` 排序（新设备在前）

#### 1.16.2 DELETE /api/auth/sessions/:id（移除设备）

- `:id` 即 1.16.1 返回的 `sessionId`（rowid）；删除以 `rowid + userId` 联合限定，**越权移除他人会话不可行**
- 成功：204（无 body），写审计日志 `auth.revoke_session`（resource `session`，result `success`）
- 错误：

| HTTP | code | 触发条件 |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | `:id` 非正整数 |
| 404 | `NOT_FOUND` | 会话不存在 / 已过期 / 属于其他用户（统一文案，不泄露存在性） |

#### 1.16.3 DELETE /api/auth/sessions（全端下线）

- 吊销该用户**全部**会话（含当前端）；其他用户不受影响
- 成功：204（无 body），写审计日志 `auth.logout_all`
- 前端 `authService.logoutAll()` 成功后清除本地会话（token / 缓存归属 / 本地用户数据），由调用方跳转登录页

> 与管理员「禁用/删除用户」的区别：本组端点是**用户自助**管理自己的登录设备；管理员对指定用户的全端下线见 1.13（用户管理端点）。

---

## 2. AI 代理端点

后端 AI 代理定义于 `server/src/ai-proxy.ts`，支持 `deepseek` / `openai` / `qwen` / `custom` 四个上游节点，转发请求到对应上游 API，隐藏服务端密钥。

### 2.1 路由表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/ai-proxy/{deepseek\|openai\|qwen\|custom}` | AI 代理主端点（按路径供应商转发到对应上游） |
| POST | `/api/v1/ai-proxy/{provider}/stream` | AI 代理流式端点（SSE，透传上游 `stream: true` 响应） |
| GET | `/api/health` | 健康检查（见 1.6） |

### 2.2 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json` |
| `x-user-token` | 是 | 有效会话令牌（多用户 P0：AI 代理位于认证门之后，前端 baseProvider 自动注入；令牌缺失/无效返回 401 `UNAUTHORIZED`，见 1.11） |

> `AI_PROXY_TOKEN` 为预留项（当前未启用，鉴权已由会话认证 `x-user-token` 覆盖）。服务端强校验「对应供应商密钥已配置」，未配置时返回 503（见 2.5）。

### 2.3 请求体

支持两种形式：

**形式一：信封格式**（与前端 `BaseAIProvider` 代理模式一致）

```typescript
interface ProxyRequestBody {
  provider: 'deepseek' | 'openai' | 'qwen' | 'custom'
  body: unknown  // 上游原始请求体
}
```

**形式二：裸 body**（直接传上游请求体）

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Say hello in Chinese." }
  ]
}
```

服务端兼容处理：`req.body?.body ?? req.body`。

#### 2.3.1 请求体 Schema 校验

为防止恶意构造 body 转发给上游（如超大 `max_tokens` 触发计费、非法 `model`），服务端在转发前对 body 进行 schema 校验（`validateUpstreamBody`）：

| 字段 | 校验规则 | 失败错误消息 |
| --- | --- | --- |
| `body` | 必须为非空对象 | `Missing body` |
| `model` | 按供应商白名单：deepseek 为 `deepseek-v4-pro`/`deepseek-v4-flash`，openai 为 `gpt-5.2`/`gpt-5.2-mini`，qwen 为 `qwen3-max`/`qwen3-turbo`；custom 为 `CUSTOM_MODELS` 白名单（未配置时不限制）；未传时不校验 | `Unsupported model: <model>` |
| `max_tokens` | 上限 4096（项目最大场景语法填空 4096，留余量） | `max_tokens exceeds limit 4096` |
| `messages` | 必须为非空数组 | `messages must be a non-empty array` |

校验失败返回 400 `INVALID_BODY`。

### 2.4 响应格式

#### 成功响应

透传上游 DeepSeek 响应：

- HTTP 状态码：上游返回的状态码（通常 200）
- `Content-Type`：保留上游原始 `Content-Type`（通常 `application/json`）
- Body：上游原始响应体

#### 错误响应

统一结构化格式：

```typescript
{
  error: {
    code: ErrorCode,    // 错误码枚举
    message: string      // 错误描述
  }
}
```

### 2.5 错误码枚举表

| 错误码 | HTTP 状态 | 触发条件 |
| --- | --- | --- |
| `PROXY_NOT_CONFIGURED` | 503 | 服务端未配置该供应商对应密钥（`DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `QWEN_API_KEY` / `CUSTOM_API_KEY`+`CUSTOM_API_ENDPOINT`）；custom 返回 503 时前端 `FallbackAIProvider` 自动回退 DeepSeek 兜底 |
| `INVALID_BODY` | 400 | `body` 缺失 / 非对象 / `model` 不在白名单 / `max_tokens` 超 4096 / `messages` 非非空数组（详见 2.3.1） |
| `TIMEOUT` | 504 | 上游 150s 未响应，AbortController 中断 fetch |
| `UPSTREAM_ERROR` | 502 | 上游请求失败（非超时的网络错误，如 DNS / 连接错误）或上游 5xx（重试耗尽） |

### 2.6 超时与限制

| 限制项 | 值 | 说明 |
| --- | --- | --- |
| 后端上游超时 | 150s（`UPSTREAM_TIMEOUT_MS`） | 前端超时 170s 大于后端，确保前端还能收到 504 错误响应 |
| 请求体大小上限 | 10mb | Express `express.json({ limit: '10mb' })` |

### 2.7 上游端点与密钥

| Provider | 上游端点 | 服务端密钥环境变量 |
| --- | --- | --- |
| deepseek | `https://api.deepseek.com/chat/completions` | `DEEPSEEK_API_KEY` |
| openai | `https://api.openai.com/v1/chat/completions` | `OPENAI_API_KEY` |
| qwen | DashScope compatible-mode 端点 | `QWEN_API_KEY` |
| custom | 由 `CUSTOM_API_ENDPOINT` 指定（默认由 `config/ai-providers.json` 派生） | `CUSTOM_API_KEY`（`CUSTOM_MODELS` 可选模型白名单） |

### 2.8 CORS 配置

CORS 与 REST API 共用同一中间件配置，详见 [1.9 CORS 白名单](#19-cors-白名单)。未配置 `CORS_ORIGIN` 时：生产环境默认仅允许本机，开发环境允许所有来源；配置后仅允许白名单来源访问 AI 代理端点。

---

## 3. AIProvider 接口

`AIProvider` 是项目对 AI 供应商的统一抽象接口，定义于 `src/shared/services/ai/types.ts`。当前有 DeepSeek / OpenAI / Qwen / Custom 四个内置实现（另有 `FallbackAIProvider` 自动降级组合装饰器，见 docs/ARCHITECTURE.md 第 5 节），实现类必须提供接口的 12 个业务方法与 `testConnection` 连接测试。

### 3.1 接口定义

```typescript
export interface AIProvider {
  // avoidTopics: 最近生成过的主题列表，提示 AI 避免重复
  // streamOptions: Phase 3 新增，传入时启用流式输出 + 中断机制；不传保持原有非流式行为
  generateArticle(
    date: string,
    genre?: Genre,
    topic?: Topic,
    difficulty?: Difficulty,
    avoidTopics?: string[],
    streamOptions?: StreamOptions
  ): Promise<ArticleGenerationResult>
  generateQuestions(
    articleId: string,
    articleContent: string,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]>
  generateTranslation(content: string): Promise<string>
  extractVocabulary(content: string): Promise<VocabularyItem[]>
  generateWordHint(word: string, definition: string): Promise<WordHint>
  generateWordBreakdown(word: string): Promise<WordBreakdown>
  generateMnemonic(word: string, definition: string, root?: string): Promise<MnemonicResult>
  generateExampleSentence(word: string, definition: string): Promise<string>
  generateEmojiHint(word: string, definition: string): Promise<string[]>
  /** 补全单个单词的音标/词性/释义/例句（用于生词本 AI 补全） */
  enrichSingleWord(word: string): Promise<VocabularyItem>
}
```

#### StreamOptions 类型（Phase 3 新增）

```typescript
export interface StreamOptions {
  signal?: AbortSignal                                        // 外部 AbortSignal，组件卸载或用户取消时中断请求
  onChunk?: (delta: string, fullText: string) => void         // 流式回调，每收到一个 delta 触发
}
```

### 3.2 方法说明

| 方法 | 参数 | 返回值 | 用途 |
| --- | --- | --- | --- |
| `generateArticle` | `date: string`（YYYY-MM-DD）<br>`genre?: Genre`（文体）<br>`topic?: Topic`（题材）<br>`difficulty?: Difficulty`（难度）<br>`avoidTopics?: string[]`（最近主题，避免重复）<br>`streamOptions?: StreamOptions`（流式选项） | `Promise<ArticleGenerationResult>` | 生成每日阅读文章（含标题、原文、翻译、生词预标注）。传入 streamOptions 启用流式输出 |
| `generateQuestions` | `articleId: string`<br>`articleContent: string`<br>`streamOptions?: StreamOptions` | `Promise<QuestionGenerationResult[]>` | 基于文章内容生成 4 选 1 阅读理解题。传入 streamOptions 启用流式输出 |
| `generateTranslation` | `content: string` | `Promise<string>` | 将英文文本翻译为中文 |
| `extractVocabulary` | `content: string` | `Promise<VocabularyItem[]>` | 从文章中提取生词列表（含音标、词性、释义、例句、重要度）。使用 v4-flash 模型 + 24h 缓存 |
| `generateWordHint` | `word: string`<br>`definition: string` | `Promise<WordHint>` | 生成单词提示（图像联想 + 记忆口诀） |
| `generateWordBreakdown` | `word: string` | `Promise<WordBreakdown>` | 生成单词自然拼读分解与音节数 |
| `generateMnemonic` | `word: string`<br>`definition: string`<br>`root?: string`（词根，可选） | `Promise<MnemonicResult>` | 生成趣味助记口诀（如 "family → father and mother I love you"） |
| `generateExampleSentence` | `word: string`<br>`definition: string` | `Promise<string>` | 生成包含该词的真题例句或自适应例句 |
| `generateEmojiHint` | `word: string`<br>`definition: string` | `Promise<string[]>` | 生成 1-3 个 emoji 助记字符（无图片成本） |
| `enrichSingleWord` | `word: string` | `Promise<VocabularyItem>` | 补全单个单词的音标/词性/释义/例句（用于生词本 AI 补全） |

### 3.3 返回值类型定义

```typescript
// 文章生成结果
export interface ArticleGenerationResult {
  title: string
  content: string              // 200-300 词英文原文
  translation: string          // 全文中文翻译
  genre: Genre                 // 文体：'narrative' | 'expository' | 'practical'
  wordCount: number
  topic: Topic                 // 题材
  difficulty: Difficulty       // 难度：'easy' | 'medium' | 'hard'
  lexileRange: { min: number; max: number }  // 蓝思值范围
  highlightedWords: HighlightedWord[]        // AI 预标注生词
}

// 阅读理解题
export interface QuestionGenerationResult {
  id: string
  type: QuestionType           // 'main_idea' | 'detail' | 'inference' | 'word_guess'
  stem: string
  options: [string, string, string, string]
  correctIndex: number        // 0-3
  explanation: string
  locationClue: string
}

// 词汇条目
export interface VocabularyItem {
  word: string
  phonetic: string
  pos: string                  // 词性
  definition: string
  example: string
  importance: VocabularyImportance  // 'high' | 'medium' | 'low'
}

// 单词提示
export interface WordHint {
  imageAssociation: string    // AI 生成的图像联想描述
  mnemonic: string             // 记忆口诀
}

// 单词拼读分解
export interface WordBreakdown {
  phonics: string[]            // 自然拼读分解，如 ["ap", "ple"]
  syllables: number            // 音节数
}

// 趣味助记口诀
export interface MnemonicResult {
  mnemonic: string
  explanation?: string         // 口诀解释（可选）
}
```

### 3.4 辅助类型

```typescript
// 聊天消息（DeepSeek 采用 OpenAI 兼容协议）
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 文体类型
export type Genre = 'narrative' | 'expository' | 'practical'

// 题型
export type QuestionType = 'main_idea' | 'detail' | 'inference' | 'word_guess'

// 词汇重要程度
export type VocabularyImportance = 'high' | 'medium' | 'low'
```

> `Topic`、`Difficulty`、`HighlightedWord` 等公共类型定义于 `src/shared/types/index.ts`，详见 [第 6 章 核心数据类型](#6-核心数据类型)。

### 3.5 AIError 异常类型

所有 `AIProvider` 方法的失败均通过 `AIError` 抛出，定义于 `src/shared/services/ai/types.ts`：

```typescript
export class AIError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'AIError'
  }
}
```

错误特征：

- `err.name === 'AIError'`，`err.message` 为中文错误描述
- `err.cause` 可选，保留原始错误对象（如 fetch 异常、JSON 解析异常）便于排查
- 常见 message：
  - `deepseek 请求发送失败（网络错误）` — fetch 抛出非超时异常
  - `请求超时（170s）` — 前端 170s 超时（`getFetchTimeoutMs()`）
  - `deepseek 请求失败：HTTP ${status} ${statusText} - ${errorMessage}` — 非 2xx 响应
  - `deepseek 响应解析失败` — 响应非 JSON
  - `deepseek 响应中未包含有效的文本内容` — 解析结果为空
  - `文章生成结果缺少必要字段: ${label}` — 业务字段校验失败

调用方推荐模式：

```typescript
import { aiProvider, AIError } from '@/shared/services/ai'

try {
  const article = await aiProvider.generateArticle('2026-07-11')
  // 处理结果
} catch (err) {
  if (err instanceof AIError) {
    // 重试已耗尽或 4xx 错误，降级到本地兜底素材库
    console.warn('[articleService] AI 调用失败', err)
  } else {
    throw err
  }
}
```

### 3.6 generateArticle 调用与返回值示例

调用：

```typescript
const result = await aiProvider.generateArticle(
  '2026-07-11',
  'expository',
  'science',
  'medium'
)
```

返回值：

```json
{
  "title": "The Quiet Power of Mushrooms",
  "content": "Mushrooms are not plants...",
  "translation": "蘑菇不是植物...",
  "genre": "expository",
  "wordCount": 245,
  "topic": "science",
  "difficulty": "medium",
  "lexileRange": { "min": 700, "max": 850 },
  "highlightedWords": [
    {
      "word": "decompose",
      "phonetic": "/ˌdiːkəmˈpoʊz/",
      "pos": "v.",
      "definition": "分解",
      "example": "Bacteria decompose organic matter."
    }
  ]
}
```

---

## 4. BaseAIProvider 抽象基类

`BaseAIProvider` 是 DeepSeekProvider 的公共抽象基类，定义于 `src/shared/services/ai/baseProvider.ts`，采用**模板方法模式（Template Method Pattern）**抽取公共逻辑：基类实现通用的端点解析、HTTP 调用、异常包装、重试机制、9 个公开方法；子类仅实现差异化的 5 个抽象方法。

### 4.1 BaseProviderConfig 接口

```typescript
export interface BaseProviderConfig {
  apiKey?: string       // 直连模式的上游密钥；代理模式下作为代理令牌
  model?: string        // 模型名，未指定时使用 defaultModel()
  proxyBaseUrl?: string // 代理地址（存在时走代理模式）
}
```

### 4.2 抽象方法（子类必须实现）

| 方法 | 可见性 | 签名 | 用途 |
| --- | --- | --- | --- |
| `providerName()` | public | `abstract providerName(): string` | 返回 Provider 名称（`'deepseek'`），用于代理模式请求体的 `provider` 字段与端点拼接 |
| `defaultEndpoint()` | public | `abstract defaultEndpoint(): string` | 返回直连模式的默认上游端点 URL |
| `defaultModel()` | protected | `abstract defaultModel(): string` | 返回默认模型名（当 `config.model` 未指定时使用） |
| `buildRequestBody(messages)` | public | `abstract buildRequestBody(messages: ChatMessage[]): unknown` | 构造上游请求体（直连模式即为最终 body；代理模式作为信封 `body` 字段） |
| `parseContent(data)` | public | `abstract parseContent(data: unknown): string` | 从上游响应中提取助手消息内容（返回空字符串表示无效内容） |

### 4.3 通用实现（基类已实现，子类无需覆盖）

| 方法 | 可见性 | 签名 | 说明 |
| --- | --- | --- | --- |
| `resolveEndpoint()` | protected | `resolveEndpoint(): string` | 解析最终请求端点。走代理则拼接 `${proxyBaseUrl.replace(/\/+$/, '')}/v1/ai-proxy/${providerName()}`；否则返回 `defaultEndpoint()` |
| `callChat(messages)` | protected | `callChat(messages: ChatMessage[]): Promise<string>` | 统一处理 Chat 请求/响应/错误：端点解析、headers 设置、信封 body 包装、fetch（含 170s 超时）、HTTP 状态校验、内容提取。整个流程包装在 `retryWithBackoff` 中，对网络错误/超时/5xx 自动重试 2 次 |
| `withAIError(fn, fallbackMsg)` | protected | `withAIError<T>(fn: () => Promise<T>, fallbackMsg: string): Promise<T>` | 包装异步操作，确保任何异常都转换为 `AIError`（已是 AIError 的原样抛出） |

此外还有内部辅助：

- `getFetchTimeoutMs()`（protected）：返回前端 fetch 超时阈值 `60_000` ms，子类/测试可覆盖
- `retryWithBackoff(fn, maxRetries=2)`（private）：指数退避重试，第 1 次等待 1000ms，第 2 次等待 2000ms
- `isRetryableError(err)`（private）：判断错误是否可重试（非 AIError / `RetryableAIError` / message 含 "网络错误" 可重试；4xx 与解析错误不重试）

### 4.4 模板方法模式说明

```
┌─────────────────────────────────────────────────────────────┐
│                    BaseAIProvider (抽象基类)                 │
│                                                             │
│  通用实现（子类无需覆盖）：                                    │
│  - constructor(config)         字段初始化 + 缺失警告          │
│  - resolveEndpoint()           端点解析（直连 vs 代理）        │
│  - callChat(messages)          HTTP 调用 + 重试 + 解析        │
│  - withAIError(fn, fallback)   异常包装                       │
│  - retryWithBackoff(fn, n)     指数退避重试                   │
│  - generateArticle()           9 个公开方法（复用 callChat）   │
│  - generateQuestions()         ...                            │
│  - ... (共 9 个)                                             │
│                                                             │
│  抽象方法（子类必须实现）：                                    │
│  - providerName()                                            │
│  - defaultEndpoint()                                        │
│  - defaultModel()                                            │
│  - buildRequestBody(messages)                               │
│  - parseContent(data)                                       │
└─────────────────────────────────────────────────────────────┘
            ▲
            │ extends
            │
┌───────────┴────────┐
│ DeepSeekProvider   │
│                    │
│ providerName()     │
│   → 'deepseek'     │
│ defaultEndpoint()  │
│   → DeepSeek URL   │
│ defaultModel()     │
│   → deepseek-v4-pro│
│ buildRequestBody   │
│   → {model,msgs}   │
│ parseContent()     │
│   → choices[0]     │
└────────────────────┘
```

### 4.5 子类实现示例

#### DeepSeekProvider（`src/shared/services/ai/deepseekProvider.ts`）

```typescript
export class DeepSeekProvider extends BaseAIProvider {
  static readonly PRO_MODEL = 'deepseek-v4-pro'      // 高质量模型（复杂任务）
  static readonly FLASH_MODEL = 'deepseek-v4-flash'   // 轻量模型（简单任务，成本约 1/3）

  providerName(): 'deepseek' { return 'deepseek' }
  defaultEndpoint(): string { return 'https://api.deepseek.com/chat/completions' }
  protected defaultModel(): string { return DeepSeekProvider.PRO_MODEL }
  protected getFlashModel(): string { return DeepSeekProvider.FLASH_MODEL }

  buildRequestBody(messages: ChatMessage[], options?: BuildOptions): unknown {
    // 构造 { model, messages, max_tokens?, thinking?, reasoning_effort? }
    // model 优先使用 options.modelOverride（模型分级），其次使用 this.model
    return { model: options?.modelOverride ?? this.model, messages, ... }
  }

  parseContent(data: unknown): string {
    return (data as { choices?: Array<{ message?: { content?: string } }> })
      ?.choices?.[0]?.message?.content ?? ''
  }
}
```

### 4.6 重试与超时机制

| 维度 | 前端（BaseAIProvider） | 后端（ai-proxy.ts） |
| --- | --- | --- |
| 超时阈值 | 170s（`getFetchTimeoutMs()`） | 150s（`UPSTREAM_TIMEOUT_MS`） |
| 超时实现 | `AbortController` + `setTimeout` | `AbortController` + `setTimeout` |
| 重试次数 | 最多 2 次（首次 + 2 次重试） | 最多 2 次（首次 + 2 次重试） |
| 退避间隔 | 指数退避：1000ms、2000ms | 指数退避：1000ms、2000ms（429/5xx 优先使用 Retry-After 头，上限 30s） |
| 可重试条件 | 网络错误、超时（AbortError）、上游 5xx | 网络错误（非 AbortError）、上游 5xx/429 |
| 不重试条件 | 4xx 客户端错误、响应解析错误、内容缺失 | 超时（AbortError）直接抛出交由上层处理为 504 |

> 端到端超时设计：前端 170s 大于后端单次 150s 超时，确保单次上游超时时前端仍能收到 504 错误响应；170s 同时覆盖后端快速重试（网络错误 1s/2s 退避）与长响应生成时延（语法填空/文章生成在第三方平台可能需 75-150s）。若后端多次 150s 超时导致总时长超过 170s，前端先超时并展示错误。

`RetryableAIError` 是 `baseProvider.ts` 内部的私有类，继承 `AIError`，用于标记可重试错误（5xx、网络错误、超时）。`retryWithBackoff` 据此判断是否重试。

---

## 5. Repository 接口

项目采用**服务器为主 + Dexie 离线只读缓存**策略，数据访问层包含三个层次：

- `Repository<T>`：基于 Dexie 的本地泛型 CRUD，作为离线只读缓存
- `RemoteRepository<T>`：基于 REST API 的远程 CRUD（服务器为主）
- `CachedRemoteRepository<T>`：组合上述两者，服务器优先 + Dexie 离线回退

### 5.1 Repository\<T\> 泛型接口（本地缓存）

定义于 `src/shared/services/repository.ts`，封装本地 IndexedDB 表的通用 CRUD 操作，自动维护 `updated_at` 字段。

```typescript
import type { Table, UpdateSpec } from 'dexie'
import type { BaseEntity } from '@/shared/types'

export class Repository<T extends BaseEntity> {
  constructor(private readonly table: Table<T, string>) {}

  async getAll(): Promise<T[]>
  async getById(id: string): Promise<T | undefined>
  async add(entity: Omit<T, 'updated_at'> & { updated_at?: number }): Promise<string>
  async update(id: string, patch: Partial<Omit<T, 'updated_at'>>): Promise<number>
  async delete(id: string): Promise<void>
  async bulkDelete(ids: string[]): Promise<void>
  async put(entity: T): Promise<string>  // upsert，用于将服务器数据同步到本地缓存
}
```

### 5.2 RemoteRepository\<T\>（服务器为主）

定义于 `src/shared/services/remoteRepository.ts`，基于 `localApi` 封装 REST API 调用。

```typescript
export class RemoteRepository<T extends BaseEntity> {
  constructor(private readonly basePath: string) {}

  async getAll(): Promise<T[]>                    // GET /api/{basePath}
  async getById(id: string): Promise<T | undefined> // GET /api/{basePath}/{id}
  async add(entity): Promise<T>                   // POST /api/{basePath}
  async update(id, patch): Promise<T>             // PUT /api/{basePath}/{id}
  async delete(id: string): Promise<void>         // DELETE /api/{basePath}/{id}
  async bulkDelete(ids: string[]): Promise<void>  // 逐条 DELETE
}
```

### 5.3 CachedRemoteRepository\<T\>（组合策略）

定义于 `src/shared/services/remoteRepository.ts`，服务器为主 + Dexie 离线只读缓存：

- **读取**：先请求服务器，成功后同步到本地缓存；网络失败时回退到本地缓存
- **写入**：写入服务器，成功后同步更新本地缓存

```typescript
export class CachedRemoteRepository<T extends BaseEntity> {
  constructor(
    private readonly remote: RemoteRepository<T>,
    private readonly local: Repository<T>,
  ) {}

  async getAll(): Promise<T[]>
  async getById(id: string): Promise<T | undefined>
  async add(entity): Promise<T>
  async update(id, patch): Promise<T>
  async delete(id: string): Promise<void>
  async bulkDelete(ids: string[]): Promise<void>
}
```

> 网络失败时，`localApi` 会触发自定义事件 `ydxl:offline`，供 UI 层显示离线提示 banner。

### 5.4 各 feature 的 Repository 实例

定义于 `src/shared/services/repositories.ts`：

| Repository 实例 | 类型 | REST basePath | 本地 Dexie 表 | 说明 |
| --- | --- | --- | --- | --- |
| `articleRepository` | `CachedRemoteRepository<Article>` | `articles` | `db.articles` | 文章数据访问 |
| `questionRepository` | `CachedRemoteRepository<Question>` | `questions` | `db.questions` | 阅读题数据访问 |
| `wordRepository` | `CachedRemoteRepository<Word>` | `words` | `db.words` | 生词本数据访问（本地扩展 `getByStabilityDesc()`） |
| `reviewRepository` | `CachedRemoteRepository<Review>` | `reviews` | `db.reviews` | 复习记录数据访问 |
| `statsRepository` | `CachedRemoteRepository<Stats>` | `stats` | `db.stats` | 学习统计数据访问 |
| `readingSessionRepository` | `CachedRemoteRepository<ReadingSession>` | `readingSessions` | `db.readingSessions` | 阅读会话数据访问 |
| `achievementRepository` | `CachedRemoteRepository<Achievement>` | `achievements` | `db.achievements` | 成就数据访问 |

### 5.5 WordRepository 扩展

`WordRepository` 继承 `Repository<Word>`，新增按稳固度排序查询：

```typescript
export class WordRepository extends Repository<Word> {
  // 获取按 stabilityScore 降序排列的单词列表
  // - stabilityScore 缺失视为 0
  // - 用于"稳固度排行"或"最薄弱词优先"场景
  async getByStabilityDesc(): Promise<Word[]>
}
```

### 5.6 使用示例

```typescript
import { articleRepository } from '@/shared/services/repositories'

// 新增文章（服务器为主，成功后同步到本地缓存）
const article = await articleRepository.add({
  id: '2026-07-11',
  title: 'The Quiet Power of Mushrooms',
  content: '...',
  translation: '...',
  genre: 'expository',
  wordCount: 245,
  createdAt: Date.now(),
  // updated_at 由 RemoteRepository 自动写入
})

// 查询单条（服务器优先，失败回退本地缓存）
const article = await articleRepository.getById('2026-07-11')

// 部分更新（服务器为主，成功后同步更新本地缓存）
await articleRepository.update('2026-07-11', { wordCount: 250 })

// 删除
await articleRepository.delete('2026-07-11')
```

---

## 6. 核心数据类型

核心数据类型定义于 `src/shared/types/index.ts`，是前端 Dexie 表与服务器 SQLite 表共用的实体类型（两端均采用 **camelCase** 字段名，无需字段映射转换）。

### 6.1 BaseEntity 基础接口

所有表实体统一包含主键与时间戳字段：

```typescript
export interface BaseEntity {
  id: string           // 主键（字符串）
  updated_at: number   // 毫秒时间戳，记录修改时间
}
```

> `updated_at` 为 snake_case，与前端类型定义对齐；其余字段均为 camelCase。

### 6.2 公共枚举类型

```typescript
// 文体类型
export type Genre = 'narrative' | 'expository' | 'practical'

// 题型
export type QuestionType = 'main_idea' | 'detail' | 'inference' | 'word_guess'

// 复习步骤
export type ReviewStep = 'learn' | 'read' | 'practice' | 'spell' | 'write'

// 文章主题
export type Topic =
  | 'campus' | 'science' | 'culture' | 'biography'
  | 'travel' | 'sports' | 'technology' | 'nature'

// 难度等级
export type Difficulty = 'easy' | 'medium' | 'hard'

// AI 预标注生词
export interface HighlightedWord {
  word: string
  phonetic: string
  pos: string          // 词性
  definition: string  // 释义
  example: string     // 例句
}
```

### 6.3 Article（每日阅读文章）

```typescript
export interface Article extends BaseEntity {
  // id 格式 YYYY-MM-DD
  title: string
  content: string
  translation: string
  genre: Genre
  wordCount: number
  createdAt: number
  topic?: Topic                    // 可选，兼容历史数据
  difficulty?: Difficulty          // 可选，兼容历史数据
  lexileRange?: { min: number; max: number }  // 蓝思值范围
  highlightedWords?: HighlightedWord[]       // AI 预标注生词
  contentHash?: string             // 文章内容指纹（SHA-256 前 16 位），用于去重
  readAt?: number | null           // 阅读完成时间戳（毫秒），null 表示未读
  startedAt?: number | null        // 开始阅读时间戳（毫秒），null/undefined 表示未开始阅读
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `contentHash` | TEXT（16 位 hex） | 基于「标题+正文」计算的 SHA-256 前 16 位指纹，用于文章去重；SQLite 建立 `idx_articles_content_hash` 索引 |
| `readAt` | INTEGER | 阅读完成时间戳（毫秒），`null` 表示未读；`markAsRead` 写入，`getReadHistory` 按 `readAt` 倒序查询。多用户下实际按用户存于 `user_article_states`，API 响应时按当前用户合并（见 1.12） |
| `startedAt` | INTEGER | 开始阅读时间戳（毫秒），`null`/`undefined` 表示未开始阅读；用于追踪用户阅读行为，首页「最近阅读」模块据此展示阅读状态徽章。多用户下实际按用户存于 `user_article_states`，API 响应时按当前用户合并（见 1.12） |

> 注：服务端 SQLite 通过 `ALTER TABLE ADD COLUMN` 兼容旧数据库；前端 Dexie v4 schema 为 articles 表新增 `contentHash` 与 `readAt` 索引。

### 6.4 Question（阅读理解题）

```typescript
export interface Question extends BaseEntity {
  // id 格式 `${articleId}-${n}`
  articleId: string
  type: QuestionType
  stem: string
  options: [string, string, string, string]
  correctIndex: number    // 0-3
  explanation: string
  locationClue: string
  createdAt: number
}
```

### 6.5 Word（生词本）

```typescript
export interface Word extends BaseEntity {
  // id 使用 word 本身
  word: string
  phonetic: string
  pos: string
  definition: string
  example: string
  root?: string
  note?: string
  mastery: number          // 掌握度
  nextReview: number        // 下次复习时间戳
  lastReview: number       // 上次复习时间戳
  reviewCount: number
  interval: number         // SM-2 间隔（天）
  easeFactor: number       // SM-2 难度因子
  sourceArticleId?: string
  createdAt: number
  stubbornCount?: number       // 顽固词错误计数，默认 0
  achievementTags?: string[]   // 成就标签（如 'stubborn' 'mastered'），默认 []
  stabilityScore?: number      // 记忆稳固度 0-100
}
```

### 6.6 Review（复习记录）

```typescript
export interface Review extends BaseEntity {
  wordId: string
  step: ReviewStep
  correct: boolean
  correctRate: number      // 0-1
  timeSpent: number        // 毫秒
  reviewedAt: number       // 复习时间戳
}
```

### 6.7 Stats（学习统计，按日聚合）

```typescript
export interface Stats extends BaseEntity {
  // id 格式 YYYY-MM-DD
  articlesRead: number
  wordsLearned: number
  wordsReviewed: number
  wordsMastered: number
  streak: number           // 连续学习天数
}
```

### 6.8 ReadingSession（阅读会话记录）

```typescript
export interface ReadingSession extends BaseEntity {
  // id 格式 `${articleId}-${timestamp}` 或 UUID
  articleId: string        // 外键，关联 articles 表
  durationSec: number      // 阅读用时（秒）
  wordCount: number        // 文章字数
  correctRate: number      // 答题正确率 0-1
  reviewedAt: number       // 阅读时间戳（毫秒）
}
```

### 6.9 Achievement（成就）

```typescript
export interface Achievement extends BaseEntity {
  // id 为成就规则 ID（如 'reading-star' 'all-correct-king'）
  name: string             // 成就名称（如 "阅读之星"）
  description: string
  icon: string             // emoji 或图标名（如 "⭐" "🏆"）
  unlockedAt: number      // 解锁时间戳（毫秒），0 表示未解锁
}
```

### 6.10 字段命名一致性

前端 Dexie 表与服务器 SQLite 表均采用 camelCase 字段名（`BaseEntity.updated_at` 除外，为对齐前端类型定义保留 snake_case）。**无需字段映射转换**，REST API 请求/响应体字段名与 TypeScript 类型定义完全一致。

---

## 7. 请求/响应示例

### 7.1 AI 代理请求示例（curl）

```bash
curl -X POST 'http://localhost:3001/api/v1/ai-proxy/deepseek' \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "deepseek",
    "body": {
      "model": "deepseek-v4-pro",
      "messages": [
        { "role": "system", "content": "You are a helpful assistant." },
        { "role": "user", "content": "Say hello in Chinese." }
      ]
    }
  }'
```

### 7.2 AI 响应示例

DeepSeek 采用 OpenAI 兼容协议，响应结构如下：

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1720000000,
  "model": "deepseek-v4-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 5,
    "total_tokens": 25
  }
}
```

提取规则：`data.choices[0].message.content` → `"你好！"`

### 7.3 REST API 请求示例

详见 [第 1 章 Local Server REST API](#14-请求示例) 的 curl 示例。

TypeScript 调用示例（通过 `localApi` 客户端）：

```typescript
import { localApi } from '@/shared/services/localApi'

// 获取文章列表（分页响应：{ items, total, limit, offset }）
const page = await localApi.get<{ items: Article[]; total: number; limit: number; offset: number }>('/articles?limit=20&offset=0')

// 新增文章
const created = await localApi.post<Article>('/articles', {
  id: '2026-07-11',
  title: '...',
  content: '...',
  // ...
})

// 更新文章（可用于 markAsRead 写入 readAt）
const updated = await localApi.put<Article>('/articles', '2026-07-11', {
  readAt: Date.now(),
})

// 删除文章
await localApi.del('/articles', '2026-07-11')
```

> 阅读历史查询：服务端 GET 端点返回全部分页记录，已读文章过滤在前端 `articleService.getReadHistory(limit=50)` 中完成（过滤 `readAt != null` 并按 `readAt` 倒序截取前 `limit` 条），未提供 `?read=true` 服务端过滤参数。`markAsRead(articleId)` 通过 `PUT /api/articles/:id` 写入 `readAt: Date.now()`。

### 7.4 错误响应示例

#### 503 服务未配置

```json
{
  "error": {
    "code": "PROXY_NOT_CONFIGURED",
    "message": "DEEPSEEK_API_KEY not configured"
  }
}
```

#### 400 请求体格式错误

```json
{
  "error": {
    "code": "INVALID_BODY",
    "message": "Missing body"
  }
}
```

#### 504 网关超时

```json
{
  "error": {
    "code": "TIMEOUT",
    "message": "Upstream request timed out"
  }
}
```

#### 502 上游网络错误

```json
{
  "error": {
    "code": "UPSTREAM_ERROR",
    "message": "fetch failed"
  }
}
```

#### 429 限流

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

#### 上游 4xx/5xx 透传示例（如 DeepSeek 401）

响应状态码：401（透传上游状态码）

响应体（透传上游原始响应体，保留原始 `Content-Type`）：

```json
{
  "error": {
    "message": "Incorrect API key provided",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

---

## 8. AIProviderName 类型

`AIProviderName` 是项目对 AI 供应商名称的统一联合类型，定义于 `src/shared/services/ai/types.ts`：

```typescript
// AI 供应商名称（统一类型，供 ai/index.ts 工厂使用）
export type AIProviderName = 'deepseek'
```

### 8.1 取值说明

| 值 | 供应商 | 默认模型 | 上游端点 |
| --- | --- | --- | --- |
| `'deepseek'` | DeepSeek（深度求索） | `deepseek-v4-pro` | `https://api.deepseek.com/chat/completions` |

### 8.2 使用位置

#### 8.2.1 `src/shared/services/ai/index.ts`（工厂函数）

`createAIProvider()` 工厂函数直接返回 `DeepSeekProvider` 实例：

```typescript
export function createAIProvider(): AIProvider {
  if (proxyUrl) {
    // 生产环境：走代理，apiKey 字段承载代理令牌
    return new DeepSeekProvider({
      proxyBaseUrl: proxyUrl,
      apiKey: proxyToken,
      model: env.VITE_DEEPSEEK_MODEL as string | undefined,
    })
  }
  // 开发环境：直连，使用本地密钥
  return new DeepSeekProvider({
    apiKey: env.VITE_DEEPSEEK_API_KEY as string | undefined,
    model: env.VITE_DEEPSEEK_MODEL as string | undefined,
  })
}
```

`AIProviderName` 从该文件统一导出，供其他模块复用。

#### 8.2.2 `server/src/ai-proxy.ts`（后端 AI 代理）

后端 AI 代理仅处理 `/api/v1/ai-proxy/deepseek` 路由，无 provider 分支判断。

### 8.3 与环境变量的关系

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `VITE_DEEPSEEK_API_KEY` | 前端直连模式密钥（开发环境，留空走代理模式） | — |
| `VITE_DEEPSEEK_MODEL` | DeepSeek 模型名 | `deepseek-v4-pro` |
| `VITE_AI_PROXY_URL` | 代理地址（生产环境，可选） | — |
| `VITE_AI_PROXY_TOKEN` | 代理访问令牌（可选，当前未实现鉴权） | — |
| `DEEPSEEK_API_KEY` | 服务端 AI 代理密钥（必填，否则返回 503） | — |
| `AI_PROXY_TOKEN` | 代理鉴权 token（预留项；AI 代理当前由会话认证 `x-user-token` 保护，见 2.2） | — |
| `CORS_ORIGIN` | CORS 允许来源白名单（逗号分隔） | 未配置时：生产环境仅本机，开发环境 `*` |
| `ENCRYPTION_KEY` | SQLite 敏感字段加密密钥 | 未配置时：生产环境拒绝启动，开发环境禁用加密 |
| `ADMIN_USERNAME` | 多用户迁移创建的首个管理员用户名 | 默认 `admin`（见 1.11.6） |
| `ADMIN_INITIAL_PASSWORD` | 首个管理员初始密码 | 未配置时启动随机生成并打印一次（见 DATABASE.md 3.8.1） |
| `PORT` | 服务器端口 | `3001` |

关系链：

```
VITE_AI_PROXY_URL（环境变量）
    ↓ 存在性判断
ai/index.ts: createAIProvider()
    ↓ 工厂函数
DeepSeekProvider（代理模式 或 直连模式）
```

> 注意：本地 / 局域部署默认走直连模式（`VITE_AI_PROXY_URL` 留空），前端直接通过 Vite proxy 或 Nginx 反代访问 `/api/v1/ai-proxy/deepseek`。代理模式为可选，用于需要额外鉴权的场景。

---

## 附录：源码文件索引

| 章节 | 源码文件 |
| --- | --- |
| Local Server REST API | `server/src/index.ts`、`server/src/routes.ts`、`server/src/db.ts` |
| 认证（会话 / 密码 / 登录锁定） | `server/src/auth.ts` |
| 认证路由 /api/auth/* | `server/src/authRoutes.ts` |
| 多用户数据迁移 | `server/src/migrateMultiUser.ts` |
| AI 代理端点 | `server/src/ai-proxy.ts`、`server/src/aiConfig.ts`（供应商单一注册表加载器） |
| 字段加密 | `server/src/encryption.ts` |
| AIProvider 接口 | `src/shared/services/ai/types.ts` |
| BaseAIProvider 抽象基类 | `src/shared/services/ai/baseProvider.ts` |
| DeepSeekProvider | `src/shared/services/ai/deepseekProvider.ts` |
| AI 工厂与统一导出 | `src/shared/services/ai/index.ts` |
| Repository 泛型（本地缓存） | `src/shared/services/repository.ts` |
| RemoteRepository / CachedRemoteRepository | `src/shared/services/remoteRepository.ts` |
| Repository 实例 | `src/shared/services/repositories.ts` |
| localApi 客户端 | `src/shared/services/localApi.ts` |
| 前端会话令牌管理（authService） | `src/shared/services/authService.ts` |
| 核心数据类型 | `src/shared/types/index.ts` |
