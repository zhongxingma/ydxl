# 实战 Linux 部署指南

本文档面向运维人员，提供在 Ubuntu 22.04 / Debian 12 上逐步部署 `ydxl` 英语学习 PWA 应用的实战命令。覆盖 Node.js 环境、依赖安装、构建、PM2 / systemd 服务、Nginx 反代、Let's Encrypt SSL、DeepSeek 密钥配置、防火墙与日常维护命令。

> 部署架构概览见 [DEPLOYMENT.md](./DEPLOYMENT.md) 第 4 章。

***

## 1. 环境准备

### 1.1 系统更新

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 安装 Node.js（NodeSource 方式，推荐生产部署）

```bash
# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

或使用 nvm 管理 Node 版本（适合多版本切换）：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 1.3 验证版本

```bash
node -v   # 应 >= 18
npm -v    # 应 >= 9
```

### 1.4 安装构建工具

`better-sqlite3` 编译需要 C++ 工具链与 Python 3：

```bash
sudo apt install -y build-essential python3
```

***

## 2. 获取代码

```bash
# 假设部署到 /opt/ydxl
sudo mkdir -p /opt/ydxl
sudo chown $USER:$USER /opt/ydxl

git clone <repo-url> /opt/ydxl
cd /opt/ydxl
```

***

## 3. 安装依赖

### 3.1 前端依赖

```bash
npm install
```

### 3.2 服务器子包依赖

```bash
npm --prefix server install
```

### 3.3 验证 better-sqlite3 编译

如安装过程中出现 `better-sqlite3` 编译错误，请检查：

* `build-essential` 已安装：`sudo apt install -y build-essential`

* `python3` 已安装：`python3 --version`

* Node 版本 >= 18：`node -v`

测试编译是否成功：

```bash
cd server
node -e "require('better-sqlite3')(':memory:').close()"
# 输出无报错即成功
cd ..
```

***

## 4. 配置环境变量

### 4.1 复制模板

```bash
cp .env.example .env
```

### 4.2 配置 AI 供应商密钥

项目支持多 AI 供应商（deepseek / openai / qwen / custom 自定义模型），**至少配置一个**所用供应商的服务端密钥。编辑 `.env`：

```bash
# ===== AI 供应商密钥（至少配置一项）=====

# DeepSeek Key（从 https://platform.deepseek.com/api_keys 获取）
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# OpenAI Key（从 https://platform.openai.com/api-keys 获取，选用 openai 时必填）
OPENAI_API_KEY=

# 通义千问 Key（从阿里云百炼控制台 https://bailian.console.aliyun.com/?apiKey=1 获取，选用 qwen 时必填）
QWEN_API_KEY=

# ===== 自定义模型上游（选用 custom 时配置） =====
# 端点 + 模型 ID 统一在 config/ai-providers.json 声明一次：
#   { "custom": { "endpoint": "https://api.siliconflow.cn/v1", "model": "deepseek-ai/DeepSeek-V4-Flash" } }
# - 前端：vite 构建自动注入 VITE_CUSTOM_API_ENDPOINT / VITE_CUSTOM_MODEL
# - 服务端：server 启动读取同一 JSON 派生 CUSTOM_API_ENDPOINT / CUSTOM_MODELS
# 因此 .env 中无需（也不应）再重复配置端点/模型，仅需在此填密钥：
CUSTOM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# ===== 自定义模型前端默认供应商 =====
VITE_AI_PROVIDER=custom
# 密钥留服务端（上面 CUSTOM_API_KEY），前端变量必须留空，避免打进公开 bundle
VITE_CUSTOM_API_KEY=

# 前端直连密钥（开发调试用；生产留空走服务端代理）
VITE_DEEPSEEK_API_KEY=

# 本地服务器 API 基础路径
VITE_API_BASE_URL=/api

# 本地服务器端口
PORT=3001

# 运行环境（生产必须设为 production：启用 CORS 收紧、错误脱敏、强制加密配置）
NODE_ENV=production

