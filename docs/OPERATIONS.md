# 运维手册

本文档面向 `ydxl` 英语学习 PWA 应用的运维人员，描述 SQLite 备份策略、Express 服务监控、性能监控、日志查看、日常维护、版本升级、容量规划与安全审计的流程。

> 应用技术栈：前端 React 18 + Vite 6 + Dexie.js（IndexedDB 离线缓存），后端 Express 4 + better-sqlite3（本地 SQLite），AI 集成支持多家供应商（DeepSeek / OpenAI / 通义千问 / 自定义模型，服务端代理按所选供应商转发）。部署方式：Linux 服务器本地部署（PM2 / systemd + Nginx 反代），见 [LINUX_DEPLOY.md](./LINUX_DEPLOY.md)。

> 本文内容均基于项目当前实际实现，未接入的监控能力（如 Sentry、Prometheus）会明确标注。

---

## 1. 性能监控指标

### 1.1 前端指标（Core Web Vitals）

| 指标 | 基线 | 说明 |
| --- | --- | --- |
| LCP（Largest Contentful Paint） | < 2.5s | 首屏最大内容渲染时间 |
| FCP（First Contentful Paint） | < 1.8s | 首次内容渲染时间 |
| TTI（Time to Interactive） | < 3.8s | 可交互时间 |
| TBT（Total Blocking Time） | < 200ms | 主线程阻塞总时间 |
| CLS（Cumulative Layout Shift） | < 0.1 | 累积布局偏移 |

**测量工具**：
- Chrome DevTools → Lighthouse（本地审计）
- PageSpeed Insights（线上测量）
- 浏览器 DevTools → Performance（性能剖析）

### 1.2 Express 服务器指标

| 指标 | 基线 | 说明 |
| --- | --- | --- |
| API 调用延迟 P50 | < 50ms | 本地 SQLite 查询中位延迟（无网络往返） |
| API 调用延迟 P95 | < 200ms | 含复杂查询或 JOIN 场景 |
| AI 代理调用延迟 P50 | 1-3s | 受 DeepSeek 上游响应时间影响 |
| AI 代理调用延迟 P95 | < 150s | 受上游超时限制（见 `server/src/ai-proxy.ts` 中 `UPSTREAM_TIMEOUT_MS = 150_000`，长响应场景如语法填空/文章生成在第三方平台可能需 75-150s） |
| 错误率 | < 1% | 5xx 错误占比 |
| 限流触发率（429） | < 5% | 429 响应占总响应比例；超过 5% 可能存在异常客户端或滥用，需检查 `CORS_ORIGIN` 白名单与前端调用频率 |
| 内存占用 | < 200MB | Express 进程常驻内存 |

**监控位置**：
- PM2 方式：`pm2 logs ydxl-server` / `pm2 monit`
- systemd 方式：`journalctl -u ydxl -f`
- 健康检查端点：`curl http://localhost:3001/api/health`

### 1.3 SQLite 数据库指标

| 指标 | 基线 | 说明 |
| --- | --- | --- |
| 数据库文件大小 | 监控 | 单用户年增量约 6MB（详见第 6 章） |
| 查询延迟 P95 | < 100ms | 7 张表查询（含 ORDER BY updated_at） |
| WAL 文件大小 | < 10MB | WAL 模式下的预写日志文件，checkpoint 后会缩减 |
| 表行数 | 监控 | 各表行数监控，避免单表过大影响查询性能 |

**监控命令**：

```bash
# 查看数据库文件大小
ls -lh /opt/ydxl/server/data/ydxl.db
ls -lh /opt/ydxl/server/data/ydxl.db-wal
ls -lh /opt/ydxl/server/data/ydxl.db-shm

# 查询各表行数
sqlite3 /opt/ydxl/server/data/ydxl.db <<EOF
SELECT 'articles' AS table_name, COUNT(*) FROM articles
UNION ALL SELECT 'questions', COUNT(*) FROM questions
UNION ALL SELECT 'words', COUNT(*) FROM words
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'stats', COUNT(*) FROM stats
UNION ALL SELECT 'readingSessions', COUNT(*) FROM readingSessions
UNION ALL SELECT 'achievements', COUNT(*) FROM achievements;
EOF
```

