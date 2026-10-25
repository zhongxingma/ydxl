#!/usr/bin/env bash
# clean-build.sh - 清理构建缓存并重新构建，可选打包部署文件
#
# 用法：
#   bash scripts/clean-build.sh          # 仅清理 + 构建
#   bash scripts/clean-build.sh --tar    # 清理 + 构建 + 打包为 tar.gz
#
# 退出码：0 表示成功，非 0 表示失败
set -e

# 项目根目录（脚本所在目录的父目录）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# 解析参数：--tar 触发打包
PACK_TAR=false
for arg in "$@"; do
  case "$arg" in
    --tar)
      PACK_TAR=true
      ;;
    -h|--help)
      echo "用法: bash scripts/clean-build.sh [--tar]"
      echo "  --tar  打包部署文件为 ydxl-deploy-<timestamp>.tar.gz"
      exit 0
      ;;
    *)
      echo "未知参数: $arg"
      echo "用法: bash scripts/clean-build.sh [--tar]"
      exit 1
      ;;
  esac
done

echo "=== 开始清理 ==="

# 1. 清理 dist/ 目录（旧构建产物）
if [ -d "dist" ]; then
  echo "清理 dist/ ..."
  rm -rf dist
fi

# 2. 清理 TypeScript 增量构建缓存（.tsbuildinfo 文件）
if [ -d "node_modules/.tmp" ]; then
  echo "清理 node_modules/.tmp/*.tsbuildinfo ..."
  rm -f node_modules/.tmp/*.tsbuildinfo
fi

# 3. 清理测试覆盖率报告
if [ -d "coverage" ]; then
  echo "清理 coverage/ ..."
  rm -rf coverage
fi

# 4. 清理 vitest 缓存
if [ -d ".vitest" ]; then
  echo "清理 .vitest/ ..."
  rm -rf .vitest
fi

echo "=== 清理完成，开始构建 ==="

# 5. 重新构建（执行 tsc -b && vite build）
npm run build

echo "=== 构建完成 ==="

# 6. 可选：打包部署文件为 tar.gz
if [ "$PACK_TAR" = "true" ]; then
  # 打包前检查 dist/ 是否存在（构建失败的兜底校验）
  if [ ! -d "dist" ]; then
    echo "错误：dist/ 目录不存在，构建可能失败"
    exit 1
  fi

  # 时间戳格式：YYYYMMDD-HHMMSS
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  TARBALL="ydxl-deploy-$TIMESTAMP.tar.gz"

  echo "=== 开始打包 $TARBALL ==="

  # 打包部署所需文件：
  #   包含：dist/、server/、config/、package.json、package-lock.json、docs/
  #   排除：node_modules/、.git/、src/、tsconfig*、vite.config.*、
  #         .husky/_/、.vscode/、coverage/、.vitest/、
  #         *.tsbuildinfo、根目录 *.md（docs/ 下的保留）
  # 注：tar 使用显式文件清单，根目录 *.md 不会被包含；
  #     --exclude 作为防御性过滤，确保 server/ 内的 node_modules 等也被排除
  tar -czf "$TARBALL" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='src' \
    --exclude='tsconfig*' \
    --exclude='vite.config.*' \
    --exclude='.husky' \
    --exclude='.vscode' \
    --exclude='coverage' \
    --exclude='.vitest' \
    --exclude='*.tsbuildinfo' \
    --exclude='.gitignore' \
    dist/ server/ config/ package.json package-lock.json docs/

  # 输出 tar 包大小与路径
  SIZE=$(du -h "$TARBALL" | cut -f1)
  echo "=== 打包完成 ==="
  echo "文件：$TARBALL"
  echo "大小：$SIZE"
  echo "路径：$PROJECT_ROOT/$TARBALL"
fi

exit 0
