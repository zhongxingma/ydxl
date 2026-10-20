# 部署指南

本文档面向运维人员，详细说明 `ydxl` 英语学习 PWA 应用的部署流程、环境变量配置、Linux 服务器部署、多 AI 供应商（DeepSeek / OpenAI / 通义千问 / 自定义模型）密钥管理及 PWA 注意事项。

> 项目技术栈：Vite + React 18 + TypeScript + Dexie（前端 IndexedDB 离线缓存）+ Express + better-sqlite3（本地服务器存储）+ vite-plugin-pwa。**生产环境推荐 Linux 服务器本地部署**（systemd + Nginx 反代），不再依赖 Vercel / Netlify / Supabase。完整逐步命令请参考 [LINUX_DEPLOY.md](./LINUX_DEPLOY.md)。

---

## 1. 环境配置要求

### 1.1 Node.js 与包管理器

| 依赖 | 最低版本 | 推荐版本 |
| --- | --- | --- |
| Node.js | >= 18 | 18 LTS 或 20 LTS |
| npm | >= 9 | 随 Node 18/20 自带版本 |

以上要求由 `package.json` 的 `engines` 字段强制声明：

```json
"engines": {
  "node": ">=18",
  "npm": ">=9"
}
```

> 如使用 nvm，可执行 `nvm use 18` 或 `nvm use 20` 切换版本。

### 1.2 操作系统

- **开发环境**：跨平台支持 Windows（PowerShell / Git Bash）、macOS、Linux
- **生产部署**：Linux 服务器（推荐 Ubuntu 22.04 / Debian 12），需要本地文件系统写入权限（SQLite 数据库文件落盘到 `server/data/ydxl.db`）

> 注意：Windows 环境下复制环境变量模板使用 `copy`，macOS/Linux 使用 `cp`。

### 1.3 浏览器兼容性

`package.json` 的 `browserslist` 字段定义前端构建目标：

```json
"browserslist": [
  "> 0.5%",
  "last 2 versions",
  "not dead",
  "not ie 11"
]
```

含义：

- 全球使用率 > 0.5% 的浏览器
- 每个浏览器的最近 2 个版本
- 排除已停止维护（dead）的浏览器
- 明确排除 IE 11

Vite 构建目标 `es2020`（见 `vite.config.ts`），支持现代浏览器（Chrome / Edge / Firefox / Safari 近 2 年版本）。

### 1.4 PWA 运行环境要求

- Service Worker 仅在 **HTTPS** 或 **localhost** 下注册
- 需要支持 Service Worker 与 Web App Manifest 的现代浏览器
- Linux 部署时通过 Nginx + Let's Encrypt 提供 HTTPS（见 [LINUX_DEPLOY.md](./LINUX_DEPLOY.md) 第 8-9 章）

---

## 2. 环境变量矩阵

### 2.1 安全提示