# CORS 允许的来源白名单（逗号分隔，生产环境必配）
# 未配置时生产默认仅允许本机来源
CORS_ORIGIN=https://your-domain.com

# 数据加密密钥（生产必配，否则拒绝启动；生成后切勿修改）
openssl rand -hex 32   # 生成一次，填入下方 ENCRYPTION_KEY
ENCRYPTION_KEY=<生成的-64位十六进制>
```

> ⚠️ 安全提示：`.env` 文件不应进入 git 仓库，`.gitignore` 已默认忽略 `.env` 与 `.env.*`。
> 各供应商模型白名单：DeepSeek `deepseek-v4-pro`/`deepseek-v4-flash`、OpenAI `gpt-5.2`/`gpt-5.2-mini`、通义千问 `qwen3-max`/`qwen3-turbo`。
> 注意：DeepSeek 旧模型 `deepseek-chat`/`deepseek-reasoner` 已于 2026-07-24 官方停用。
> 自定义模型调用链：custom 优先（经服务端代理转发，规避 CORS）→ 失败/未配置自动回退 DeepSeek 兜底。

### 4.3 启用 AI 代理鉴权（可选）

如需限制前端调用 AI 代理（防止局域网内其他用户滥用），可启用 token 鉴权：

```bash
# 生成随机 token（64 字符十六进制）
openssl rand -hex 32

# 在 .env 中配置
AI_PROXY_TOKEN=<生成的-token>
VITE_AI_PROXY_TOKEN=<相同的-token>
VITE_AI_PROXY_URL=/api/v1/ai-proxy
```

> 注意：`VITE_AI_PROXY_TOKEN` 会进入前端 bundle，仅在内部使用场景下提供基础鉴权。生产环境主要依赖网络隔离（局域网 + Nginx）。

***

## 5. 构建

### 5.1 前端构建

```bash
npm run build
# 产物输出至 dist/
```

构建执行 `tsc -b && vite build`，包含 TypeScript 类型检查。产物包含静态资源、PWA Service Worker、应用清单。

### 5.2 服务器构建

```bash
npm run server:build
# 产物输出至 server/dist/
```

构建执行 `tsc`（在 server/ 子包内），产物包含 `index.js` / `db.js` / `routes.js` / `ai-proxy.js` / `seed.js`。

### 5.3 验证构建产物

```bash
# 前端产物
ls dist/
# 应包含：index.html、assets/、manifest.webmanifest、pwa-*.png、sw.js、registerSW.js

# 服务器产物
ls server/dist/
# 应包含：index.js、db.js、routes.js、ai-proxy.js、seed.js
```

### 5.4 部署前清理（可选）

在将构建产物同步到生产服务器前，建议清理开发环境遗留的缓存与干扰目录，避免误打包无关文件。本节提供两种推荐方式。

#### 5.4.1 不应部署的目录/文件清单

以下目录/文件仅用于开发环境，**不应进入生产环境**：

| 目录/文件            | 说明                      | 处理方式                               |
| ---------------- | ----------------------- | ---------------------------------- |
| `node_modules/`  | 开发依赖（含 devDependencies） | 生产环境应通过 `npm ci --production` 重新安装 |
| `.git/`          | 版本控制元数据                 | 不需要                                |
| `.husky/_/`      | Git hooks 脚本            | 不需要                                |
| `coverage/`      | 测试覆盖率报告                 | 不需要                                |
| `.vitest/`       | vitest 测试缓存             | 不需要                                |
| `src/`           | 前端源代码                   | 生产环境只需 `dist/` 编译产物                |
| `tsconfig*.json` | TypeScript 构建配置         | 生产环境不需要                            |
| `vite.config.*`  | Vite 构建配置               | 生产环境不需要                            |
| `*.tsbuildinfo`  | TypeScript 增量构建缓存       | 不需要                                |
| `.trae/`         | IDE 配置（Trae）            | 不需要                                |
| `.vscode/`       | IDE 配置（VS Code）         | 不需要                                |

#### 5.4.2 推荐方式：使用 clean-build.sh 脚本

项目提供 `scripts/clean-build.sh` 脚本，自动完成清理、构建与打包：

```bash
# 清理缓存 + 重新构建（不打包）
bash scripts/clean-build.sh

