# ydxl 容器镜像（多阶段构建）
#
# 两个最终目标：
#   app —— Express API 运行时（端口 3001，仅内部网络暴露，由 web 反代）
#   web —— Nginx + 前端静态产物（对外端口 80，/api 反代到当前蓝绿槽位）
#
# 构建：
#   docker build -t ydxl-app:latest --target app .
#   docker build -t ydxl-web:latest --target web .
# 或直接 docker compose --profile blue up -d --build
#
# 说明：前端构建所需变量（VITE_*）来自 config/ai-providers.json（构建时读取）与默认值，
# 不需要 .env；真实 AI 密钥只在运行时通过环境变量注入服务端，绝不进入前端 bundle。

# ---------- 构建阶段：前端产物 + 服务端产物 + 服务端生产依赖 ----------
FROM node:20-bookworm-slim AS build

# better-sqlite3 在无匹配预编译包时回退源码编译，需要 python3 / make / g++
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖安装分层缓存：lockfile 未变时复用缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci

COPY . .

# 前端构建（tsc -b 类型检查 + vite build → dist/，含 PWA 产物）
RUN npm run build
# 服务端构建（tsc → server/dist/）
RUN npm run server:build
# 运行时只保留生产依赖（剔除 vitest / tsx / supertest 等 dev 依赖）
RUN npm --prefix server prune --omit=dev

# ---------- 运行镜像：Express API ----------
FROM node:20-bookworm-slim AS app

# 构建期注入版本号（如 git commit），健康检查负载立即可见当前运行版本
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/ydxl.db \
    APP_VERSION=${APP_VERSION}

WORKDIR /app

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
# AI 供应商端点/模型单一配置源（服务端启动时读取）
COPY --from=build /app/config ./config

# 数据目录（SQLite 数据库挂载点）；非 root 运行
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3001

# 就绪探针：数据库可用时返回 200；不使用 curl（镜像未安装）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]

# ---------- 运行镜像：Nginx 静态前端 + API 反向代理 ----------
FROM nginx:1.27-alpine AS web

# /api 反代到 upstream ydxl_app；该 upstream 由 deploy/active-upstream.conf 定义
# （compose 挂载到 /etc/nginx/conf.d/00-upstream.conf，蓝绿发布脚本改写后 nginx -s reload）
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