### 1.4 AI 上游指标

| 指标 | 基线 | 说明 |
| --- | --- | --- |
| 调用延迟 P50 | 1-3s | 取决于所选供应商与模型的响应速度 |
| 调用延迟 P95 | < 150s | 后端上游超时限制（`server/src/ai-proxy.ts` 中 `UPSTREAM_TIMEOUT_MS = 150_000`，长响应场景） |
| Token 消耗 | 监控 | 单次调用 token 数（文章生成 ~2000、题目生成 ~1500、查词 ~500） |
| 单价 | 视供应商套餐 | 见第 6.3 章成本表 |
| 错误率 | < 1% | 4xx / 5xx 占比 |
| 各供应商路由健康 | 监控 | `/api/v1/ai-proxy/<provider>` 按供应商独立监控 503（密钥未配置）/ 502 / 504 占比 |

**监控建议**：在 Express 日志中记录每次 AI 代理调用的耗时与状态码，按月汇总成本。当前 `server/src/ai-proxy.ts` 已记录上游响应状态码，但未显式输出 token 数；如需精确成本核算，可在响应体中解析 `usage` 字段并追加日志。

---

## 2. 日志位置与查看

### 2.1 浏览器端

| 位置 | 用途 |
| --- | --- |
| **DevTools Console** | 前端 `console.warn` / `console.error` 输出，如 `[CachedRemoteRepository]`、`[articleService]`、`[ErrorBoundary]` 前缀日志 |
| **DevTools Network** | 查看 API 请求/响应（URL 形如 `/api/articles`、`/api/v1/ai-proxy/deepseek`） |
| **DevTools Application → IndexedDB** | 查看 `ydxl-db` 数据库 7 张表数据（articles/questions/words/reviews/stats/readingSessions/achievements） |
| **DevTools Application → Service Workers** | 查看 SW 注册状态、更新状态（`registerSW.js` 由 vite-plugin-pwa 生成） |
| **DevTools Application → Local Storage** | 查看 `user-lang`、`theme`、`ydxl-ext-ai-provider` 等 key |

### 2.2 服务端

#### PM2 日志

- 入口：直接命令 `pm2 logs ydxl-server`
- 日志文件位置：`~/.pm2/logs/ydxl-server-out.log` 与 `~/.pm2/logs/ydxl-server-error.log`
- 日志内容：
  - 服务器启动：`[ydxl-server] listening on http://localhost:3001`
  - Express 路由错误（404 / 500）
  - AI 代理调用错误（502 / 504）
  - SQLite 查询异常

#### systemd 日志

- 入口：`journalctl -u ydxl -f`
- 日志位置：`/var/log/journal/`（systemd-journald 管理）
- 常用命令：
  ```bash
  sudo journalctl -u ydxl -f                 # 实时跟踪
  sudo journalctl -u ydxl --since "1 hour ago"
  sudo journalctl -u ydxl -p err --no-pager  # 仅错误日志
  ```

#### Nginx 日志

- 访问日志：`/var/log/nginx/access.log`
- 错误日志：`/var/log/nginx/error.log`
- 常用命令：
  ```bash
  sudo tail -f /var/log/nginx/access.log
  sudo tail -f /var/log/nginx/error.log
  ```

### 2.3 前端 ErrorBoundary

- 实现位置：`src/shared/components/ErrorBoundary.tsx`
- 捕获子组件抛错后，`componentDidCatch` 执行 `console.error('[ErrorBoundary]', error, info)` 并调用可选的 `onError` 回调
- 默认恢复 UI 显示 `error.message` 与可折叠的 `error.stack`，提供「刷新页面」与「返回首页」两个入口
- **当前未接入 Sentry / 外部监控服务**，`onError` 仅在调用方显式传入回调时生效；如需线上错误聚合，需在此处接入上报 SDK