# 清理缓存 + 重新构建 + 打包为 tar.gz
bash scripts/clean-build.sh --tar
```

`--tar` 参数会生成 `ydxl-deploy-YYYYMMDD-HHMMSS.tar.gz`，仅包含部署所需文件：

* `dist/`（前端构建产物）

* `server/`（后端代码，含 `server/dist/` 编译产物）

* `package.json`、`package-lock.json`（依赖清单）

* `docs/`（运维文档）

不包含 `node_modules/`、`.git/`、`src/`、`tsconfig*`、`vite.config.*`、`.husky/`、`.trae/`、`.vscode/`、`coverage/`、`.vitest/`、`*.tsbuildinfo` 等开发环境文件。

#### 5.4.3 手动 rsync 同步示例

如不使用 tar 包，可直接通过 rsync 同步到服务器，排除干扰目录：

```bash
# 使用 rsync 同步到服务器，排除开发环境干扰目录
rsync -avz --exclude='node_modules' \
  --exclude='.git' \
  --exclude='src' \
  --exclude='tsconfig*' \
  --exclude='vite.config.*' \
  --exclude='.husky' \
  --exclude='.trae' \
  --exclude='.vscode' \
  --exclude='coverage' \
  --exclude='.vitest' \
  --exclude='*.tsbuildinfo' \
  --exclude='.gitignore' \
  ./ user@server:/opt/ydxl/
```

> ⚠️ 注意：rsync 同步前请确保本地已执行 `npm run build` 与 `npm run server:build`，否则 `dist/` 与 `server/dist/` 可能为旧产物。

#### 5.4.4 tar 包解压后目录结构与启动命令

`ydxl-deploy-<timestamp>.tar.gz` 解压后目录结构如下：

```
ydxl/
├── dist/              # 前端构建产物
├── server/            # 后端代码（含 server/dist/ 编译产物）
├── docs/              # 文档
├── package.json
└── package-lock.json
```

解压后执行步骤：

```bash
# 解压到 /opt/ydxl
sudo mkdir -p /opt/ydxl
sudo chown $USER:$USER /opt/ydxl
tar -xzf ydxl-deploy-YYYYMMDD-HHMMSS.tar.gz -C /opt/ydxl

# 进入部署目录
cd /opt/ydxl

# 安装前端生产依赖（仅 dependencies，不含 devDependencies）
npm ci --production

# 安装后端依赖
cd server && npm ci --production
cd ..

# 配置环境变量（参考第 4 章环境变量配置）
cp .env.example .env
nano .env

# 启动服务（PM2 方式，参考第 6 章）
pm2 start server/dist/index.js --name ydxl-server
pm2 save
pm2 startup
```

> 💡 提示：tar 包不含 `.env` 文件（含密钥，不应进入打包流程），需在生产服务器上手动创建或从安全位置复制。

#### 5.4.5 服务器端一键部署脚本

将 tar 包与 `scripts/deploy-production.sh` 一起上传到服务器（如 `/tmp`），执行：

```bash
bash deploy-production.sh ydxl-deploy-YYYYMMDD-HHMMSS.tar.gz
```

脚本自动完成：备份 SQLite 数据库到 `/opt/ydxl/backups/` → 解压覆盖代码（保留 `.env` 与 `server/data/`）→ 校验 `.env` 的 custom 代理配置（缺失时追加模板并提示填写）→ 自动识别 PM2/systemd 并重启 → 健康检查（重试 5 次）→ 验证 `/api/v1/ai-proxy/custom` 代理节点 → 输出回滚命令。custom 配置不完整时脚本以退出码 2 中止，填好 `CUSTOM_API_KEY` 后重跑即可。

***

## 6. 启动服务（PM2 方式）

PM2 是生产推荐的进程管理器，支持热重启、日志管理与开机自启。

### 6.1 安装 PM2

```bash
sudo npm install -g pm2
```

### 6.2 启动服务器

```bash
cd /opt/ydxl
pm2 start server/dist/index.js --name ydxl-server
```

### 6.3 验证启动

```bash
pm2 status
# 应显示 ydxl-server 状态为 online