> **⚠️ 重要**：以 `VITE_` 前缀开头的环境变量会被 Vite 打包进前端 bundle，任何访问站点的用户均可通过浏览器开发者工具查看。**禁止**将真实生产 AI 密钥放入 `VITE_` 前缀变量。
>
> 生产环境推荐：仅在服务器 `.env` 配置所用供应商的服务端密钥（`DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `QWEN_API_KEY`），前端通过本地服务器代理 `POST /api/v1/ai-proxy/<provider>` 转发到对应上游，任何供应商的真实密钥都不进入前端 bundle。

### 2.2 完整变量矩阵

#### 前端变量（带 `VITE_` 前缀，会打包进 bundle）

| 变量名 | 作用 | 必填 | 默认值 |
| --- | --- | --- | --- |
| `VITE_AI_PROVIDER` | 默认 AI 供应商（`deepseek` / `openai` / `qwen`）；优先级：用户个人中心选择（localStorage）> 此变量 > `deepseek` | 否 | `deepseek` |
| `VITE_DEEPSEEK_API_KEY` | DeepSeek 直连密钥（仅前端直连模式） | 仅直连 | - |
| `VITE_DEEPSEEK_MODEL` | DeepSeek 模型名：`deepseek-v4-pro`（高质量）/ `deepseek-v4-flash`（轻量） | 否 | `deepseek-v4-pro` |
| `VITE_OPENAI_API_KEY` | OpenAI 直连密钥（仅前端直连模式） | 仅直连 | - |
| `VITE_OPENAI_MODEL` | OpenAI 模型名：`gpt-5.2` / `gpt-5.2-mini` | 否 | `gpt-5.2` |
| `VITE_QWEN_API_KEY` | 通义千问直连密钥（仅前端直连模式，DashScope compatible-mode） | 仅直连 | - |
| `VITE_QWEN_MODEL` | 通义千问模型名：`qwen3-max` / `qwen3-turbo` | 否 | `qwen3-max` |
| `VITE_API_BASE_URL` | 本地服务器 API 基础路径 | 是 | `/api` |
| `VITE_AI_PROXY_URL` | AI 代理基础路径（代理模式填 `/api` 即可，Provider 自动拼接 `/v1/ai-proxy/<provider>` 后缀，勿填完整代理路径） | 推荐 | - |
| `VITE_AI_PROXY_TOKEN` | AI 代理鉴权 token（与服务端 `AI_PROXY_TOKEN` 一致，预留项） | 否 | - |

#### 服务端变量（不带 `VITE_` 前缀，仅服务器运行时可用，不进入前端 bundle）

| 变量名 | 作用 | 必填 | 默认值 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 服务器代理转发到 DeepSeek 上游的 API Key（选用 deepseek 时必填，缺失则该路由返回 503） | 按需 | - |
| `OPENAI_API_KEY` | 服务器代理转发到 OpenAI 上游的 API Key（选用 openai 时必填） | 按需 | - |
| `QWEN_API_KEY` | 服务器代理转发到通义千问上游的 API Key（选用 qwen 时必填） | 按需 | - |
| `NODE_ENV` | 运行环境：production 启用安全默认（CORS 收紧至本机、错误信息脱敏、强制 `ENCRYPTION_KEY` 否则拒绝启动） | 推荐 | `development` |
| `CORS_ORIGIN` | CORS 来源白名单（逗号分隔；未配置时生产默认仅本机） | 生产必填 | - |
| `ENCRYPTION_KEY` | SQLite 敏感字段加密密钥（生产必配，`openssl rand -hex 32` 生成；**配置后切勿修改**，否则旧数据无法解密） | 生产必填 | - |
| `DB_PATH` | SQLite 数据库文件路径（留空按 NODE_ENV 自动选择） | 否 | `server/data/ydxl.db` |
| `AI_PROXY_TOKEN` | AI 代理鉴权 token（预留项，与前端 `VITE_AI_PROXY_TOKEN` 一致） | 否 | - |
| `PORT` | 本地 Express 服务器监听端口 | 否 | `3001` |

> 以上服务端变量仅配置在服务器 `.env` 文件或 systemd `EnvironmentFile` 中，由 `server/src/index.ts` 与 `server/src/ai-proxy.ts` 在运行时读取。

### 2.3 变量配置参考

完整变量模板见仓库根目录 `.env.example` 文件。

---

## 3. 本地开发部署

### 3.1 安装依赖

```bash
# 前端依赖
npm install

# 服务器子包依赖
npm --prefix server install
```

> 如 `better-sqlite3` 编译失败，请先安装构建工具：Linux 执行 `sudo apt install build-essential`，Windows 安装 Visual Studio Build Tools。

### 3.2 配置环境变量

复制环境变量模板（Windows 使用 `copy`，macOS/Linux 使用 `cp`）：

```bash
# Windows (PowerShell)
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

编辑 `.env`，至少配置以下变量：

- `VITE_AI_PROVIDER`：默认供应商（`deepseek` / `openai` / `qwen`，默认 `deepseek`）
- 对应供应商的直连密钥（如 `VITE_DEEPSEEK_API_KEY`，仅前端直连模式需要）
- 服务端代理密钥（如 `DEEPSEEK_API_KEY`，与同名 `VITE_` 变量可使用同一密钥；**默认代理模式下必填**）

> 供应商选择优先级：用户在「个人中心」的选择（localStorage）> `VITE_AI_PROVIDER` > 默认 `deepseek`。
> 每个供应商的 API Key 在 localStorage 中按供应商独立存储（`ydxl-ext-ai-api-key-deepseek` / `-openai` / `-qwen`），切换互不覆盖。