### 2.4 离线提示事件

- 触发位置：`src/shared/services/localApi.ts` 的 `notifyOffline()` 函数
- 触发时机：fetch 调用发生网络错误（服务器不可达）时，`window.dispatchEvent(new CustomEvent('ydxl:offline'))`
- 监听位置：Layout 组件监听 `ydxl:offline` 事件，显示「网络不可用，仅可查看已缓存数据」toast
- 触发后行为：CachedRemoteRepository 自动回退到 Dexie 本地缓存读取

---

## 3. 日常维护流程

### 3.1 每周检查清单

- [ ] 检查 PM2 / systemd 服务状态（`pm2 status` 或 `sudo systemctl status ydxl`）
- [ ] 检查 Express 错误日志异常错误率（目标 < 1%）
- [ ] 检查限流触发率（429 响应占比，目标 < 5%；过高需排查异常客户端或收紧 `CORS_ORIGIN`）
- [ ] 检查 SQLite 数据库文件大小（见第 1.3 章）
- [ ] 检查 contentHash 索引健康（确认 `idx_articles_content_hash` 索引存在且可用）：

  ```bash
  # 确认索引存在
  sqlite3 /opt/ydxl/server/data/ydxl.db "PRAGMA index_info(idx_articles_content_hash);"
  # 查看索引使用统计（EXPLAIN QUERY PLAN 验证去重查询走索引）
  sqlite3 /opt/ydxl/server/data/ydxl.db "EXPLAIN QUERY PLAN SELECT * FROM articles WHERE contentHash = 'test';"
  # 如索引损坏或性能下降，重建索引（在线操作，不阻塞读写）
  sqlite3 /opt/ydxl/server/data/ydxl.db "REINDEX idx_articles_content_hash;"
  ```

- [ ] 检查所用 AI 供应商的上游配额与余额：
  - DeepSeek：https://platform.deepseek.com/usage
  - OpenAI：https://platform.openai.com/usage
  - 通义千问：阿里云百炼控制台费用中心
  - 多供应商同时启用时逐一核查；某供应商欠费会导致该路由持续 502/401
- [ ] 测试 PWA 离线可用性（断网访问应用，确认已加载文章可查看、Service Worker 缓存生效）
- [ ] 检查磁盘剩余空间（SQLite 文件 + WAL 增长）

### 3.2 每月检查清单

- [ ] 运行 `npm audit` 检查依赖漏洞，按严重程度处理
- [ ] 运行 `npm outdated` 检查依赖更新，评估升级风险
- [ ] 备份 SQLite 数据库（手动或 cron，见第 4 章）
- [ ] 检查 SSL 证书状态（Let's Encrypt 自动续期，但需确认未过期）：`sudo certbot certificates`
- [ ] 检查 Nginx 访问日志中的异常请求模式（如频繁 5xx）

### 3.3 每季度检查清单

- [ ] 审查 SQLite 数据库 VACUUM（清理碎片）：`sqlite3 /opt/ydxl/server/data/ydxl.db "VACUUM;"`
- [ ] 审查 Nginx 配置（CORS、缓存策略、安全头）
- [ ] 评估 AI 成本趋势，决定是否调整调用频率
- [ ] 审查测试覆盖率（运行 `npm test` 与 `npm --prefix server test`，确认无 `skip` 的测试）

---

## 4. 备份与恢复

### 4.1 SQLite 备份策略

#### 手动备份（SQL dump）

```bash
# 完整导出为 SQL 脚本
sqlite3 /opt/ydxl/server/data/ydxl.db .dump > /backup/ydxl_$(date +%Y%m%d).sql

# 压缩备份
sqlite3 /opt/ydxl/server/data/ydxl.db .dump | gzip > /backup/ydxl_$(date +%Y%m%d).sql.gz
```