pm2 logs ydxl-server --lines 20
# 应看到 [ydxl-server] listening on http://localhost:3001
```

### 6.4 健康检查

```bash
curl http://localhost:3001/api/health
# 应返回 {"status":"ok"}
```

### 6.5 PM2 持久化（开机自启）

```bash
pm2 save
pm2 startup
# 按提示执行返回的命令（如 sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER）
```

### 6.6 PM2 常用命令

```bash
pm2 status              # 查看所有进程状态
pm2 logs ydxl-server    # 实时查看日志
pm2 restart ydxl-server # 重启服务
pm2 stop ydxl-server    # 停止服务
pm2 delete ydxl-server  # 删除进程
```

***

## 7. 启动服务（systemd 方式）

systemd 是 Ubuntu / Debian 默认的 init 系统，无需额外安装。

### 7.1 创建 service 文件

创建 `/etc/systemd/system/ydxl.service`：

```bash
sudo tee /etc/systemd/system/ydxl.service > /dev/null <<'EOF'
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
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 7.2 调整文件权限

```bash
# 确保服务器能读取 .env 与 dist/
sudo chown -R www-data:www-data /opt/ydxl/server/data
sudo chmod 600 /opt/ydxl/.env
```

### 7.3 启用并启动

```bash
sudo systemctl daemon-reload
sudo systemctl enable ydxl
sudo systemctl start ydxl
```

### 7.4 验证状态

```bash
sudo systemctl status ydxl
# 应显示 active (running)

sudo journalctl -u ydxl -n 20 --no-pager
# 应看到 [ydxl-server] listening on http://localhost:3001
```

### 7.5 systemd 常用命令

```bash
sudo systemctl start ydxl      # 启动
sudo systemctl stop ydxl       # 停止
sudo systemctl restart ydxl   # 重启
sudo systemctl status ydxl     # 查看状态
sudo journalctl -u ydxl -f     # 实时查看日志
```

***

## 8. Nginx 反向代理配置

### 8.1 安装 Nginx

```bash
sudo apt install -y nginx
```

### 8.2 创建站点配置

创建 `/etc/nginx/sites-available/ydxl`：

```bash
sudo tee /etc/nginx/sites-available/ydxl > /dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态资源
    root /opt/ydxl/dist;
    index index.html;

    # Service Worker 不缓存（确保 PWA 版本更新及时生效）
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    # registerSW.js 也不缓存
    location = /registerSW.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    # 静态资源长缓存（hash 命名，安全）
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 代理到本地 Express 服务器
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # SPA 前端路由回退（React Router 刷新支持）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

### 8.3 启用站点

```bash
sudo ln -s /etc/nginx/sites-available/ydxl /etc/nginx/sites-enabled/

# 删除默认站点（避免冲突）
sudo rm -f /etc/nginx/sites-enabled/default

# 测试配置语法
sudo nginx -t
# 应显示：test is successful

# 重载配置
sudo systemctl reload nginx
```

### 8.4 验证访问

```bash
curl http://localhost/api/health
# 应返回 {"status":"ok"}

curl http://localhost/
# 应返回 index.html 内容
```

***

## 9. SSL 配置（Let's Encrypt）

### 9.1 安装 certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 9.2 获取证书

```bash
sudo certbot --nginx -d your-domain.com
```

按提示：

1. 输入邮箱（用于证书到期提醒）
2. 同意服务条款
3. 选择是否启用 HTTP 重定向到 HTTPS（推荐启用）

certbot 会自动修改 Nginx 配置，添加 443 端口监听与证书路径。

### 9.3 自动续期

Let's Encrypt 证书有效期 90 天，certbot 会自动安装续期定时任务：

```bash
# 验证续期任务
sudo systemctl list-timers | grep certbot