### 3.3 常用脚本命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端开发服务器（默认 http://localhost:5173） |
| `npm run server:dev` | 启动本地 Express 服务器（监听模式，默认 http://localhost:3001） |
| `npm run build` | 类型检查 + 前端生产构建（产物输出至 `dist/`） |
| `npm run server:build` | 服务器 TypeScript 编译（产物输出至 `server/dist/`） |
| `npm run server:start` | 启动构建后的服务器（`node server/dist/index.js`） |
| `npm run preview` | 预览前端构建产物（默认 http://localhost:4173） |
| `npm run serve` | 预览构建产物并指定端口 4173 |
| `npm test` | 运行前端 vitest 测试（单次运行） |
| `npm --prefix server test` | 运行后端 vitest 测试 |
| `npm run typecheck` | TypeScript 类型检查（不产出文件） |
| `npm run lint` | ESLint 代码检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 `src/` 下代码 |

> `npm run build` 实际执行 `tsc -b && vite build`，会先进行类型检查再构建。

### 3.4 开发流程

开发模式下需要同时启动两个进程：

1. **API 服务器**：`npm run server:dev`（监听 3001 端口，支持热重启）
2. **前端开发服务器**：`npm run dev`（监听 5173 端口，Vite 自动将 `/api` 请求代理到 `http://localhost:3001`，见 `vite.config.ts` 的 `server.proxy` 配置）

---

## 4. Linux 服务器部署

### 4.1 部署架构

```
浏览器（PWA）
   ↓ HTTPS
Nginx（反向代理 + 静态文件服务）
   ├── / → dist/ 目录（静态资源）
   └── /api → http://localhost:3001（Express 服务器）
                  ├── /api/articles | questions | words | ...（7 张表 REST API）
                  ├── /api/v1/ai-proxy/deepseek（AI 代理 · DeepSeek 上游）
                  ├── /api/v1/ai-proxy/openai（AI 代理 · OpenAI 上游）
                  ├── /api/v1/ai-proxy/qwen（AI 代理 · 通义千问上游）
                  └── /api/health（健康检查）
                       ↓
                 better-sqlite3（server/data/ydxl.db）
                       ↓
                 AI 上游（DeepSeek / OpenAI / DashScope，按所选供应商转发）
```

> 服务端 AI 代理采用**上游注册表模式**（`server/src/ai-proxy.ts` 的 `UPSTREAMS`）：每个供应商自动注册
> `/v1/ai-proxy/<name>` 与 `/v1/ai-proxy/<name>/stream` 路由，模型白名单按供应商独立校验。
> 新增供应商只需在 `UPSTREAMS` 追加条目并重启服务。

### 4.2 环境准备

```bash
# 系统更新
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 20.x（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证版本
node -v   # >= 18
npm -v    # >= 9

# 安装构建工具（better-sqlite3 编译需要）
sudo apt install -y build-essential python3
```

### 4.3 获取代码与安装依赖

```bash
git clone <repo-url> ydxl
cd ydxl

# 前端依赖
npm install

# 服务器子包依赖
npm --prefix server install
```

### 4.4 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，重点配置：

- 所选供应商的服务端密钥（**至少配一个**）：
  - `DEEPSEEK_API_KEY`：从 https://platform.deepseek.com/api_keys 获取（**推荐必配**，作为 custom 供应商的自动兜底）
  - `OPENAI_API_KEY`：从 https://platform.openai.com/api-keys 获取
  - `QWEN_API_KEY`：从阿里云百炼控制台 https://bailian.console.aliyun.com/?apiKey=1 获取
  - `CUSTOM_API_KEY`：自定义模型（OpenRouter / SiliconFlow / Ollama 等）的上游密钥，配合 `CUSTOM_API_ENDPOINT` 使用
- 自定义模型端点/模型统一在 `config/ai-providers.json` 声明（`custom.endpoint` / `custom.model` / `fallback.provider`），构建与服务端启动时自动注入/派生 `VITE_CUSTOM_*` 与 `CUSTOM_API_ENDPOINT` / `CUSTOM_MODELS`，无需在 `.env` 重复配置
- `VITE_AI_PROVIDER=custom`：默认供应商（推荐：自定义模型优先，失败自动回退 DeepSeek 兜底；用户可在个人中心切换）
- `PORT=3001`：服务器监听端口
- `NODE_ENV=production`：启用安全默认（CORS 收紧、错误脱敏、强制加密配置）
- `CORS_ORIGIN=https://your-domain.com`：生产环境 CORS 白名单（**必配**，未配置时仅允许本机）
- `ENCRYPTION_KEY=<openssl rand -hex 32 生成的值>`：敏感字段加密密钥（生产**必配**，否则拒绝启动；配置后不可更改）
- `VITE_API_BASE_URL=/api`：前端 API 基础路径

