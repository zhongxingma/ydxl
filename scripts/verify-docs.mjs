#!/usr/bin/env node
/**
 * 文档数值一致性校验（CI 门禁）
 *
 * 目的：防止文档中声明的可量化数值（测试文件数、数据库表数）与代码实际值漂移。
 * 背景：历史审计发现 README / docs/README / docs/TESTING 三处声明的测试规模
 *       与实测相差数倍（58/70/109 vs 194），人工同步易遗漏，故固化为自动校验。
 *
 * 校验范围：
 * - 前端测试文件数（src/**\/*.test.ts|tsx）
 * - 后端测试文件数（server/src/**\/*.test.ts）
 * - 测试文件总数（前端 + 后端）
 * - SQLite 表数量（解析 server/src/db.ts 的 CREATE TABLE 语句去重）
 * - Dexie 表数量（解析 src/shared/services/db.ts 的 `xxx!: Table<` 声明）
 *
 * 行为约定：
 * - 数值不一致 → 输出差异并以非零码退出（阻断 CI）
 * - 文档中匹配不到锚点（文档结构被改写）→ 同样失败，提示更新本脚本规则，
 *   避免正则失效后静默跳过校验
 *
 * 用法：node scripts/verify-docs.mjs（或 npm run docs:verify）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 递归收集目录下的文件（跳过 node_modules / dist / coverage）
 * @param {string} dir 起始目录
 * @returns {string[]} 文件绝对路径数组
 */
function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (st.isFile()) out.push(full)
  }
  return out
}

/**
 * 读取文件内容
 * @param {string} relPath 相对项目根的路径
 * @returns {string}
 */
function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

/**
 * 提取正则第一个捕获组的全部匹配并去重
 * @param {string} text 文本
 * @param {RegExp} re 全局正则
 * @returns {number} 去重后的匹配数
 */
function uniqueCount(text, re) {
  const set = new Set()
  for (const m of text.matchAll(re)) set.add(m[1])
  return set.size
}

// ---------- 实际值（唯一事实来源：代码） ----------
const actual = {
  frontendTests: walk(join(ROOT, 'src')).filter((f) => /\.test\.(ts|tsx)$/.test(f)).length,
  backendTests: walk(join(ROOT, 'server/src')).filter((f) => /\.test\.ts$/.test(f)).length,
  e2eSpecs: walk(join(ROOT, 'e2e')).filter((f) => /\.spec\.ts$/.test(f)).length,
  sqliteTables: uniqueCount(read('server/src/db.ts'), /CREATE TABLE IF NOT EXISTS\s+(\w+)/g),
  dexieTables: uniqueCount(read('src/shared/services/db.ts'), /(\w+)\!:\s*Table</g),
}
actual.totalTests = actual.frontendTests + actual.backendTests

const METRIC_LABEL = {
  frontendTests: '前端测试文件数',
  backendTests: '后端测试文件数',
  totalTests: '测试文件总数',
  e2eSpecs: 'E2E spec 数',
  sqliteTables: 'SQLite 表数',
  dexieTables: 'Dexie 表数',
}

// ---------- 校验规则：文档锚点 → 期望的实际值字段（顺序与正则捕获组一致） ----------
const checks = [
  {
    file: 'README.md',
    pattern: /共 (\d+) 个测试文件/,
    expect: ['totalTests'],
    label: 'README「测试框架」行',
  },
  {
    file: 'README.md',
    pattern: /前端\*\*：(\d+) 个测试文件/,
    expect: ['frontendTests'],
    label: 'README「当前测试规模」前端',
  },
  {
    file: 'README.md',
    pattern: /后端\*\*：(\d+) 个测试文件/,
    expect: ['backendTests'],
    label: 'README「当前测试规模」后端',
  },
  {
    file: 'docs/README.md',
    pattern: /前端 (\d+) 文件 \/ 后端 (\d+) 文件/,
    expect: ['frontendTests', 'backendTests'],
    label: 'docs/README 测试索引',
  },
  {
    file: 'docs/README.md',
    pattern: /SQLite (\d+) 张表 \+ Dexie (\d+) 张表/,
    expect: ['sqliteTables', 'dexieTables'],
    label: 'docs/README 数据库索引',
  },
  {
    file: 'docs/TESTING.md',
    pattern: /共 \*\*(\d+)\*\* 个测试文件（前端 \*\*(\d+)\*\* 个 \+ 后端 \*\*(\d+)\*\* 个）/,
    expect: ['totalTests', 'frontendTests', 'backendTests'],
    label: 'docs/TESTING 测试覆盖总述',
  },
  {
    file: 'docs/TESTING.md',
    pattern: /### 7\.2 后端测试（server\/src\/__tests__\/，(\d+) 个文件/,
    expect: ['backendTests'],
    label: 'docs/TESTING 后端测试标题',
  },
  {
    file: 'docs/ER_DIAGRAM.md',
    pattern: /服务器 SQLite (\d+) 张表/,
    expect: ['sqliteTables'],
    label: 'docs/ER_DIAGRAM 导语',
  },
]

// ---------- 执行校验 ----------
let failed = 0
let passed = 0
const failures = []

for (const check of checks) {
  const text = read(check.file)
  const m = check.pattern.exec(text)
  if (!m) {
    failed++
    failures.push(`${check.file} [${check.label}]：未匹配到数值锚点，文档结构可能已变更，请同步更新 scripts/verify-docs.mjs`)
    continue
  }
  const declared = m.slice(1)
  const expected = check.expect.map((key) => actual[key])
  const mismatch = declared.findIndex((got, i) => String(got) !== String(expected[i]))
  if (mismatch !== -1) {
    const key = check.expect[mismatch]
    failed++
    failures.push(
      `${check.file} [${check.label}]：声明 ${declared[mismatch]}，实际 ${expected[mismatch]}（${METRIC_LABEL[key]}），请修正文档`,
    )
    continue
  }
  passed++
}

// ---------- 输出结果 ----------
const summary = `前端测试 ${actual.frontendTests} / 后端测试 ${actual.backendTests} / 合计 ${actual.totalTests}` +
  ` ｜ E2E ${actual.e2eSpecs} ｜ SQLite ${actual.sqliteTables} 表 ｜ Dexie ${actual.dexieTables} 表`
console.log(`\n[docs:verify] 实际值：${summary}`)

if (failures.length > 0) {
  console.error(`\n[docs:verify] 失败 ${failed} 项：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}

console.log(`[docs:verify] 通过 ${passed}/${checks.length} 项，文档数值与代码一致\n`)
