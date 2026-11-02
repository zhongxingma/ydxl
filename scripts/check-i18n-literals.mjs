// 中文字面量检测（i18n 护栏）
//
// 目的：拦截新增的中文硬编码文案，避免 i18n 缺口继续扩大。
// 规则：
// - 扫描 src 下非测试 / 非测试基建的 .ts / .tsx 文件
// - 先剔除注释（行注释 / 块注释），再按行统计含中文（CJK 统一表意文字）的行
// - 与 scripts/i18n-baseline.json 的基线逐文件比较：新增文件或行数增加即失败
// - 行数下降不失败（推进 i18n 后可用 --update 刷新基线）
//
// 用法：
//   node scripts/check-i18n-literals.mjs            # 校验
//   node scripts/check-i18n-literals.mjs --update   # 更新基线
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC_DIR = path.join(ROOT, 'src')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'i18n-baseline.json')
const CJK = /[\u4e00-\u9fff]/

// 排除测试与测试基建（用例断言、mock 文案不属于界面文案）
function shouldSkip(relPath) {
  const p = relPath.replace(/\\/g, '/')
  return (
    p.includes('/__tests__/') ||
    p.startsWith('src/test/') ||
    /\.test\.(ts|tsx)$/.test(p) ||
    p.endsWith('.d.ts') ||
    p.startsWith('src/shared/i18n/locales/')
  )
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// 剔除注释（保留字符串内容），换行保留以便按行统计
function stripComments(source) {
  let out = ''
  let inBlock = false
  let inLine = false
  let quote = null
  let escaped = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i++
      } else if (ch === '\n') {
        out += ch
      }
      continue
    }
    if (quote) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    out += ch
  }
  return out
}

function countChineseLines(file) {
  const source = readFileSync(file, 'utf8')
  const stripped = stripComments(source)
  return stripped.split('\n').filter((line) => CJK.test(line)).length
}

function collect() {
  const counts = {}
  for (const file of walk(SRC_DIR)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    if (shouldSkip(rel)) continue
    const count = countChineseLines(file)
    if (count > 0) counts[rel] = count
  }
  return counts
}

function loadBaseline() {
  try {
    const raw = readFileSync(BASELINE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.files ?? {}
  } catch {
    console.error('[i18n:check] 未找到基线文件，请先运行：node scripts/check-i18n-literals.mjs --update')
    process.exit(2)
  }
}

function total(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

const current = collect()

if (process.argv.includes('--update')) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        note: '中文硬编码基线（按文件行数）；仅允许下降，新增或增加会被 i18n:check 拦截',
        files: current,
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  console.log(
    `[i18n:check] 基线已更新：${Object.keys(current).length} 个文件 / ${total(current)} 行含中文`
  )
  process.exit(0)
}

const baseline = loadBaseline()
const violations = []
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file] ?? 0
  if (count > allowed) violations.push({ file, allowed, count })
}

console.log(
  `[i18n:check] 基线 ${Object.keys(baseline).length} 个文件 / ${total(baseline)} 行；` +
    `当前 ${Object.keys(current).length} 个文件 / ${total(current)} 行`
)

if (violations.length > 0) {
  console.error(`[i18n:check] 发现 ${violations.length} 个文件新增中文硬编码：`)
  for (const { file, allowed, count } of violations) {
    console.error(`  - ${file}: ${allowed} → ${count} 行`)
  }
  console.error('[i18n:check] 请改用 useTranslation 的 t() 文案，或确属有意新增时刷新基线')
  process.exit(1)
}

console.log('[i18n:check] 通过：未新增中文硬编码文案')