#### 文件级备份（在线备份，推荐使用 .backup 命令）

```bash
# 使用 SQLite 的 .backup 命令（在线热备份，不阻塞写入）
sqlite3 /opt/ydxl/server/data/ydxl.db ".backup '/backup/ydxl_$(date +%Y%m%d).db'"

# 或使用 cp（但需先 checkpoint WAL）
sqlite3 /opt/ydxl/server/data/ydxl.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp /opt/ydxl/server/data/ydxl.db /backup/ydxl_$(date +%Y%m%d).db
```

#### 自动备份（cron 定时任务）

创建 `/etc/cron.daily/ydxl-backup`：

```bash
sudo tee /etc/cron.daily/ydxl-backup > /dev/null <<'EOF'
#!/bin/bash
BACKUP_DIR=/backup/ydxl
mkdir -p $BACKUP_DIR

# 在线热备份
sqlite3 /opt/ydxl/server/data/ydxl.db ".backup '$BACKUP_DIR/ydxl_$(date +%Y%m%d).db'"

# 保留最近 30 天的备份
find $BACKUP_DIR -name "ydxl_*.db" -mtime +30 -delete

echo "[$(date)] backup completed: $BACKUP_DIR/ydxl_$(date +%Y%m%d).db"
EOF

sudo chmod +x /etc/cron.daily/ydxl-backup
```

每日凌晨自动执行（cron.daily 默认在 6:25 执行，可调整）。

#### 备份频率建议

- **个人使用**：每周一次手动备份即可
- **多用户使用**：每日自动备份（cron.daily）+ 每周一次异地备份
- **关键场景**：每日备份 + 实时 WAL 归档（高级方案，不在本指南范围）

### 4.2 恢复步骤

#### 从 SQL dump 恢复

```bash
# 1. 停止服务（避免写入冲突）
pm2 stop ydxl-server
# 或
sudo systemctl stop ydxl

# 2. 备份当前数据库（防止误操作）
mv /opt/ydxl/server/data/ydxl.db /opt/ydxl/server/data/ydxl.db.broken

# 3. 从备份恢复
sqlite3 /opt/ydxl/server/data/ydxl.db < /backup/ydxl_20260711.sql

# 4. 重启服务
pm2 start ydxl-server
# 或
sudo systemctl start ydxl

# 5. 验证
curl http://localhost:3001/api/health
curl http://localhost:3001/api/articles | head -c 200
```

#### 从 .db 文件恢复

```bash
# 1. 停止服务
pm2 stop ydxl-server

# 2. 替换数据库文件
cp /backup/ydxl_20260711.db /opt/ydxl/server/data/ydxl.db

# 3. 删除 WAL 与 SHM 文件（避免版本不一致）
rm -f /opt/ydxl/server/data/ydxl.db-wal
rm -f /opt/ydxl/server/data/ydxl.db-shm

# 4. 重启服务
pm2 start ydxl-server
```

### 4.3 本地 IndexedDB 数据导出

前端用户可在浏览器控制台执行以下脚本，导出 Dexie 缓存的全部 7 张表数据为 JSON 文件（用于排查或迁移浏览器）：

```javascript
// 导出全部 7 张表数据为 JSON
const db = await indexedDB.open('ydxl-db')
const tables = ['articles', 'questions', 'words', 'reviews', 'stats', 'readingSessions', 'achievements']
const exportData = {}
for (const table of tables) {
  const tx = db.transaction(table, 'readonly')
  const store = tx.objectStore(table)
  exportData[table] = await store.getAll()
}
const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = `ydxl-cache-${new Date().toISOString().split('T')[0]}.json`
a.click()
URL.revokeObjectURL(url)
```

> 注意：Dexie 仅为只读缓存，权威数据在服务器 SQLite。如需完整数据，请从服务器备份。

---

