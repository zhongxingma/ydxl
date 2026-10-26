# 多用户系统架构设计方案

> 状态：**P0（认证与数据隔离）已实施并通过全量验证**（落地摘要见第 7.1 节）；**P1（RBAC 与用户管理）已实施**（见第 7.2 节）；**P2（审计日志）已实施**（见第 7.3 节）；**P3（加固与运营）部分实施**（班级学情聚合见 7.4，其余子项待实施）。原始目标：在**现有功能模块零改动、零破坏**的前提下，为 ydxl 增加多用户能力：数据隔离、RBAC 权限体系、操作审计日志、并发与安全防护、历史数据平滑迁移。
>
> 本文档的「现状」均为设计时点（P0 实施前）的代码事实：`server/src/`（Express + better-sqlite3，7 张表，无鉴权）、`src/shared/services/`（localApi 不带身份头，CORS 已放行 `x-user-token` 头）、`src/shared/types/`（实体主键不含用户维度）。P0 落地后现状已变（SQLite 12 张表；除 /api/health 与 /api/auth/* 外，其余 /api 端点均需会话令牌；localApi 与 AI 调用自动注入身份头），当前实际表结构与契约以 [DATABASE](./DATABASE.md)、[API_REFERENCE](./API_REFERENCE.md) 为准。

## 0. 现状约束与核心矛盾

| # | 现状事实 | 对多用户的影响 | 出处 |
| --- | --- | --- | --- |
| 1 | 无任何鉴权，所有 API 匿名可访问 | 需新增认证层，但不能改动现有 7 张表路由的行为契约 | `server/src/index.ts` |
| 2 | `words.id = 单词本身`、`stats.id = YYYY-MM-DD`、`achievements.id = 规则ID` | 两个用户收藏同一单词 / 同一天统计 → **主键碰撞**，必须改造 | `server/src/db.ts` |
| 3 | `articles.id = YYYY-MM-DD` 且 AI 生成成本高 | 文章天然适合**全站共享**（同日一篇，省 token），但 `readAt/startedAt` 是私有阅读状态却写在共享行上，必须剥离 | `src/shared/types/index.ts` |
| 4 | CORS 已放行 `x-user-token` 请求头 | 认证头可直接复用，无需改 CORS 配置 | `server/src/index.ts:69` |
| 5 | 前端 Dexie 缓存（`ydxl-db`）按单用户设计 | 切换账号必须隔离或清空本地缓存，防止串号泄露 | `src/shared/services/db.ts` |
| 6 | better-sqlite3 同步 API + WAL | 单进程内写操作天然串行，无写-写竞争；事务支持开箱即用 | `server/src/db.ts:27` |
| 7 | `words.note` 已 AES-256-GCM 加密 | 加密机制直接延续，密钥管理不变 | `server/src/encryption.ts` |
| 8 | 业务规模：本地/局域网，教师 + 一个班学生（数十人量级） | 不需要分布式、不需要外部 IdP、不需要 JWT 生态，**SQLite + 自建会话足够** | README |

## 1. 总体架构

### 1.1 请求管道（新增层以 ★ 标注，现有层不变）

```
浏览器 fetch (携带 x-user-token)
  → CORS（现有，已放行 x-user-token）
  → express.json 10mb（现有）
  → 全局限流 60/min/IP（现有）
  → ★ 认证中间件 authMiddleware：解析 token → 挂载 req.user（未认证→401）
  → ★ 授权中间件 requirePermission(perm)：按角色校验（无权限→403）
  → ★ 数据隔离：路由层将 req.user.id 注入查询/写入（用户只能触达自己的行）
  → 现有 7 张表路由 / AI 代理（逻辑不变）
  → ★ 审计中间件：按规则落 operation_logs（异步、失败不阻塞主流程）
  → 全局错误处理（现有）
```

**关键取舍：认证用「不透明会话令牌 + 服务端 sessions 表」，不用 JWT。**
理由：① 规模数十人，JWT 的跨服务验签优势用不上；② 不透明令牌可**即时吊销**（改密码/管理员禁用用户即失效），JWT 做不到（需额外黑名单，反而更复杂）；③ 零新增依赖（`crypto.randomBytes` 生成），符合低成本原则；④ `x-user-token` 头已被 CORS 放行，前端 localApi 只需加一个 header 注入点。

### 1.2 数据隔离模型（本方案最重要的取舍）

把 7 张现有表分为两类：

| 类别 | 表 | 隔离策略 | 理由 |
| --- | --- | --- | --- |
| **共享内容**（全站一份） | `articles`、`questions` | 不加用户维度，所有用户只读共享 | 文章 id=日期，AI 生成 1 篇全站用，**省 N 倍 token 成本**；内容无隐私性 |
| **私有数据**（按用户隔离） | `words`、`reviews`、`stats`、`readingSessions`、`achievements` | 加 `userId` 列，所有查询强制 `WHERE userId = ?` | 生词本/复习/统计/成就均为个人学习轨迹，必须严格隔离 |
| **私有阅读状态**（从共享表剥离） | 原 `articles.readAt/startedAt` | 迁入新表 `user_article_states(userId, articleId)` | 共享文章行不能承载私有状态，否则互相覆盖 |

**取舍说明**：「文章共享」换来的是零额外 AI 成本与零文章迁移；代价是「按用户生成个性化每日文章」被放弃——当前业务（同班级同进度）不需要个性化，且 vocabularyService 的按需提取逻辑天然兼容共享文章。若未来需要个性化，可在 `articles` 加可空 `ownerId`（NULL=共享），属向后兼容扩展，不在本期范围。

### 1.3 主键碰撞的解法：服务端透明前缀映射

私有表的 id 规则不变（`words.id=单词`、`stats.id=日期`），但**存储层** id 变为 `${userId}:${原id}`。映射全部收敛在 `server/src/routes.ts` 的序列化/反序列化层：

- **写入**：`sanitizeBody` 后，对私有表强制 `body.userId = req.user.id`、`body.id = ${req.user.id}:${body.id}`
- **读取**：返回前剥离 id 前缀、删除 userId 字段（前端看到的实体与今天完全一致）
- **`/:id` 路径参数**：路由入口统一补前缀再查询

**取舍说明**：备选方案是「前端类型加 userId 字段 + id 语义改造」，需要动 5 个 feature 的 service/store，违背「零改动」约束；前缀映射把爆炸半径收敛到服务端一个文件，前端实体类型、Dexie schema、业务组件**全部不动**。代价是 reviews.wordId 等引用字段同样要做映射（同一函数处理），以及 id 长度翻倍（SQLite TEXT 主键无实际影响）。

## 2. 数据库设计

### 2.1 新增表（4 张）

```sql
-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,                -- UUID（crypto.randomUUID）
  username TEXT NOT NULL UNIQUE,      -- 登录名，唯一约束兜底并发注册竞态
  displayName TEXT NOT NULL,          -- 显示名（学生姓名）
  passwordHash TEXT NOT NULL,         -- scrypt: N=16384,r=8,p=1，格式 scrypt$N$salt$hash
  role TEXT NOT NULL DEFAULT 'student', -- admin / teacher / student
  status TEXT NOT NULL DEFAULT 'active',-- active / disabled（禁用即会话失效）
  failedLogins INTEGER DEFAULT 0,     -- 连续失败计数（锁定用）
  lockedUntil INTEGER,                -- 锁定期止时间戳
  createdAt INTEGER,
  updated_at INTEGER
);

-- 会话表（不透明令牌，可吊销）
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,             -- crypto.randomBytes(32) hex
  userId TEXT NOT NULL,
  createdAt INTEGER,
  expiresAt INTEGER,                  -- 7 天滑动过期（每次请求顺延）
  ip TEXT, userAgent TEXT             -- 审计辅助
);
CREATE INDEX idx_sessions_userId ON sessions(userId);
CREATE INDEX idx_sessions_expiresAt ON sessions(expiresAt); -- 定期清理过期会话

-- 私有阅读状态（从 articles 剥离）
CREATE TABLE user_article_states (
  userId TEXT NOT NULL,
  articleId TEXT NOT NULL,
  startedAt INTEGER,
  readAt INTEGER,
  updated_at INTEGER,
  PRIMARY KEY (userId, articleId)     -- 复合主键，天然防重复
);
CREATE INDEX idx_uas_user_readAt ON user_article_states(userId, readAt); -- 我的已读历史

-- 操作审计日志（只追加）
CREATE TABLE operation_logs (
  id TEXT PRIMARY KEY,                -- UUID
  userId TEXT,                        -- 操作者（匿名操作如登录失败可为 NULL）
  username TEXT,                      -- 冗余存储，用户删除后日志仍可追溯
  action TEXT NOT NULL,               -- 见 4.2 动作字典
  resource TEXT,                      -- 资源类型：users / words / articles ...
  resourceId TEXT,                    -- 资源标识（剥离前缀后的业务 id）
  result TEXT NOT NULL,               -- success / denied / failed
  detail TEXT,                        -- JSON，脱敏后的上下文（绝不含密码/token/笔记内容）
  ip TEXT,
  createdAt INTEGER
);
CREATE INDEX idx_logs_user_time ON operation_logs(userId, createdAt);
CREATE INDEX idx_logs_action_time ON operation_logs(action, createdAt);
CREATE INDEX idx_logs_createdAt ON operation_logs(createdAt);  -- 保留期清理
```

### 2.2 私有表 ALTER（5 张）

```sql
ALTER TABLE words            ADD COLUMN userId TEXT;
ALTER TABLE reviews          ADD COLUMN userId TEXT;
ALTER TABLE stats            ADD COLUMN userId TEXT;
ALTER TABLE readingSessions  ADD COLUMN userId TEXT;
ALTER TABLE achievements     ADD COLUMN userId TEXT;
-- 配合前缀映射后的 id 仍为主键；userId 仅用于查询过滤与审计：
CREATE INDEX idx_words_userId    ON words(userId);
CREATE INDEX idx_reviews_userId  ON reviews(userId);
-- stats/readingSessions/achievements 同理
```

### 2.3 关联关系

```
users 1───* sessions          （userId）
users 1───* words/reviews/stats/readingSessions/achievements （userId）
users 1───* user_article_states *───1 articles （复合主键关联共享文章）
users 1───* operation_logs    （userId，逻辑关联，不建外键——日志不因用户删除而丢失）
articles/questions            （无用户维度，全站共享，保持现状）
```

**取舍：全部不使用数据库级外键约束**，与现有「应用层维护关联」的约定一致（避免删除用户时级联删学习数据的误操作风险；删除用户采用「禁用」软删除，见 3.3）。

### 2.4 前端 Dexie 的配套策略

- Dexie schema 版本升至 v8，私有表补 `userId` 索引（仅索引变更，无数据迁移）。
- **切换账号 / 登出时**：清空当前 Dexie 全部业务表 + localStorage 中用户相关键，再跳转登录页。取舍：不做「按用户分库」（`ydxl-db-<userId>`），因为同设备多账号是低频场景，分库会让缓存复用逻辑复杂化；清库后首屏从服务器重新拉取，代价可接受（局域网毫秒级）。
- 前端实体类型不变（服务端已剥离 userId/前缀）。

## 3. 权限模型（RBAC）

### 3.1 角色与权限矩阵

角色存于 `users.role` 列（不建独立 roles/permissions 表——3 种角色、权限稳定，硬编码权限表换来零维护成本，见 8.取舍表）。权限点定义在 `server/src/permissions.ts`（新文件）：

| 权限点 | student | teacher | admin |
| --- | :-: | :-: | :-: |
| `reading:use`（阅读/练习/打印/朗读） | ✅ | ✅ | ✅ |
| `wordbook:own`（自己的生词本/复习/掌握） | ✅ | ✅ | ✅ |
| `stats:own`（自己的统计/成就） | ✅ | ✅ | ✅ |
| `profile:own`（自己的 AI 设置/偏好） | ✅ | ✅ | ✅ |
| `ai:invoke`（AI 生成/代理调用） | ✅ | ✅ | ✅ |
| `content:manage`（编辑/删除共享文章与题目） | ❌ | ✅ | ✅ |
| `stats:class`（查看全班学生统计汇总） | ❌ | ✅ | ✅ |
| `users:manage`（创建/禁用/重置密码/改角色） | ❌ | ❌ | ✅ |
| `logs:view`（查询审计日志） | ❌ | ✅（仅读） | ✅ |
| `system:config`（全局配置） | ❌ | ❌ | ✅ |

**取舍：teacher 与 admin 分离。** teacher 面向教学场景（看班级学情、查日志追溯）但不能管用户——防止误删账号；admin 仅 1-2 人（部署者/教师本人兼任）。`stats:class` 通过新增只读聚合端点 `GET /api/admin/class-stats` 实现，不复用通用表路由（通用路由始终只返回 `req.user` 自己的数据）。

### 3.2 服务端强制（唯一权威）

```
requireAuth        → 无有效会话 401 { code: 'UNAUTHORIZED' }
requirePermission('users:manage') → 角色不含该权限 403 { code: 'FORBIDDEN' }
```

- 7 张现有表路由：私有表在 SQL 层强制 `WHERE userId = req.user.id`；共享表（articles/questions）所有登录用户可读。文章 POST（AI 生成回写）对所有登录用户开放，文章的编辑/删除与题目的编辑/删除要求 `content:manage`（teacher/admin）；学生仅可更新文章的 `vocabulary` / `phrases`（词汇增强回写）。
- **任何跨用户访问在 SQL 层即不可能**（不是「查了再过滤」），这是「严格数据隔离」的技术保证。

### 3.3 前端配合（体验层，不作安全依据）

- 登录页 + 路由守卫：无 token 跳转 `/login`；按角色隐藏「用户管理」「日志」入口。
- API 401 时自动清会话跳登录；403 时 toast 提示「无权限」。
- 用户管理页（admin）：创建账号、禁用/启用、重置密码、分配角色。**只提供「禁用」不提供「删除」**——保留学习数据与日志可追溯性。

## 4. 审计日志规范

### 4.1 记录原则

- **谁、何时、做了什么、对什么、结果如何**五要素齐全；`detail` 一律脱敏（不记密码、token、`words.note` 明文、AI 密钥）。
- 服务端中间件统一记录，业务代码不感知；写日志失败仅 `console.error`，**绝不阻塞主流程**。
- 只追加（append-only）：不提供更新/删除接口；保留 180 天，到期按 `createdAt` 清理，清理前先导出 CSV 归档到 `server/data/log-archive/`。

### 4.2 动作字典（action 枚举）

| 类别 | action | 必记 |
| --- | --- | :-: |
| 认证 | `auth.login.success` / `auth.login.failed` / `auth.logout` / `auth.locked` | ✅ |
| 用户管理 | `user.create` / `user.disable` / `user.enable` / `user.reset_password` / `user.change_role` | ✅ |
| 数据写操作 | `words.create` / `words.bulk_import` / `words.delete` / `articles.mark_read` | ✅ |
| 数据读操作 | 普通 GET | ❌（量太大，价值低） |
| 敏感读 | `logs.query` / `class_stats.view` | ✅（谁在查别人数据必须留痕） |
| AI 调用 | `ai.proxy.invoke`（detail 记 provider/model，不记 prompt 内容） | ✅ |
| 权限拒绝 | 任何 403 | ✅（`result=denied`，入侵探测信号） |

### 4.3 防篡改取舍

不引入 hash 链/Merkle 树（数十人局域网场景属过度设计）。保证手段：① 日志无更新/删除 API；② SQLite 文件层备份（现有运维流程）；③ 定期 CSV 导出归档。若未来有合规要求，可在导出 CSV 时附带整批 SHA-256 摘要，属增量增强。

## 5. 并发控制、事务与安全防护

### 5.1 并发控制

| 场景 | 机制 | 说明 |
| --- | --- | --- |
| 写-写竞争 | better-sqlite3 同步执行 | 单进程内写天然串行，无需锁；WAL 保证读写不互斥 |
| 并发注册同用户名 | `users.username UNIQUE` | 第二个请求约束冲突 → 409 `USERNAME_TAKEN`，数据库兜底竞态 |
| 并发登录同账号 | 每次登录新建独立 session | 多端同时在线（需求 1），互不影响；改密码时 `DELETE FROM sessions WHERE userId=?` 全端下线 |
| 多步写入一致性 | 显式事务（`db.transaction`） | 如「创建用户 + 写审计日志」「批量加词 + 更新统计」要么全成要么全败，沿用现有 words/bulk 事务模式 |
| 重复提交 | POST 幂等（现有 `INSERT OR REPLACE`） | 网络重试不产生重复记录，多用户下语义不变 |
| 滑动过期并发顺延 | `UPDATE sessions SET expiresAt=? WHERE token=?` | 单字段更新，原子 |
| 恶意并发刷接口 | 现有 60/min/IP 全局限流 + AI 20/min | 叠加登录端点专用限流 5/min/IP；按 userId 维度的配额属 P3 增强 |

### 5.2 事务一致性规则（新增代码必须遵守）

1. 跨表写入必须包 `db.transaction`（better-sqlite3 同步事务，嵌套安全）。
2. 审计日志与业务写**同事务**（防「事做了没留痕」）；但日志写失败不回滚业务——日志表插入被设计为不会失败（无外部依赖）。
3. 会话顺延、统计更新等附属写放入业务事务尾部，避免半提交状态。

### 5.3 安全防护清单

| 威胁 | 措施 | 备注 |
| --- | --- | --- |
| 口令爆破 | scrypt 慢哈希（N=16384）+ 连续失败 5 次锁 15 分钟（`failedLogins/lockedUntil`）+ 登录端点 5/min/IP 限流 | Node 内置 `crypto.scrypt`，零依赖；不引 bcrypt/argon2（省原生编译，符合低成本） |
| 会话劫持 | 令牌 256 位随机、httpOnly 不可行（SPA header 模式）故前端存 `sessionStorage`（关标签即失效，比 localStorage 抗 XSS 持久化窃取）；服务端可吊销 | 取舍：sessionStorage 换来安全性，牺牲「记住登录」；教师机公用场景这是优点 |
| CSRF | 自定义头 `x-user-token` 天然免疫（非 Cookie 凭证） | 无需 CSRF token |
| XSS | 沿用 React 转义默认 + 日志 detail 脱敏 | 不引入 v-html 类用法 |
| SQL 注入 | 沿用表名/列名白名单 + 参数化查询；新增表同样走白名单工厂 | 现状机制直接覆盖 |
| 越权（IDOR） | SQL 层强制 `userId = req.user.id`，id 参数先补前缀再查 | **不依赖前端传 userId**，前端传了也被覆盖 |
| SSRF / 密钥泄露 | 沿用现有 AI 代理密钥隔离与 `CUSTOM_API_ENDPOINT` 服务端固定策略 | 现状机制不变 |
| 敏感数据 | `words.note` 加密延续；`users.passwordHash` 永不进 API 响应（`sanitizeBody` 反向过滤） | 新增「响应字段黑名单」 |
| 日志泄露 | `logs:view` 权限点控制；日志不含密钥/密码/笔记 | 见 4.1 |

## 6. 历史数据迁移（平滑过渡）

迁移脚本 `server/src/migrations/001_multi_user.ts`，启动时幂等执行（沿用 PRAGMA 检查风格）：

```
1. 检测 users 表是否存在 → 不存在则进入迁移
2. 创建 4 张新表 + 索引
3. 创建首个管理员账号（用户名/初始密码从环境变量 ADMIN_USERNAME/ADMIN_INITIAL_PASSWORD 读取，
   未配置则生成随机密码打印到控制台一次，强制首次登录改密）
4. 5 张私有表 ALTER ADD userId，并回填默认管理员 id：
   UPDATE words SET userId='<adminId>' WHERE userId IS NULL; -- 其余 4 张同理
5. 存量 id 加前缀：UPDATE words SET id='<adminId>:'||id WHERE id NOT LIKE '%:%'; -- 同理处理
   reviews.wordId、readingSessions/articleId 引用同步加前缀（同事务）
6. articles.readAt/startedAt 非空的行 → 写入 user_article_states(adminId, articleId)，
   然后保留 articles 原列但停止读写（列保留一个版本用于回滚，下版本 DROP）
7. 全部步骤包在一个事务中；失败整体回滚，下次启动重试
8. 迁移完成写 schema_meta(key='multi_user_migrated', value='1') 防重
```

**回滚策略**：迁移前自动备份 `ydxl.db` 到 `server/data/backups/ydxl-pre-multiuser-<ts>.db`（复制文件，WAL 下先 `PRAGMA wal_checkpoint(TRUNCATE)`）。回滚 = 停服 + 还原文件。

**验证清单**：迁移后行数比对（各私有表迁移前后 COUNT 一致）；抽样验证 id 前缀与 userId 一致；旧数据经新 API 可读可写；`npm --prefix server test` 全绿 + 新增迁移测试（内存库构造 v1 数据→跑迁移→断言）。

## 7. 分阶段实施计划

每阶段独立可交付、可回滚；**每阶段验收底线：前后端既有测试全量通过**，即「零破坏」的客观判据（P0 通过时基线为 710 前端用例 + 12 后端测试文件；当前基线为前端 119 文件 / 964 用例 + 后端 22 文件 / 216 用例，后续阶段以增长后的基线为准）。

| 阶段 | 范围 | 关键产出 | 验收 |
| --- | --- | --- | --- |
| **P0 认证与隔离（核心）** ✅ 已实施（见 7.1） | users/sessions 表、迁移脚本、authMiddleware、私有表 userId + 前缀映射、登录页、localApi 注入 token、登出清 Dexie | 多用户可用、数据严格隔离 | 双账号平行操作互不可见；迁移后旧数据完整；401/403 语义正确；新增后端测试（auth/隔离/迁移）——已全部通过 |
| **P1 RBAC 与管理** ✅ 已实施（见 7.2） | permissions.ts、requirePermission、用户管理 API + admin 页面、角色路由守卫、禁用/重置密码 | 三角色体系落地 | 权限矩阵逐点测试；student 访问 admin 端点 403 |
| **P2 审计日志** ✅ 已实施（见 7.3） | operation_logs、审计中间件、日志查询 API（分页/按用户/动作/时间过滤）、日志查看页（teacher/admin）、CSV 导出与 180 天清理 | 审计追溯能力 | 动作字典全覆盖抽查；脱敏检查（日志中 grep 不到密码/token）；`logs.query` 本身留痕 |
| **P3 加固与运营** ✅ 已实施（见 7.4 / 7.5） | 登录限流/锁定 ✅（P0 已落地）、按 userId 的 AI 配额 ✅（见 7.5）、会话管理页（我的设备/全端下线）✅（见 7.5）、`stats:class` 班级学情聚合 ✅（见 7.4）、性能压测（30 并发）✅（见 7.5） | 生产就绪 | 锁定/限流触发正确；30 并发压测脚本可复跑；AI 配额按用户隔离；设备管理可用 |

**建议顺序不可调换**：P0 是其余一切的前提；P2 依赖 P1 的角色体系决定谁能看日志；P3 是增强，可延后。P0+ P1 即可满足需求 1/2，P2 满足需求 3，P3 满足需求 5 的运营化部分。

### 7.1 P0 落地摘要（已实施）

**状态：✅ 已实施。验证结果：后端 11 文件 / 135 用例、前端 57 文件 / 686 用例全绿；双端生产构建通过；真实服务器冒烟通过。**

关键交付与设计落点：

- **认证与会话**：`server/src/auth.ts`（scrypt N=16384；会话 7 天滑动续期；authMiddleware 统一 401）、`server/src/authRoutes.ts`（`/api/auth/login|logout|me|change-password` 四端点）。登录安全按第 5.3 节落地，且登录端点独立限流 5 次/60s/IP、连续失败 5 次锁定 15 分钟（403 ACCOUNT_LOCKED）。
- **数据隔离**：`server/src/routes.ts`（requireUser fail-closed 401；私有表写入时 id 置为 `${userId}:${原id}` 并注入 userId、响应前统一剥离；reviews.wordId 引用同映射；articles 的 readAt/startedAt 在 user_article_states 按当前用户合并读写，DELETE 文章级联清理全站状态行）。
- **迁移与 schema**：`server/src/migrateMultiUser.ts` + `server/src/db.ts`。与第 6 节一致：首管理员（ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD，未配置则随机生成、仅打印一次）、私有表回填 userId 与 id 前缀、readAt/startedAt 剥离、schema_meta 幂等标记、单事务、WAL checkpoint 后文件备份。
- **前端**：`authService`（令牌存 sessionStorage，与第 8 节取舍一致）、localApi 自动注入 `x-user-token`、401 广播（`ydxl:unauthorized`）、AI 代理调用（baseProvider）集中注入身份头、登录页 + 路由守卫；换账号经 localStorage `ydxl-cache-owner` 归属检测，清空 Dexie 7 张业务表（保留 aiCache），符合 2.4 节策略。

与原设计的差异：

1. 登录限流与账号锁定原列于 P3「加固」，实际随认证层在 P0 提前落地。
2. 第 6 节步骤 3 的「强制首次登录改密」未实现：随机初始密码仅打印到服务端控制台并提示尽快修改，暂无服务端强制机制。
3. 第 6 节步骤 5 中「readingSessions.articleId 引用同步加前缀」未实施：articles 属共享表，其 id 不加前缀，该引用无需映射（原句按最终共享/私有模型修正）；存量引用列仅改造 reviews.wordId。
4. RBAC 与审计日志保持待实施（P1：requirePermission / 403 FORBIDDEN / users:manage；P2：operation_logs 建表）——`users.role` 字段已随表落库，但授权分层尚不存在。（更新：RBAC 已于 P1 实施，见 7.2；审计日志仍待 P2。）

冒烟验证项：/api/health 200（免认证）；无令牌访问业务端点 401；登录返回 64 位 hex 令牌；登录后写 words 的响应 id 无前缀且 userId 剥离；登出后原令牌即失效（401）。相关契约与结构已同步至 [API_REFERENCE](./API_REFERENCE.md)（1.11 / 1.12 节）、[DATABASE](./DATABASE.md)、[ER_DIAGRAM](./ER_DIAGRAM.md)、[TESTING](./TESTING.md)。

### 7.2 P1 落地摘要（已实施）

**状态：✅ 已实施。验证结果：后端 12 文件 / 159 用例、前端 59 文件 / 697 用例全绿；双端构建（tsc / vite）与 lint 通过。**

关键交付与设计落点（对照第 3 节权限模型）：

- **权限体系**：`server/src/permissions.ts`（新文件）——10 个权限点 × 3 角色的硬编码矩阵（`ROLE_PERMISSIONS`，与 3.1 表一致）；`hasPermission()` 对未知角色 fail-closed（一律无权限）；`requirePermission(perm)` 中间件统一产生 403 `FORBIDDEN`（`缺少权限：users:manage`）。共享内容写权限 `content:manage` 由 `routes.ts` 的 `requireContentManager()` 在通用表路由内前置校验并写审计。
- **用户管理 API**：`server/src/adminRoutes.ts`（新文件），挂载于 `server/src/index.ts` 的 `/api/admin` 前缀（整组 `users:manage` 授权 + 认证门）。5 个端点：列表 / 创建（409 `USERNAME_TAKEN` 兜底并发竞态，对应 5.1 节）/ 禁用启用 / 重置密码 / 改角色。与 3.3 节一致：**只禁用不删除**；禁用、重置密码、改角色均吊销目标用户全部会话（即时生效）；**禁止对自己禁用或改角色**（防误锁死最后的管理员）；启用同时清除失败计数与锁定期；响应经 `toPublicUser` 白名单过滤，**绝不含 passwordHash**（对应 5.3 节响应字段黑名单）。
- **前端**：`src/features/admin/pages/AdminUsersPage.tsx`（列表 + 创建表单 + 行内角色下拉 / 禁用启用 / 行内重置密码）；`src/shared/services/adminService.ts`（401 清会话广播 `ydxl:unauthorized`，与 localApi 行为一致）；`src/features/auth/components/RequireAdmin.tsx`（非 admin 重定向首页，体验层隐藏）；`Layout.tsx` 桌面导航仅对 admin 追加「管理」入口。
- **测试**：`server/src/__tests__/rbac.test.ts`（24 用例：矩阵逐点 + 中间件语义 + 管理 API 全流程）、`src/shared/services/__tests__/adminService.test.ts`、`src/features/auth/components/__tests__/RequireAdmin.test.tsx`。详见 [TESTING](./TESTING.md) 7.2 节。

与原设计的差异：

1. `stats:class` / `logs:view` / `system:config` 权限点已在矩阵中定义，但对应端点与页面按阶段实施（班级学情聚合属 P3、日志查询属 P2）——权限矩阵先行落地，端点随阶段补齐。（更新：日志查询已于 P2 落地，见 7.3；班级学情聚合已于 P3 落地，见 7.4。）
2. `hasPermission()` 返回类型为布尔而非抛错；未登录访问 `requirePermission` 保护的路由返回 401（而非 403），与「先认证后授权」语义一致（见 1.13 请求管道）。

### 7.3 P2 落地摘要（已实施）

**状态：✅ 已实施。验证结果：后端 13 文件 / 179 用例、前端 59 文件 / 700 用例全绿；双端构建（tsc / vite）与 lint 通过。**

关键交付与设计落点（对照第 4 节审计日志规范）：

- **存储层**：`server/src/db.ts` 新增第 12 张表 `operation_logs`（字段与 2.1 节一致）+ 3 个索引（user_time / action_time / createdAt），`CREATE TABLE IF NOT EXISTS` 幂等，存量库启动时自动建表，无需迁移脚本。
- **审计模块**：`server/src/audit.ts`（新文件）——`logOperation()` 只追加写入（内部吞异常，仅 console.error，绝不阻塞业务）；`sanitizeDetail()` 防御性脱敏（键名匹配 password/token/secret/apiKey/note/hash 的键整键剔除，字符串截断，序列化超限降级）；`queryAuditLogs()` 过滤查询（userId/action 精确匹配 + from/to 时间窗 + 分页）；`renderLogsCsv()` CSV 渲染（含转义）；`runAuditRetention()` 180 天保留策略（先归档 CSV 到 `server/data/log-archive/` 再删除，幂等，启动时执行）。
- **动作字典**：设计 4.2 全覆盖 + 3 项扩充——认证四事件（login.success/failed/locked/logout）+ 自助改密（`auth.change_password`，扩充）、用户管理五事件（create/disable/enable/reset_password/change_role）、数据写操作（泛化 `${table}.create/update/delete` + `words.bulk_import` + `articles.mark_read`）、敏感读（`logs.query` / `logs.export`，扩充导出动作）、AI 调用（`ai.proxy.invoke`，detail 仅记 provider/model/stream）、权限拒绝（`permission.denied`，任何 403）。
- **接入点**：`authRoutes.ts`（认证事件）、`adminRoutes.ts`（管理操作）、`permissions.ts`（403 denied，入侵探测信号）、`routes.ts`（表写操作与 bulk，`auditWrite` 辅助）、`ai-proxy.ts`（AI 调用，流式/非流式）、`adminRoutes.ts` 日志查询/导出自身留痕。
- **查询端点**（`adminRoutes.ts`，见 API_REFERENCE 1.14）：`GET /api/admin/logs`（logs:view 权限：admin + teacher，分页 + 过滤）与 `GET /api/admin/logs/export`（CSV 导出，UTF-8 BOM 便于 Excel）。权限挂载由整组 `users:manage` 重构为分组：`/users` → `users:manage`，`/logs` → `logs:view`。
- **前端**：`src/features/admin/pages/AuditLogsPage.tsx`（过滤表单 + 分页表格 + CSV 导出下载）；`RequireAdmin` 泛化出 `roles` prop（日志页 `[admin, teacher]`）；Layout 顶栏 teacher 显示「日志」入口、admin 显示「管理」入口；用户管理页与日志页互链。
- **测试**：`server/src/__tests__/audit.test.ts`（20 用例：写入五要素、脱敏、认证/管理/403/表写/AI 各接入点留痕、查询过滤分页、CSV 导出与转义、保留策略归档+清理+幂等）。验收项对照：动作字典全覆盖 ✅、脱敏检查（日志 grep 不到密码/token/笔记）✅、`logs.query` 本身留痕 ✅。

与原设计的差异：

1. 「审计日志与业务写同事务」（5.2 节规则 2）调整为**业务成功后追加**：logOperation 内部吞异常，INSERT 无外部依赖不会失败，换取业务代码零感知；与 4.1「写日志失败仅 console.error 不阻塞主流程」一致。
2. 动作字典扩充 3 项：`auth.change_password`（自助改密）、`logs.export`（CSV 导出）、`permission.denied`（替代设计中未命名的「任何 403」动作名）。
3. 普通读操作（GET 列表/详情）不记录，与 4.2 一致；私有表 `PUT` 在字典基础上补充 `${table}.update` 动作（字典仅列 words.create/delete 为代表）。

### 7.4 P3 落地摘要（班级学情聚合，已实施）

**状态：✅ 班级学情聚合子项已实施。验证结果：后端 14 文件 / 188 用例、前端 59 文件 / 702 用例全绿；双端构建（tsc / vite）与 lint 通过。**

对应 3.1 节 `stats:class` 权限点（teacher ✅ / admin ✅ / student ❌），兑现 3.2 节「teacher 看班级学情」的教学场景：

- **聚合模块**：`server/src/classStats.ts`（新文件）——`getClassStats({ days })` 以 SQL 聚合而非逐用户循环：`stats` 按 `substr(id, LENGTH(userId) + 2)` 取业务日期做窗口过滤后 `GROUP BY userId`（走 idx_stats_user 前缀），`readingSessions` 按 `reviewedAt` 时间窗聚合；连续打卡 `streak` 取窗口内最新一天的值（`MAX(id)` 回查）。
- **统计口径**：学员范围 = `role = 'student' AND status = 'active'`（禁用账号及其历史数据不计入）；窗口默认 30 天、可选 7/30/90，服务端上限 180 天、非法值回退默认；汇总含学员数、活跃学员数、阅读/生词总量、人均阅读、平均正确率（按阅读会话均值，保留两位小数）、累计阅读时长、会话次数。
- **端点**：`GET /api/admin/class-stats?days=N`（见 API_REFERENCE 1.15）。`adminRoutes.ts` 权限分组新增 `/class-stats` → `stats:class`，`permissions.ts` 的 `requirePermission` 统一守门（student 403 `FORBIDDEN`，未认证 401）。
- **审计**：动作字典新增 `class_stats.view`——**这是敏感读**（教师查看他人学习数据），按 4.2 留痕，detail 记录 days / from / to / studentCount（不含任何学员明细）。
- **前端**：`src/features/admin/pages/ClassStatsPage.tsx`（窗口切换 + 6 张汇总卡片 + 学员明细表，仅显示显示名与统计数值，不含学习内容）；路由 `admin/class-stats` 挂 `<RequireAdmin roles={['admin','teacher']} />`；Layout 中 teacher 与 admin 均显示「学情」「日志」入口。
- **测试**：`server/src/__tests__/classStats.test.ts`（9 用例：四角色权限、窗口过滤与禁用排除、streak/lastActiveDate 取最新、人均与正确率、无学员零值、days 参数边界、查询留痕）、`adminService.test.ts` 补 2 用例（请求构造 + 403 文案）。

与原设计的差异：

1. 设计未细化聚合字段，实际返回「汇总 + 学员明细」两层结构（明细用于教师定位需关注的学生），不返回任何学习内容文本。
2. 正确率以**阅读会话**为分母（会话数加权），而非按学员等权平均；无会话的学员正确率记 0（与「无数据」同义）。
3. 班级维度以「全部在用学员」近似（当前尚无班级/分组表），等价于单班部署；未来引入班级表时只需在学员范围 SQL 上加过滤。
4. P3 其余子项（按 userId 的 AI 配额、会话管理页、30 并发压测）已实施，见 7.5。

### 7.5 P3 落地摘要（AI 配额 + 会话管理 + 压测，已实施）

**状态：✅ P3 全部子项已实施。验证结果：后端 16 文件 / 200 用例、前端 59 文件 / 707 用例全绿；双端构建（tsc / vite）与 lint 通过。**

承接 7.4 的班级学情聚合，补齐 P3 剩余三项：

- **按 userId 的 AI 配额**：`server/src/ai-proxy.ts` 导出 `createAiProxyLimiter()` 工厂 + 默认实例 `aiProxyLimiter`，`keyGenerator` 从 `req.user.id` 取键（认证门之后必存在，缺失时兜底回退 IP），配额 20 次/分钟/用户。`index.ts` 挂载 `/api/v1/ai-proxy`。动机：共享出口（机房/NAT）下按 IP 会让一个用户刷满耗尽整段出口额度、误伤同网段学员，按用户计量后配额互相隔离。测试环境默认跳过（`NODE_ENV=test`）避免有状态桶跨用例累积污染契约测试。
- **会话管理页（我的设备 / 全端下线）**：`server/src/auth.ts` 新增 `listUserSessions()`（按 userId 限定、惰性清理过期会话、仅返回脱敏指纹前 8 + 尾 4，绝不返回完整令牌）与 `deleteSessionById()`（rowid + userId 联合限定防越权）；`authRoutes.ts` 新增 `GET /api/auth/sessions`、`DELETE /api/auth/sessions/:id`、`DELETE /api/auth/sessions`（全端下线，含当前设备）三端点。前端 `src/features/profile/components/SessionSection.tsx`（设备列表 + 当前设备标记 + 移除 + 全端下线确认后跳登录），挂入 ProfilePage。审计：动作字典新增 `auth.revoke_session` / `auth.logout_all`。
- **性能压测（30 并发）**：`server/src/loadtest.ts`（纯 Node fetch 零依赖），固定并发 worker 池压测只读 GET，输出 RPS、延迟分位（p50/p90/p99/min/max/avg）、状态码分布；`npm run loadtest` 启动，支持 `--concurrency/--total/--path/--token/--username/--password`。注意：全局限流 60/min/IP（见 index.ts）下单进程高压会触发 429，属限流保护生效的预期表现，脚本如实统计 2xx 与 429。

与原设计的差异：

1. AI 配额主维度由「IP」改为「userId」（设计 5.1 原写「按 userId 维度的配额属 P3 增强」，未指定主维度；本实现明确以 userId 为主、IP 兜底）。
2. 会话管理以「我的设备」自助管理落地（用户仅能操作本人会话），与 P1 管理员「全端下线」（`deleteUserSessions`）区分；未提供管理员强制下线他人在用设备之外的额外端点（已有禁用账号触发全端下线，见 7.2）。
3. 压测为**脚本工具**而非 CI 门禁：30 并发读写「无错无串数据」由单元/集成测试的数据隔离用例保障（见 7.1），压测脚本面向性能观测与回归对比，未接入 CI。

## 8. 关键设计取舍汇总

| 决策点 | 选择 | 放弃的方案 | 理由 |
| --- | --- | --- | --- |
| 认证机制 | 不透明会话令牌 + DB 会话表 | JWT | 可即时吊销、零依赖、规模用不上 JWT 优势 |
| 密码哈希 | Node 内置 scrypt | bcrypt / argon2 | 零原生编译依赖，低成本；scrypt 参数 N=16384 在登录 QPS≈0 的局域网足够 |
| 文章数据 | 全站共享（articles/questions 无用户维度） | 每用户一份 | 省 N 倍 AI token；同班同进度无需个性化；保留 `ownerId` 扩展口 |
| 阅读状态 | 剥离到 `user_article_states` | 留在 articles 行上加用户列数组 | JSON 数组无法索引、并发覆盖；独立表复合主键干净 |
| 主键碰撞 | 服务端透明 id 前缀映射 | 前端实体加 userId 字段 | 爆炸半径收敛到服务端路由层，前端类型/组件/Dexie 实体零改动 |
| 角色存储 | `users.role` 列 + 代码内权限表 | roles/permissions 独立表 | 3 角色稳定，独立表带来无谓的 join 与管理界面成本 |
| 删除用户 | 软删除（disabled） | 物理删除 | 保留学习数据与审计可追溯；误操作可恢复 |
| 前端令牌存储 | sessionStorage | localStorage / Cookie | 抗持久化窃取；公用电脑场景关标签即登出是特性；header 模式天然免 CSRF |
| 日志防篡改 | 只追加 + 定期导出 | hash 链 | 规模与合规要求不足以支撑复杂度 |
| 本地缓存 | 切账号清 Dexie 重建 | 按用户分 IndexedDB 库 | 多账号同设备低频，分库复杂度不值 |
| 新增依赖 | 0 个 npm 包 | passport / jsonwebtoken 等 | 全部用 Node 内置 crypto + 现有 express 生态，符合低成本与供应链安全原则 |

## 相关文档

- [ARCHITECTURE](./ARCHITECTURE.md)：现有分层架构（本方案在其上叠加认证/授权/审计层）
- [DATABASE](./DATABASE.md)：现有表结构基线（迁移的「迁移前」状态）
- [API_REFERENCE](./API_REFERENCE.md)：REST 契约（P0 后响应实体不变；/api/auth/* 认证端点见其 1.11 节，多用户隔离行为见 1.12 节，/api/admin/* 用户管理端点见 1.13 节）
- [OPERATIONS](./OPERATIONS.md)：备份/监控流程（日志归档与迁移备份复用）
- [CODING_STANDARDS](./CODING_STANDARDS.md)：实施时须遵守的规范（事务、错误处理、索引先行）
