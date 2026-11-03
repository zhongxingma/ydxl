// 包体积预算护栏（性能防回退）
//
// 目的：拦截意外的包膨胀回退（如大依赖误打进主 chunk、按需加载失效、sourcemap
// 意外混入产物）。读取 npm run build 产出的 dist/，比较两项预算：
// - dist 总体积（不含 *.map）≤ 总预算 2.5MB
// - dist/assets 最大 chunk（不含 *.map）≤ 单 chunk 预算 500KB
// 任一超出即退出码 1，用于 CI / 提交前拦截。本脚本只读产物、不做性能计时，
// 结果完全由构建产物决定，可确定性复现、不 flaky。
//
// 预算取值依据（实测：dist 总 ≈1.93MB、最大 chunk recharts ≈398KB）：
// 各留约 25% 余量，既拦截明显膨胀，也允许正常功能增量；预算需上调时请在此注释
// 记录实测基线与调整原因。
//
// 用法：node scripts/check-bundle-size.mjs   （需先 npm run build）
import { readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')
const ASSETS_DIR = path.join(DIST_DIR, 'assets')

// 预算阈值（字节）
const MAX_TOTAL_BYTES = 2.5 * 1024 * 1024 // dist 总体积 2.5MB
const MAX_CHUNK_BYTES = 500 * 1024 // 单 chunk 500KB

// 递归收集 dist 下所有文件（sourcemap 不计入体积预算）
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (!entry.name.endsWith('.map')) {
      out.push(full)
    }
  }
  return out
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`
}

function relPosix(file) {
  return path.relative(DIST_DIR, file).replace(/\\/g, '/')
}

if (!existsSync(DIST_DIR)) {
  console.error('[bundle-size] dist/ 不存在，请先运行 npm run build 再执行本校验')
  process.exit(1)
}

const allFiles = walk(DIST_DIR)
if (allFiles.length === 0) {
  console.error('[bundle-size] dist/ 为空，请先运行 npm run build 再执行本校验')
  process.exit(1)
}

const totalBytes = allFiles.reduce((sum, file) => sum + statSync(file).size, 0)
const assetFiles = allFiles.filter((file) => file.startsWith(ASSETS_DIR + path.sep))
const maxChunk = assetFiles.reduce(
  (max, file) => (statSync(file).size > statSync(max).size ? file : max),
  assetFiles[0],
)
const maxChunkBytes = statSync(maxChunk).size

// 概览：最大的 5 个产物，便于定位膨胀来源
const topFiles = [...allFiles]
  .sort((a, b) => statSync(b).size - statSync(a).size)
  .slice(0, 5)
console.log('[bundle-size] 最大的产物：')
for (const file of topFiles) {
  console.log(`  ${formatKB(statSync(file).size).padStart(10)}  ${relPosix(file)}`)
}

let failed = false

const totalOk = totalBytes <= MAX_TOTAL_BYTES
console.log(
  `[bundle-size] dist 总体积：${formatKB(totalBytes)} / 预算 ${formatKB(MAX_TOTAL_BYTES)} ${totalOk ? 'OK' : '超出预算'}`,
)
if (!totalOk) failed = true

const chunkOk = maxChunkBytes <= MAX_CHUNK_BYTES
console.log(
  `[bundle-size] 最大 chunk：${relPosix(maxChunk)} ${formatKB(maxChunkBytes)} / 预算 ${formatKB(MAX_CHUNK_BYTES)} ${chunkOk ? 'OK' : '超出预算'}`,
)
if (!chunkOk) failed = true

if (failed) {
  console.error('[bundle-size] 包体积超出预算：请检查是否误引入大依赖或按需加载失效（recharts 等大依赖应保持独立 chunk）')
  process.exit(1)
}
console.log('[bundle-size] 包体积预算校验通过')