## 5. 版本升级流程

### 5.1 git tag 规范

- 格式：`v<major>.<minor>.<patch>`（如 `v1.4.0`）
- 创建：`git tag -a v1.4.0 -m "技术栈精简与服务器本地存储迁移"`
- 推送：`git push origin v1.4.0`

### 5.2 CHANGELOG 维护

- 遵循 [Keep a Changelog](https://keepachangelog.com/) 规范
- 每次发布前更新项目根目录 `CHANGELOG.md`，分 `Added` / `Changed` / `Fixed` / `Removed` 四类
- 关联 git tag 与 CHANGELOG 条目，便于追溯

### 5.3 Dexie schema 升级注意事项

- 新增表或字段时，必须递增 `src/shared/services/db.ts` 的 `version(N)` 号
- **重要**：新版本的 `stores()` 必须**重新声明全部已有表**的 schema（复制上一版本定义、追加新索引），否则未声明的表会被当作删除处理——与 `db.ts` 现有 v1-v7 写法保持一致
- 仅新增索引/字段的升级由 Dexie 自动完成（自动建索引，数据行不动），**无需数据迁移**
- 当前 schema 为 **v7**（8 张表 = 7 业务表 + `aiCache`）；完整演进历史（v1 → v7）与索引全表见 [DATABASE.md](./DATABASE.md) 4.2 / 4.3 节
- 客户端 schema 变更规则与 v8 示例见 [UPGRADE.md 第五节](./UPGRADE.md)

### 5.4 SQLite schema 迁移手册

服务器 SQLite 采用「启动时增量迁移」：无独立迁移脚本，`server/src/db.ts` 在服务启动时自动完成建表与旧库补列。新增列 / 新增表的完整流程：

**第 1 步：开发侧改动（`server/src/db.ts`，两处缺一不可）**

1. 在 `CREATE TABLE IF NOT EXISTS` 语句中追加列定义（保证**新库**一次建到最新 schema）
2. 在迁移段补一条 `PRAGMA table_info(<table>)` 列存在性检查 + `ALTER TABLE ... ADD COLUMN`（保证**旧库**升级）。SQLite 不支持 `ADD COLUMN IF NOT EXISTS`，必须显式判断：

   ```ts
   const cols = db.prepare('PRAGMA table_info(articles)').all() as Array<{ name: string }>
   if (!cols.some((c) => c.name === 'newColumn')) {
     db.exec('ALTER TABLE articles ADD COLUMN newColumn TEXT')
   }
   ```

3. 新增高频查询时同步补 `CREATE INDEX IF NOT EXISTS` 索引（项目约定：列表查询必须走索引，避免全表扫描 + 排序）
4. 若新列需 JSON 序列化或加密存储，同步更新 `db.ts` 顶部的 `JSON_COLUMNS` / `ENCRYPTED_COLUMNS` 声明
5. 运行 `npm --prefix server test` 回归（测试环境使用 `:memory:` 内存库，不影响本机数据）

**第 2 步：升级前备份生产数据库**（见第 4 章）

```bash
sqlite3 /opt/ydxl/server/data/ydxl.db ".backup '/backup/ydxl_$(date +%Y%m%d).db'"
```

**第 3 步：部署并重启（迁移随启动自动执行）**

```bash
git pull && npm install && npm --prefix server install && npm run build && npm run server:build
pm2 restart ydxl-server   # 启动时自动执行 CREATE TABLE IF NOT EXISTS + 增量补列 + 建索引
```

**第 4 步：验证**

```bash
# 确认新列已存在
sqlite3 /opt/ydxl/server/data/ydxl.db "PRAGMA table_info(articles);"
# 确认索引已建立
sqlite3 /opt/ydxl/server/data/ydxl.db "PRAGMA index_list(articles);"
# 确认服务健康、数据完好（各表行数与升级前一致）
curl http://localhost:3001/api/health
```

> **回滚**：新增列对旧代码向后兼容（旧版本忽略多余列），一般无需回滚数据——`git checkout` 上一版本重新构建重启即可。破坏性变更（改主键 / 删列 / 改列类型）无法增量迁移，必须先用第 4 章的备份恢复，且应在设计阶段避免。
>
> **历史迁移项全表**与**单用户 → 多用户数据迁移**（`server/src/migrateMultiUser.ts`：`schema_meta` 幂等标记 + 文件备份 + 单事务）的机制说明见 [DATABASE.md](./DATABASE.md) 3.8 节。

### 5.5 前端强制更新 PWA 策略

- `vite.config.ts` 中 vite-plugin-pwa 配置 `registerType: 'autoUpdate'`，用户下次访问自动更新
- 如需强制立即更新，可在应用内显示「发现新版本，请刷新」提示（监听 SW 更新事件）
- **应急方案**：浏览器控制台执行以下命令清理所有缓存后刷新：

  ```javascript
  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
  ```

---

## 6. 容量规划

### 6.1 单用户数据量估算

| 表 | 单用户年增量（行） | 单行大小（KB） | 年存储量（KB） |
| --- | --- | --- | --- |
| articles | 365（每日 1 篇） | 5 | 1,825 |
| questions | 1,825（每篇 5 题） | 1 | 1,825 |
| words | 500（年新增） | 2 | 1,000 |
| reviews | 2,500（每词 5 次/年） | 0.5 | 1,250 |
| stats | 365（每日 1 行） | 0.2 | 73 |
| readingSessions | 365 | 0.3 | 110 |
| achievements | 20 | 0.2 | 4 |
| **合计** | — | — | **~6,087 KB ≈ 6 MB** |

### 6.2 SQLite 容量监控

SQLite 文件大小随数据量增长，单用户年增量约 6 MB。多用户场景下：

| 用户数 | 预估数据库大小 | 说明 |
| --- | --- | --- |
| 1 | ~6 MB | 单用户一年使用 |
| 10 | ~60 MB | 小型团队/家庭使用 |
| 100 | ~600 MB | 中等规模使用 |
| 1,000 | ~6 GB | 需评估迁移到外部数据库 |

**扩容触发阈值**：

- 数据库文件 > 1GB → 评估 VACUUM 清理碎片
- 数据库文件 > 10GB → 评估迁移到 Postgres / MySQL
- 磁盘剩余空间 < 20% → 紧急扩容磁盘

**查看数据库大小**：

```bash
ls -lh /opt/ydxl/server/data/ydxl.db
du -sh /opt/ydxl/server/data/
```

### 6.3 AI 调用成本估算

假设日活 100，每人每日 1 篇文章 + 5 道题 + 3 次查词：

- 单次调用 token 数：文章生成 ~2000、题目生成 ~1500、查词 ~500
- 日均 token：100 × (2000 + 5×1500 + 3×500) = 100 × 12,000 = 1,200,000 token
- 月均 token：36M（输入/输出比例约 2:1，即输入 24M / 输出 12M）

| 供应商 | 所用模型 | 月成本估算（36M token） | 说明 |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-v4-pro` | 约 ¥100 量级 | 输入缓存命中可显著降低成本；`deepseek-v4-flash` 约为其 1/3 |
| OpenAI | `gpt-5.2` / `gpt-5.2-mini` | 按 OpenAI 官方定价核算 | gpt-5.2-mini 成本远低于 gpt-5.2，简单任务降级可大幅节省 |
| 通义千问 | `qwen3-max` / `qwen3-turbo` | 按阿里云百炼定价核算 | qwen3-turbo 适合轻量任务 |

> 各供应商单价随官方调价变动，请以官方定价页为准：
> [DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) / [OpenAI Pricing](https://openai.com/api/pricing/) / 阿里云百炼控制台。
> 多供应商并存时，可在个人中心切换供应商以对比实际效果与成本。

**扩容触发阈值**：月成本 > ¥100 → 评估降低调用频率（如减少每日文章生成次数、缓存查词结果）、将简单任务固定使用轻量模型、或切换性价比更高的供应商。

---

## 7. 安全审计清单

> 安全机制总览、已知边界与漏洞报告渠道见根目录 [SECURITY.md](../SECURITY.md)；本节聚焦可执行的例行核查步骤。

### 7.1 环境变量核查

- [ ] 检查 `.env` 不在 git 仓库（`.gitignore` 含 `.env` 与 `.env.*`）
- [ ] 检查 `.env.example` 不含真实密钥（仅占位，参见项目根目录 `.env.example`）
- [ ] 检查服务器 `.env` 文件权限：`sudo chmod 600 /opt/ydxl/.env`
- [ ] 检查服务器 `.env` 文件归属：`sudo chown www-data:www-data /opt/ydxl/.env`
- [ ] 检查生产构建产物 `dist/assets/*.js` 不含真实密钥（`sk-` 开头的 DeepSeek/OpenAI 密钥等，grep 检查）：

  ```bash
  grep -rE "sk-[A-Za-z0-9]{20}" /opt/ydxl/dist/assets/*.js
  # 应无匹配（各供应商密钥仅在服务端 .env 中）
  ```

- [ ] **重点**：`VITE_*_API_KEY`（`VITE_DEEPSEEK_API_KEY` / `VITE_OPENAI_API_KEY` / `VITE_QWEN_API_KEY` / `VITE_CUSTOM_API_KEY`）仅限开发直连模式使用，**生产环境留空**；生产环境仅配置服务器端对应 `*_API_KEY`（含 custom 的 `CUSTOM_API_KEY`）
- [ ] 核对所用供应商的服务端密钥已配置且有效：`grep -E "^(DEEPSEEK|OPENAI|QWEN)_API_KEY=sk?.+" /opt/ydxl/.env`（至少一项有值；某供应商密钥缺失时该路由返回 503 PROXY_NOT_CONFIGURED）
- [ ] 模型白名单核对：确认前端请求的模型名在服务端 `UPSTREAMS[provider].allowedModels` 白名单内，避免 400 INVALID_MODEL

### 7.2 SQLite 文件权限检查

- [ ] 检查数据库文件权限：`ls -l /opt/ydxl/server/data/ydxl.db`（应为 `640` 或 `600`）
- [ ] 检查数据库文件归属：`sudo chown www-data:www-data /opt/ydxl/server/data/ydxl.db`
- [ ] 检查 `server/data/` 目录权限：`sudo chmod 750 /opt/ydxl/server/data/`
- [ ] 确认数据库文件不被 nginx 直接服务（仅在 Express 中访问）

**权限设置示例**：

```bash
sudo chown -R www-data:www-data /opt/ydxl/server/data
sudo chmod 750 /opt/ydxl/server/data
sudo chmod 640 /opt/ydxl/server/data/ydxl.db*
```

### 7.3 CORS 配置检查

- [ ] 检查 `CORS_ORIGIN` 环境变量是否配置：`grep CORS_ORIGIN /opt/ydxl/.env`
  - 开发环境可留空（默认 `Access-Control-Allow-Origin: *`）
  - **生产环境必须配置白名单**，如 `CORS_ORIGIN=https://ydxl.example.com,https://www.ydxl.example.com`
- [ ] 验证 `server/src/index.ts` 的 CORS 配置读取 `CORS_ORIGIN` 并按逗号分隔为白名单数组
- [ ] 验证非白名单来源的请求不返回 `Access-Control-Allow-Origin` 头（浏览器跨域拦截）
- [ ] 验证 OPTIONS 预检请求正常返回 204
- [ ] 验证 POST / PUT / DELETE 请求的 CORS 头正确（允许 `Content-Type`、`x-user-token` 请求头）

**配置示例**（`server/src/index.ts`）：

```typescript
const corsOrigin = process.env.CORS_ORIGIN
const corsOptions = corsOrigin
  ? { origin: corsOrigin.split(',').map((s) => s.trim()), methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-user-token'] }
  : {}
app.use(cors(corsOptions))
```

### 7.4 AI 代理访问控制

AI 代理端点由登录会话（`x-user-token`）保护，并按用户维度限流（20 次/分钟），无需配置或轮换专用 token。

### 7.5 依赖漏洞扫描

- 运行 `npm audit`（每月）
  - **严重级别（critical/high）**：立即处理
  - **中等级别（moderate）**：评估影响后处理
  - **低级别（low）**：可延后处理
- 运行 `npm audit fix` 自动修复可修复的漏洞
- 运行 `npm audit fix --force` **谨慎使用**（可能引入 breaking change，需回归测试）
- 同时扫描 server 子包：`npm --prefix server audit`
- 升级后运行 `npm test` 与 `npm --prefix server test` 确认测试全绿

### 7.6 审计日志核查（多用户 P2）

`operation_logs` 只追加记录认证 / 用户管理 / 数据写操作 / 敏感读 / AI 调用 / 403 权限拒绝（动作字典见 [API_REFERENCE 1.14.4](./API_REFERENCE.md)）。

- [ ] 抽查可疑登录：查询 403 拒绝与登录失败痕迹——`GET /api/admin/logs?action=auth.login.failed`（teacher/admin 登录后在审计日志页过滤，或直接查库 `SELECT * FROM operation_logs WHERE result != 'success' ORDER BY createdAt DESC LIMIT 50`）
- [ ] 确认归档目录存在且有近期文件：`ls -l /opt/ydxl/server/data/log-archive/`（保留策略启动时自动归档 180 天前日志）
- [ ] 备份策略覆盖归档 CSV：确认 7.3 节的 SQLite 备份范围包含 `server/data/log-archive/`（归档文件不可再生成，丢失即不可追溯）
- [ ] 脱敏抽查（季度）：`grep -riE 'password|token|sk-' server/data/log-archive/*.csv` 应无命中（detail 写入前已键名过滤；若命中说明出现新的敏感写入点，需在 `audit.ts` 修正）
- [ ] 班级学情查阅留痕（多用户 P3）：`SELECT userId, username, detail, createdAt FROM operation_logs WHERE action = 'class_stats.view' ORDER BY createdAt DESC LIMIT 20`——detail 仅含 `days/from/to/studentCount`，如出现学员明细或学习内容则为越界写入，需排查

---

## 附录：常用命令速查

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行前端单元测试（vitest） |
| `npm --prefix server test` | 运行后端单元测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm run build` | 前端生产构建（`tsc -b && vite build`） |
| `npm run server:build` | 服务器构建（`tsc`） |
| `npm run server:dev` | 服务器开发模式（tsx watch） |
| `npm run server:start` | 启动服务器（`node server/dist/index.js`） |
| `npm run preview` | 预览前端构建产物 |
| `pm2 status` | 查看 PM2 进程状态 |
| `pm2 logs ydxl-server` | 实时查看服务器日志 |
| `pm2 restart ydxl-server` | 重启服务 |
| `sudo systemctl status ydxl` | systemd 服务状态 |
| `sudo systemctl restart ydxl` | 重启 systemd 服务 |
| `sudo journalctl -u ydxl -f` | 实时查看 systemd 日志 |
| `sudo nginx -t` | 测试 Nginx 配置 |
| `sudo systemctl reload nginx` | 重载 Nginx 配置 |
| `sudo certbot certificates` | 查看 SSL 证书状态 |
| `sqlite3 /opt/ydxl/server/data/ydxl.db` | 进入 SQLite 命令行 |
| `curl http://localhost:3001/api/health` | 服务器健康检查 |
| `npm audit` | 依赖漏洞扫描 |
| `npm outdated` | 检查依赖更新 |