### 4.5 构建产物

```bash
# 前端构建
npm run build
# 产物输出至 dist/

# 服务器构建
npm run server:build
# 产物输出至 server/dist/
```

### 4.6 启动服务

详细步骤见 [LINUX_DEPLOY.md](./LINUX_DEPLOY.md)，此处给出两种推荐方式：

#### 方式 A：PM2（推荐）

```bash
sudo npm install -g pm2

# 启动服务器
pm2 start server/dist/index.js --name ydxl-server

# 持久化（开机自启）
pm2 save
pm2 startup
```

#### 方式 B：systemd

创建 `/etc/systemd/system/ydxl.service`：

```ini
[Unit]
Description=ydxl English Learning App Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ydxl
EnvironmentFile=/opt/ydxl/.env
ExecStart=/usr/bin/node /opt/ydxl/server/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable ydxl
sudo systemctl start ydxl
sudo systemctl status ydxl
```

### 4.7 Nginx 反向代理配置

```bash
sudo apt install nginx
```

创建 `/etc/nginx/sites-available/ydxl`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 静态资源（前端构建产物）
    root /opt/ydxl/dist;
    index index.html;

    # PWA Service Worker 不缓存（确保版本更新）
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    # API 代理到本地 Express 服务器
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA 前端路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/ydxl /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.8 SSL 配置（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

证书自动续期已配置，无需手动维护。

### 4.9 部署验证

1. **前端加载**：访问 `http://your-domain.com`，确认应用首页正常渲染
2. **API 健康检查**：访问 `http://your-domain.com/api/health`，应返回 `{"status":"ok"}`
3. **AI 调用验证**：进入应用阅读页面，触发文章生成，确认所选供应商 AI 响应正常；也可用 curl 直接测试代理端点（见第 8 章）
4. **PWA 安装验证**：浏览器地址栏出现安装图标，确认可弹出 PWA 安装弹窗
5. **离线验证**：断网后刷新页面，确认 PWA 仍可加载（Service Worker 缓存生效）

---

## 5. 多 AI 供应商说明

### 5.1 支持的供应商与模型

| 供应商 | 上游端点 | 高质量模型 | 轻量模型 | 密钥获取 |
| --- | --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-v4-pro` | `deepseek-v4-flash` | https://platform.deepseek.com/api_keys |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-5.2` | `gpt-5.2-mini` | https://platform.openai.com/api-keys |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen3-max` | `qwen3-turbo` | 阿里云百炼控制台 |

> 模型分级机制：复杂任务（文章生成、题目生成）使用高质量模型；简单任务（查词、例句）自动降级到轻量模型。
> 注意：DeepSeek 旧模型名 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 官方停用，请使用 `deepseek-v4-pro` / `deepseek-v4-flash`。

### 5.2 供应商选择优先级

```
用户个人中心选择（localStorage: ydxl-ext-ai-provider）
  > 环境变量 VITE_AI_PROVIDER
    > 默认 deepseek
```

用户在「个人中心 → AI 设置」下拉框切换供应商后立即生效，无需重启服务；
每个供应商的 API Key（前端直连模式）按供应商独立存储于 localStorage。

### 5.3 新增供应商的扩展方法

服务端与前端均采用注册表/映射模式，新增供应商步骤：

1. **服务端**：`server/src/ai-proxy.ts` 的 `UPSTREAMS` 追加条目（endpoint / envKeyName / allowedModels），路由自动注册
2. **前端类型**：`src/shared/services/ai/types.ts` 扩展 `AIProviderType` 与 `AI_PROVIDER_META`
3. **前端 Provider**：新建 `xxxProvider.ts` 继承 `BaseAIProvider`，在 `index.ts` 工厂 switch-case 注册
4. **UI**：`ProfilePage.tsx` 下拉框追加 `<option>`；`useProfileSettings.ts` 补充 localStorage key
5. 重启服务 + 前端重新构建

---

## 6. vercel.json 兼容性说明

仓库根目录保留 `vercel.json`，仅作为兼容性配置：

```json
{
  "rewrites": [
    { "source": "/api/v1/ai-proxy/:provider", "destination": "/api/ai-proxy" },
    { "source": "/api/v1/:path*", "destination": "/api/:path" },
    { "source": "/api/:path*", "destination": "/api/:path*" }
  ]
}
```

