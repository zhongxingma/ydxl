# 安全政策

本文档是 `ydxl` 英语学习 PWA 的安全入口：描述当前实际生效的安全机制、明确的安全边界与取舍、以及漏洞报告渠道。运维层面的例行核查清单见 [docs/OPERATIONS.md 第 7 节](./docs/OPERATIONS.md#7-安全审计清单)，本文与它互补、不重复展开操作步骤。

> 本文所有机制均基于当前代码实现描述；尚未落地的项（如 `AI_PROXY_TOKEN` 代理鉴权）在第 3 节「已知边界与取舍」中如实说明。

---

## 1. 支持范围

- 受支持的运行环境：**最新 2 个大版本**的 Ubuntu LTS / Debian（当前 22.04 / 12），Node.js ≥ 18
- 服务端运行形态：Linux 服务器本地部署（PM2 / systemd + Nginx 反代），见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- 浏览器：支持 Service Worker 的现代浏览器（PWA 功能依赖）
- **安全修复只承诺合入当前 main 分支**；历史版本不单独维护

## 2. 当前生效的安全机制

### 2.1 认证与会话（多用户 P0）

| 机制 | 实现 | 位置 |
| --- | --- | --- |
| 密码哈希 | Node 内置 `crypto.scrypt`（N=16384, r=8, p=1），格式 `scrypt$N$saltHex$hashHex`；零外部依赖 | `server/src/auth.ts` |
| 暴力破解防护 | 连续失败 5 次锁定 15 分钟；登录端点独立限流 5 次/分钟/IP | `server/src/auth.ts` / `authRoutes.ts` |
| 会话令牌 | `crypto.randomBytes(32)` 不透明令牌，存 `sessions` 表，7 天滑动过期、可吊销 | `server/src/auth.ts` |
| 前端令牌存储 | `sessionStorage`（关标签即失效）；换账号登录时清空上一账号的本地缓存 | `src/shared/services/authService.ts` |
| CSRF | 凭证走自定义头 `x-user-token`（非 Cookie），天然免疫 CSRF | — |

### 2.2 数据隔离与存储

| 机制 | 实现 | 位置 |
| --- | --- | --- |
| 越权（IDOR）防护 | SQL 层强制 `userId = req.user.id`，私有表 id 按 `userId:` 前缀隔离；不信任前端传入的 userId | `server/src/routes.ts` |
| 字段加密 | 应用层 AES-256-GCM（`enc:v1:<iv>:<authTag>:<ciphertext>`），当前加密字段：`words.note`；**生产环境未配置 `ENCRYPTION_KEY` 时 fail-fast 拒绝启动** | `server/src/encryption.ts` |
| 前端密钥库 | Web Crypto AES-GCM-256，主密钥存 IndexedDB（与 localStorage 物理分离）；用于各 AI 供应商 API Key 的加密存储 | `src/shared/services/secureStorage.ts` |
| 数据库文件 | 服务端 SQLite 权限基线 640/750，不经 Nginx 直接服务 | 见 OPERATIONS.md 7.2 |

### 2.3 请求边界

| 机制 | 实现 |
| --- | --- |
| SQL 注入 | 表名/列名白名单 + better-sqlite3 参数化查询 |
| CORS | 生产环境 `CORS_ORIGIN` 白名单（生产默认仅 localhost，必须显式配置） |
| 限流 | 全局限流 60 次/分钟/IP；AI 代理 20 次/分钟/用户（按 `userId` 计量，NAT 共享出口不误伤同网段）；登录 5 次/分钟/IP |
| 错误泄露 | 生产环境错误响应不返回堆栈；密码哈希等敏感字段经反向过滤永不进 API 响应 |
| SSRF | AI 代理 custom 上游端点只信任服务端 `.env` 配置，不接受客户端任意端点 |
| 密钥隔离 | 生产密钥仅存服务端 `.env`（`.gitignore` 排除）；前端 `VITE_*_API_KEY` 仅开发直连模式使用，生产构建产物中不含真实密钥 |

### 2.4 授权与审计（多用户 P1 / P2）

| 机制 | 实现 | 位置 |
| --- | --- | --- |
| RBAC 授权 | 9 权限点 × admin/teacher/student 硬编码矩阵，`requirePermission` 服务端强制（未知角色 fail-closed）；管理端点整组要求 `users:manage`，日志查询要求 `logs:view` | `server/src/permissions.ts` |
| 审计日志 | `operation_logs` 只追加记录认证 / 用户管理 / 数据写操作 / 敏感读（含日志查询自身）/ AI 调用 / 403 权限拒绝；detail 防御性脱敏（不含密码/token/笔记明文/AI 密钥）；保留 180 天，启动时归档 CSV 至 `server/data/log-archive/` 后清理 | `server/src/audit.ts` / `db.ts` |
| 日志查询授权 | 审计日志仅 `logs:view`（admin / teacher）可查；查询与导出行为自身留痕（谁在查日志可追溯） | `server/src/adminRoutes.ts` |
| 班级学情授权 | 全班统计仅 `stats:class`（admin / teacher）可查；student 访问 403 并留痕 `permission.denied`；返回仅含显示名与统计数值，不含学习内容；查询留痕 `class_stats.view` | `server/src/classStats.ts` / `adminRoutes.ts` |
| 会话管理（我的设备） | 用户自助列出 / 移除 / 全端下线自己的登录设备；列表仅返回脱敏令牌指纹（前 8 + 尾 4），不泄露完整令牌；移除以 `rowid + userId` 联合限定防越权；过期会话惰性清理；操作留痕 `auth.revoke_session` / `auth.logout_all` | `server/src/authRoutes.ts` / `auth.ts` |

## 3. 已知边界与取舍（如实说明）

- **`AI_PROXY_TOKEN` 为预留项，代理端点鉴权尚未实现**：`/api/v1/ai-proxy/*` 目前依赖「服务仅监听本机 + Nginx 反代」的网络边界防护。
- **`sessionStorage` 取舍**：换安全性（抗持久化窃取）牺牲「记住登录」，教师机公用场景下这是优点。
- **前端缓存层非安全边界**：Dexie 离线缓存可被同浏览器本地访问读取，敏感语义请勿依赖其保密性。
- **RBAC 剩余项**：`system:config` 权限点已定义但尚无对应端点；P3 运营功能（按 userId 的 AI 配额、会话管理页、压测脚本）已实施（见 MULTI_USER_DESIGN.md 7.5）。

## 4. 漏洞报告

- **渠道**：请通过项目 issue 以 **draft（草稿）方式**提交，标题前缀 `[SECURITY]`，描述包含：受影响组件、复现步骤（或最小示例）、影响评估。
- **处理承诺**：确认有效后，按严重程度在 **P0（24 小时内）/ P1（72 小时内）/ P2（下一版本）** 的时限内修复，修复版本在 [CHANGELOG](./CHANGELOG.md) 以 `Security` 类型记录。
- **请勿**：在公开 issue / 公开讨论中直接贴出可复现利用的细节或绕过代码；报告修复前请保持私有。
- **不受支持范围**内的版本与配置，不保证提供安全修复。