# 手动测试续期流程（不实际续期）
sudo certbot renew --dry-run
```

***

## 10. 防火墙配置

### 10.1 启用 UFW

```bash
sudo ufw allow 22       # SSH
sudo ufw allow 80       # HTTP
sudo ufw allow 443      # HTTPS
sudo ufw enable
```

### 10.2 验证规则

```bash
sudo ufw status verbose
```

> 注意：3001 端口（Express 服务器）不应公网开放，仅通过 Nginx 反代访问。如需在局域网内调试，可临时 `sudo ufw allow 3001`，调试完成后 `sudo ufw delete allow 3001`。

***

## 11. AI 供应商密钥配置

### 11.1 获取 API Key

按所选供应商获取（至少配置一个）：

| 供应商      | 获取地址                                                    | 密钥格式     |
| -------- | ------------------------------------------------------- | -------- |
| DeepSeek | <https://platform.deepseek.com/api_keys>                | `sk-` 开头 |
| OpenAI   | <https://platform.openai.com/api-keys>                  | `sk-` 开头 |
| 通义千问     | 阿里云百炼控制台 <https://bailian.console.aliyun.com/?apiKey=1> | 阿里云百炼格式  |

以 DeepSeek 为例：登录 → 「Create API Key」生成新密钥 → 复制（仅显示一次）。

### 11.2 配置到服务器 .env

```bash
sudo nano /opt/ydxl/.env
# 编辑所用供应商的密钥，如 DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 11.3 重启服务

```bash
# PM2
pm2 restart ydxl-server

# 或 systemd
sudo systemctl restart ydxl
```

### 11.4 测试 AI 调用

1. 访问应用 → 阅读页面
2. 触发文章生成（在难度选择弹窗中点击「开始阅读」）
3. 确认 AI 生成内容正常显示

或通过 curl 逐一测试已配置供应商的代理端点：

```bash
# DeepSeek
curl -X POST http://localhost:3001/api/v1/ai-proxy/deepseek \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"你好"}]}'

# OpenAI（需配置 OPENAI_API_KEY）
curl -X POST http://localhost:3001/api/v1/ai-proxy/openai \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5.2","messages":[{"role":"user","content":"Hello"}]}'

# 通义千问（需配置 QWEN_API_KEY）
curl -X POST http://localhost:3001/api/v1/ai-proxy/qwen \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3-max","messages":[{"role":"user","content":"你好"}]}'

# 自定义模型（需配置 CUSTOM_API_ENDPOINT + CUSTOM_API_KEY；model 填实际模型 ID）
curl -X POST http://localhost:3001/api/v1/ai-proxy/custom \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-ai/DeepSeek-V4-Flash","messages":[{"role":"user","content":"你好"}]}'
```

应返回包含 `choices[0].message.content` 的 JSON 响应。

> 返回 503 `PROXY_NOT_CONFIGURED` 表示该供应商密钥未配置；返回 503 `CUSTOM_NOT_CONFIGURED` 表示 `CUSTOM_API_ENDPOINT` 未配置；返回 400 表示模型名不在白名单。
> 免费额度类第三方（如 OpenRouter 免费模型 50 次/天）超限返回 429，前端会自动回退 DeepSeek 兜底。
> 完整错误码说明见 [DEPLOYMENT.md](./DEPLOYMENT.md) 第 9 章。

***

## 12. 部署验证

### 12.1 前端加载验证

```bash
curl -I https://your-domain.com/
# 应返回 HTTP/1.1 200 OK
```

浏览器访问 `https://your-domain.com`，确认：

* 首页正常渲染（Dashboard 显示）

* 底部导航可切换（首页 / 阅读 / 单词本 / 我的）

* 浏览器地址栏出现 PWA 安装图标

### 12.2 API 健康检查验证

```bash
curl https://your-domain.com/api/health
# 应返回 {"status":"ok"}
```

### 12.3 AI 调用验证

1. 进入阅读页面
2. 触发文章生成
3. 确认文章内容、题目、生词正常显示
4. 检查 PM2 / systemd 日志无错误

