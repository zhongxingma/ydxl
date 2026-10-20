#!/usr/bin/env bash
# deploy-production.sh - ydxl 生产环境一键部署脚本（在 Linux 服务器上运行）
#
# 用法：
#   bash deploy-production.sh ydxl-deploy-<timestamp>.tar.gz
#
# 前置条件：
#   1. tar 包与本脚本已上传到服务器同一目录（如 /tmp）
#   2. 首次部署需已按 docs/LINUX_DEPLOY.md 完成环境准备（Node/PM2/Nginx）
#   3. .env 位于 /opt/ydxl/.env（已有部署则保留原文件）
#
# 脚本步骤：
#   备份 SQLite 数据库 → 解压覆盖代码（保留 .env 与 server/data）→
#   检查 .env 的 custom 代理配置 → 重启服务（PM2/systemd 自动识别）→
#   健康检查 + custom AI 代理节点验证 → 输出结果与回滚命令
set -euo pipefail

# ---------- 可按实际环境调整的变量 ----------
DEPLOY_DIR="/opt/ydxl"          # 部署根目录
BACKUP_DIR="/opt/ydxl/backups"  # 数据库备份目录
TARBALL="${1:-}"

# ---------- 参数校验 ----------
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  echo "用法: bash deploy-production.sh ydxl-deploy-<timestamp>.tar.gz"
  echo "错误：未找到部署包 $TARBALL"
  exit 1
fi

echo "=== 1/6 备份数据库 ==="
mkdir -p "$BACKUP_DIR"
if [ -f "$DEPLOY_DIR/server/data/ydxl.db" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  cp "$DEPLOY_DIR/server/data/ydxl.db" "$BACKUP_DIR/ydxl.db.$STAMP"
  echo "已备份: $BACKUP_DIR/ydxl.db.$STAMP"
else
  echo "未发现现有数据库（首次部署），跳过备份"
fi

echo "=== 2/6 解压部署包（保留 .env 与 server/data）==="
mkdir -p "$DEPLOY_DIR"
tar -xzf "$TARBALL" -C "$DEPLOY_DIR" --strip-components=1
echo "已解压到 $DEPLOY_DIR"
ls "$DEPLOY_DIR/dist/index.html" "$DEPLOY_DIR/server/dist/index.js" >/dev/null
echo "构建产物校验通过"

echo "=== 3/6 检查 .env 的 custom 代理配置 ==="
ENV_FILE="$DEPLOY_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "警告：$ENV_FILE 不存在，追加配置模板（请手动填入密钥后重新运行本脚本）"
  cat >> "$ENV_FILE" <<'EOF'

# ===== custom AI 代理密钥（部署脚本生成，请填写后重启服务） =====
# 端点与模型 ID 由 config/ai-providers.json 声明（已随部署包解压到 config/ 目录）
CUSTOM_API_KEY=
EOF
  echo "已追加模板到 $ENV_FILE，请编辑填入 CUSTOM_API_KEY 后重启服务"
  exit 2
fi

# 校验 config/ai-providers.json（端点/模型单一来源）与 CUSTOM_API_KEY（服务端密钥）
CONFIG_JSON="$DEPLOY_DIR/config/ai-providers.json"
if [ ! -f "$CONFIG_JSON" ]; then
  echo "错误：缺少 $CONFIG_JSON（自定义模型端点/模型单一来源），请确认部署包包含 config/ 目录"
  exit 2
fi
MISSING=0
val=$(grep -E "^CUSTOM_API_KEY=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '[:space:]')
if [ -z "$val" ]; then
  echo "缺少配置: CUSTOM_API_KEY（请在 $ENV_FILE 填写）"
  MISSING=1
fi
if [ "$MISSING" = "1" ]; then
  echo "错误：custom 代理密钥不完整，服务端将返回 503 并回退 DeepSeek 兜底"
  echo "请编辑 $ENV_FILE 补齐 CUSTOM_API_KEY 后重启服务"
  exit 2
fi
echo "custom 代理配置已就绪（端点/模型来自 $CONFIG_JSON）"

echo "=== 4/6 重启服务 ==="
if command -v pm2 >/dev/null 2>&1 && pm2 describe ydxl-server >/dev/null 2>&1; then
  pm2 restart ydxl-server
  echo "PM2 已重启 ydxl-server"
elif systemctl is-active --quiet ydxl 2>/dev/null; then
  sudo systemctl restart ydxl
  echo "systemd 已重启 ydxl"
else
  echo "警告：未识别到 PM2/systemd 管理的服务，请手动重启"
  echo "  pm2 restart ydxl-server  或  sudo systemctl restart ydxl"
fi

echo "=== 5/6 健康检查 ==="
sleep 3
for i in 1 2 3 4 5; do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "健康检查通过: /api/health -> ok"
    break
  fi
  [ "$i" = "5" ] && { echo "错误：健康检查失败，请查看服务日志"; exit 3; }
  echo "等待服务启动（$i/5）..."; sleep 3
done

echo "=== 6/6 验证 custom AI 代理节点 ==="
MODEL=$(grep -o '"model"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_JSON" | head -1 | cut -d'"' -f4)
MODEL="${MODEL:-deepseek-ai/DeepSeek-V4-Flash}"
RESP=$(curl -sS -w '\n%{http_code}' -X POST http://localhost:3001/api/v1/ai-proxy/custom \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"max_tokens\":20}" 2>&1 || true)
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
case "$HTTP_CODE" in
  200) echo "custom 代理节点正常（HTTP 200，模型 $MODEL）";;
  429) echo "custom 上游返回 429（免费额度用尽，正常现象：前端会自动回退 DeepSeek）";;
  503) echo "custom 代理返回 503：$BODY"; echo "请检查 config/ai-providers.json 端点与 .env 的 CUSTOM_API_KEY";;
  *)   echo "custom 代理返回 HTTP $HTTP_CODE：$BODY";;
esac

echo ""
echo "=== 部署完成 ==="
echo "回滚命令（如需）:"
echo "  cp $BACKUP_DIR/ydxl.db.<时间戳> $DEPLOY_DIR/server/data/ydxl.db && 重启服务"
echo "前端验证：浏览器访问站点 → 阅读页生成文章 → 查看模块旁 AI 来源徽章"