> **注意**：`vercel.json` 仅保留兼容性 rewrite 规则。**本项目不再推荐 Vercel / Netlify 部署**，主要部署方式为 Linux 服务器本地部署（Express + SQLite + Nginx）。如确实需要 Vercel 部署，请将 SQLite 替换为外部数据库（不在本指南范围内）。

---

## 7. 构建产物说明

### 7.1 前端构建命令与产物目录

```bash
npm run build
```

执行 `tsc -b && vite build`，类型检查通过后构建，产物输出至 `dist/` 目录。

### 7.2 服务器构建命令与产物目录

```bash
npm run server:build
```

执行 `tsc`（在 server/ 子包内），产物输出至 `server/dist/` 目录，包含：

| 文件 | 说明 |
| --- | --- |
| `server/dist/index.js` | Express 应用入口 |
| `server/dist/db.js` | SQLite 数据库初始化 |
| `server/dist/routes.js` | 7 张表 REST 路由工厂 |
| `server/dist/ai-proxy.js` | AI 代理端点 |
| `server/dist/seed.js` | 可选初始化脚本 |

### 7.3 dist/ 目录结构（前端）

| 文件/目录 | 说明 |
| --- | --- |
| `index.html` | 入口 HTML |
| `assets/` | 静态资源（JS / CSS / PNG / SVG） |
| `manifest.webmanifest` | PWA 应用清单 |
| `pwa-192.png` | PWA 图标 192x192 |
| `pwa-512.png` | PWA 图标 512x512 |
| `pwa-maskable-512.png` | PWA maskable 图标 512x512（80% safe-zone） |
| `registerSW.js` | Service Worker 注册脚本 |
| `sw.js` | Service Worker 主文件 |

### 7.4 assets/ 目录 chunk 拆分

`assets/` 下包含以下类型的 chunk：

| 文件命名模式 | 类型 | 说明 |
| --- | --- | --- |
| `index-*.js` | 主 bundle | 应用入口及核心代码 |
| `index-*.css` | 主样式 | Tailwind 构建产物 |
| `react-*.js` | vendor chunk | React 运行时（react / react-dom / react-router-dom 合并） |
| `recharts-*.js` | vendor chunk | 图表库（体积大，仅 StatsPage 使用） |
| `deepseek-provider-*.js` | 路由级 lazy chunk | DeepSeek provider 懒加载 |
| `useTranslation-*.js` | 路由级 lazy chunk | 翻译 hook 懒加载 |
| `workbox-*.js` | Workbox 运行时 | Service Worker 运行时依赖 |

### 7.5 chunk 拆分策略

`vite.config.ts` 的 `rollupOptions.output.manualChunks` 配置：

```typescript
manualChunks: {
  // Recharts 体积较大且仅 StatsPage 使用，单独拆分避免污染路由 chunk
  recharts: ['recharts'],
  // React 运行时核心库（react/react-dom/react-router-dom）独立 chunk
  react: ['react', 'react-dom', 'react-router-dom'],
}
```

- **recharts**：体积大且仅 `StatsPage` 使用，单独拆分避免污染其他路由 chunk
- **react**：将 `react`、`react-dom`、`react-router-dom` 合并为单一 chunk，提升缓存命中率

### 7.6 Sourcemap 配置

- 当前配置：`sourcemap: false`（见 `vite.config.ts`）
- 生产构建关闭 sourcemap，避免泄露原始源码
- 如需线上排错，可修改为 `sourcemap: 'hidden'`（生成但不暴露给浏览器，仅供服务器端错误追踪）

---

## 8. PWA 部署注意事项

### 8.1 HTTPS 要求

Service Worker **仅在 HTTPS 或 localhost 下注册**。

- Linux 服务器通过 Nginx + Let's Encrypt 提供 HTTPS（见 [LINUX_DEPLOY.md](./LINUX_DEPLOY.md) 第 9 章）
- 本地开发 `http://localhost:5173` 视为安全上下文，可正常注册
- 自建服务器需自行配置 SSL 证书（如使用 Nginx + Certbot）

### 8.2 Service Worker 缓存策略

`vite.config.ts` 的 `VitePWA` 配置：

```typescript
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
  },
})
```

- **registerType: `autoUpdate`**：自动更新模式，检测到新版本在后台下载并激活
- **precache globPatterns**：预缓存 `js / css / html / ico / png / svg` 类型资源
- **首次访问**：注册 Service Worker，precache 静态资源
- **后续访问**：优先从缓存加载，后台检查更新