### 12.4 PWA 验证

1. 浏览器 DevTools → Application → Service Workers，确认 SW 已注册
2. DevTools → Application → Manifest，确认清单加载正常
3. 断网后刷新页面，确认应用仍可加载（precache 生效）

### 12.5 HTTPS 验证

```bash
curl -vI https://your-domain.com/
# 应显示 TLS 握手成功，证书签发机构为 Let's Encrypt
```

***

## 13. 日常维护命令

### 13.1 查看日志

#### PM2 方式

```bash
# 实时查看日志
pm2 logs ydxl-server

# 查看最近 100 行
pm2 logs ydxl-server --lines 100

# 查看错误日志
pm2 logs ydxl-server --err --lines 50
```

#### systemd 方式

```bash
# 实时查看日志
sudo journalctl -u ydxl -f

# 查看最近 100 行
sudo journalctl -u ydxl -n 100 --no-pager

# 查看今天的日志
sudo journalctl -u ydxl --since today --no-pager

# 查看错误日志
sudo journalctl -u ydxl -p err --no-pager
```

#### Nginx 日志

```bash
# 访问日志
sudo tail -f /var/log/nginx/access.log

# 错误日志
sudo tail -f /var/log/nginx/error.log
```

### 13.2 重启服务

```bash
# PM2
pm2 restart ydxl-server

# systemd
sudo systemctl restart ydxl

# Nginx
sudo systemctl reload nginx   # 重载配置（不中断连接）
sudo systemctl restart nginx   # 完全重启
```

### 13.3 更新代码

```bash
cd /opt/ydxl

# 拉取最新代码
git pull origin main

# 更新依赖（如 package.json 变更）
npm install
npm --prefix server install

# 重新构建
npm run build
npm run server:build

# 重启服务
pm2 restart ydxl-server
# 或
sudo systemctl restart ydxl
```

### 13.4 数据库备份

详见 [OPERATIONS.md](./OPERATIONS.md) 第 4 章。

```bash
# 手动备份
sqlite3 /opt/ydxl/server/data/ydxl.db .dump > /backup/ydxl_$(date +%Y%m%d).sql

# 查看数据库大小
ls -lh /opt/ydxl/server/data/ydxl.db
```

### 13.5 数据库恢复

```bash
# 停止服务（避免写入冲突）
pm2 stop ydxl-server

# 恢复
sqlite3 /opt/ydxl/server/data/ydxl.db < /backup/ydxl_20260711.sql

# 重启服务
pm2 start ydxl-server
```

***

## 附录：完整部署脚本（一键参考）

> ⚠️ 此脚本仅供参考，实际部署请按上述章节逐步执行以排查问题。

```bash
#!/bin/bash
set -e

# 1. 系统更新
sudo apt update && sudo apt upgrade -y

# 2. 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3 nginx

# 3. 获取代码
sudo mkdir -p /opt/ydxl
sudo chown $USER:$USER /opt/ydxl
git clone <repo-url> /opt/ydxl
cd /opt/ydxl

# 4. 安装依赖
npm install
npm --prefix server install

# 5. 配置环境变量（需手动填写 DEEPSEEK_API_KEY）
cp .env.example .env
nano .env

# 6. 构建
npm run build
npm run server:build

# 7. 安装 PM2
sudo npm install -g pm2

# 8. 启动服务
pm2 start server/dist/index.js --name ydxl-server
pm2 save
pm2 startup

# 9. 验证
curl http://localhost:3001/api/health

# 10. Nginx 配置（参考第 8 章）
# 11. SSL 配置（参考第 9 章）
# 12. 防火墙（参考第 10 章）
```

***

## 相关文档

* [DEPLOYMENT.md](./DEPLOYMENT.md)：部署指南（环境变量矩阵、构建产物说明）

* [OPERATIONS.md](./OPERATIONS.md)：运维手册（SQLite 备份、Express 监控）

* [API\_REFERENCE.md](./API_REFERENCE.md)：API 参考（Local Server REST API）

* [README](../README.md)：项目概述与快速开始