### 8.3 更新发布后的用户侧更新机制

**autoUpdate 模式下的更新流程**：

1. 部署新版本后，Service Worker 检测到新版本会在后台下载
2. 用户下次访问（或刷新）时激活新 Service Worker
3. 新版本资源替换旧缓存

**强制更新方法**（当用户反馈未获取到新版本时）：

引导用户在浏览器控制台执行：

```javascript
caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
```

执行后刷新页面即可加载最新版本。

> 也可指导用户通过浏览器 DevTools → Application → Service Workers →「Unregister」后刷新。

### 8.4 Nginx 中 Service Worker 特殊处理

部署 Nginx 时需对 `sw.js` 关闭缓存，确保版本更新及时生效：

```nginx
location = /sw.js {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires off;
}
```

### 8.5 图标文件位置校验

部署前需确认以下图标文件存在于 `public/` 目录：

| 文件路径 | 尺寸 | 用途 |
| --- | --- | --- |
| `public/pwa-192.png` | 192x192 | PWA 标准图标 |
| `public/pwa-512.png` | 512x512 | PWA 标准图标 |
| `public/pwa-maskable-512.png` | 512x512（80% safe-zone） | Android 自适应图标 |

`vite.config.ts` 的 `manifest.icons` 配置三套图标：

```typescript
icons: [
  { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]
```

> 验证：构建后检查 `dist/` 目录是否包含 `pwa-192.png`、`pwa-512.png`、`pwa-maskable-512.png` 三个文件。

---

## 9. AI 代理端点测试与故障速查

### 9.1 curl 测试各供应商代理端点

```bash
# DeepSeek
curl -X POST http://localhost:3001/api/v1/ai-proxy/deepseek \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"你好"}]}'

# OpenAI
curl -X POST http://localhost:3001/api/v1/ai-proxy/openai \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5.2","messages":[{"role":"user","content":"Hello"}]}'

# 通义千问
curl -X POST http://localhost:3001/api/v1/ai-proxy/qwen \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3-max","messages":[{"role":"user","content":"你好"}]}'

# 自定义模型（端点/模型由 config/ai-providers.json 派生）
curl -X POST http://localhost:3001/api/v1/ai-proxy/custom \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-ai/DeepSeek-V4-Flash","messages":[{"role":"user","content":"你好"}]}'
```

正常响应应包含 `choices[0].message.content`。

### 9.2 常见错误码速查

| HTTP 状态码 | error.code | 含义 | 处理方法 |
| --- | --- | --- | --- |
| 400 | `INVALID_BODY`（含模型白名单错误，消息形如 `Unsupported model: xxx`） | 模型不在该供应商白名单 / `messages` 缺失或为空 / `max_tokens` 超过 4096 上限 | 核对模型名是否为该供应商的 allowedModels 成员（custom 由 `CUSTOM_MODELS` 声明，未配置时不限制） |
| 429 | `RATE_LIMITED` | AI 代理限流（20 次/分钟/用户，按 userId 计量） | 降低调用频率；检查是否有异常客户端 |
| 502 / 504 | - | 上游无响应、返回错误或超时（上游超时上限 150s） | 检查服务器出网能力与上游余额；查看服务端日志中上游状态码 |
| 503 | `PROXY_NOT_CONFIGURED` | 所选供应商的服务端 API Key 未配置（custom 需同时配置 `CUSTOM_API_KEY` + `CUSTOM_API_ENDPOINT`） | 在 `.env` 配置对应 `*_API_KEY` 并重启服务；custom 503 时前端自动回退 DeepSeek 兜底 |

### 9.3 密钥未配置的典型症状

- 阅读页「开始今日阅读」报"生成失败"
- 练习题生成失败、生词 AI 补全失败
- 服务端日志出现 `[ydxl-server]` 503 相关记录

排查顺序：确认所用供应商 → 检查 `.env` 对应密钥 → 重启服务 → 用 9.1 的 curl 验证。

---

## 相关文档

- [LINUX_DEPLOY.md](./LINUX_DEPLOY.md)：实战 Linux 部署指南（逐步命令）
- [OPERATIONS.md](./OPERATIONS.md)：运维手册（SQLite 备份、Express 监控）
- [API_REFERENCE.md](./API_REFERENCE.md)：API 参考（含 Local Server REST API）
- [README](../README.md)：项目概述与快速开始
