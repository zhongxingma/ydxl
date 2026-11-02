#!/usr/bin/env node
/**
 * 蓝绿发布脚本
 *
 * 目标：零停机切换代码版本，并把「切流门禁」固化为就绪探针 /api/health/ready。
 *
 * 流程：
 *   1. 读取 deploy/active-upstream.conf 判断当前激活槽位（blue / green）；
 *   2. 启动另一槽位（镜像标签由 --image 指定，不覆盖旧容器）；
 *   3. 轮询新槽位的 /api/health/ready，数据库可用才视为就绪（默认最长 120s）；
 *   4. 改写 active-upstream.conf 并在 web 容器内 nginx -s reload，完成切流；
 *   5. 停止旧槽位（容器保留，便于快速回滚：再执行一次本脚本即可切回）。
 *
 * 失败处理：新槽位未就绪或切流失败时，删除新容器并保持 upstream 不变，
 *           线上继续由旧槽位提供服务（无流量中断）。
 *
 * 用法：
 *   node scripts/blue-green-deploy.mjs --image ydxl-app:2026-11-01-abc1234
 *   node scripts/blue-green-deploy.mjs --image ydxl-app:latest --timeout 180
 *   node scripts/blue-green-deploy.mjs --image ydxl-app:latest --dry-run
 *
 * 前置条件：Docker + Docker Compose v2 可用；.env 已就位（含 ENCRYPTION_KEY / CORS_ORIGIN 等生产变量）；
 *           web 容器已启动（脚本会在需要时执行 docker compose up -d web）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UPSTREAM_FILE = join(ROOT, 'deploy', 'active-upstream.conf')
const COLORS = ['blue', 'green']
const DEFAULT_IMAGE = 'ydxl-app:latest'
const DEFAULT_TIMEOUT_SECONDS = 120
const POLL_INTERVAL_MS = 3000

/**
 * 解析命令行参数
 * @param {string[]} argv 原始参数（不含 node 与脚本路径）
 * @returns {{ image: string, timeoutSeconds: number, dryRun: boolean }}
 */
function parseArgs(argv) {
  const options = { image: DEFAULT_IMAGE, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--image') options.image = argv[++i] ?? options.image
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++i] ?? options.timeoutSeconds)
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/blue-green-deploy.mjs [--image <tag>] [--timeout <秒>] [--dry-run]')
      process.exit(0)
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    throw new Error(`--timeout 必须为正数，收到 ${options.timeoutSeconds}`)
  }
  return options
}

/**
 * 读取当前激活槽位（依据 upstream 文件内容，读不到时返回 null）
 * @returns {'blue' | 'green' | null}
 */
function readActiveColor() {
  if (!existsSync(UPSTREAM_FILE)) return null
  const matched = readFileSync(UPSTREAM_FILE, 'utf8').match(/server\s+app-(blue|green):3001/)
  return matched ? matched[1] : null
}

/**
 * 生成 upstream 文件内容
 * @param {'blue' | 'green'} color 目标槽位
 */
function renderUpstream(color) {
  return [
    '# 激活槽位（蓝绿发布切流开关）',
    '#',
    '# 由 scripts/blue-green-deploy.mjs 自动改写，请勿手工编辑；',
    '# 手工切换后需在 web 容器内执行 `nginx -s reload` 才生效。',
    '# 文件名固定为 active-upstream.conf（compose 挂载到 /etc/nginx/conf.d/00-upstream.conf）。',
    '',
    'upstream ydxl_app {',
    `    server app-${color}:3001;`,
    '}',
    '',
  ].join('\n')
}

/**
 * 原子性受限：compose 以 bind mount 方式挂载单个文件，替换 inode 会导致容器内仍读到旧内容，
 * 因此这里必须原地覆盖写入（truncate + write），不能用 rename。
 * @param {'blue' | 'green'} color 目标槽位
 */
function writeActiveColor(color) {
  writeFileSync(UPSTREAM_FILE, renderUpstream(color), 'utf8')
}

/**
 * 执行 docker compose 命令
 * @param {string[]} args compose 子命令与参数
 * @param {Record<string, string>} [extraEnv] 追加环境变量（用于指定槽位镜像标签）
 * @param {{ inherit?: boolean, dryRun?: boolean }} [options]
 * @returns {{ status: number, stdout: string }}
 */
function compose(args, extraEnv = {}, options = {}) {
  const command = ['compose', ...args]
  if (options.dryRun) {
    console.log(`[dry-run] docker ${command.join(' ')}`)
    return { status: 0, stdout: '' }
  }
  if (options.inherit === false) {
    const result = spawnSync('docker', command, {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    })
    return { status: result.status ?? 1, stdout: result.stdout ?? '' }
  }
  execFileSync('docker', command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  return { status: 0, stdout: '' }
}

/**
 * 就绪探针：在目标容器内请求 /api/health/ready（200 视为就绪）
 * @param {'blue' | 'green'} color 目标槽位
 * @returns {boolean} 是否就绪
 */
function probeReadiness(color) {
  const script =
    "fetch('http://127.0.0.1:3001/api/health/ready')" +
    '.then((r) => process.exit(r.ok ? 0 : 1))' +
    '.catch(() => process.exit(1))'
  const result = compose(
    ['--profile', color, 'exec', '-T', `app-${color}`, 'node', '-e', script],
    {},
    { inherit: false },
  )
  return result.status === 0
}

/**
 * 等待目标槽位就绪
 * @param {'blue' | 'green'} color 目标槽位
 * @param {number} timeoutSeconds 最长等待秒数
 * @returns {Promise<boolean>} 是否在超时前就绪
 */
async function waitUntilReady(color, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    if (probeReadiness(color)) return true
    console.log(`等待 app-${color} 就绪（/api/health/ready 未返回 200）...`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return false
}

/**
 * 停掉失败的新槽位容器（不影响线上流量）
 * @param {'blue' | 'green'} color 目标槽位
 */
function cleanupFailedSlot(color) {
  compose(['--profile', color, 'stop', `app-${color}`], {}, { inherit: false })
  compose(['--profile', color, 'rm', '-f', `app-${color}`], {}, { inherit: false })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const active = readActiveColor()
  const target = active === 'blue' ? 'green' : 'blue'

  console.log(`[blue-green] 当前槽位：${active ?? '未检测到（将首次启用 blue）'}；目标槽位：${target}`)
  console.log(`[blue-green] 镜像：${options.image}`)

  if (!existsSync(join(ROOT, '.env')) && !options.dryRun) {
    throw new Error('缺少 .env：容器需要生产环境变量（ENCRYPTION_KEY / CORS_ORIGIN 等），请先配置')
  }

  // 1. 确保入口容器在线（web 无 profile，直接启动）
  compose(['up', '-d', 'web'], {}, { dryRun: options.dryRun })

  // 2. 启动目标槽位（不触碰旧槽位，--no-deps 避免联动重建 web）
  const imageEnvKey = `YDXL_APP_IMAGE_${target.toUpperCase()}`
  try {
    compose(
      ['--profile', target, 'up', '-d', '--no-deps', `app-${target}`],
      { [imageEnvKey]: options.image },
      { dryRun: options.dryRun },
    )
  } catch (err) {
    console.error(`[blue-green] 启动 app-${target} 失败，保持现有槽位不变`, err)
    cleanupFailedSlot(target)
    process.exit(1)
  }

  if (options.dryRun) {
    console.log('[dry-run] 跳过就绪轮询与切流，仅打印计划动作')
    return
  }

  // 3. 就绪门禁：数据库可用才允许切流
  if (!(await waitUntilReady(target, options.timeoutSeconds))) {
    console.error(`[blue-green] app-${target} 在 ${options.timeoutSeconds}s 内未就绪，放弃切流`)
    cleanupFailedSlot(target)
    process.exit(1)
  }
  console.log(`[blue-green] app-${target} 就绪检查通过`)

  // 4. 切流：改写 upstream 并在 web 容器内 reload
  const previous = active
  writeActiveColor(target)
  try {
    compose(['exec', '-T', 'web', 'nginx', '-s', 'reload'], {}, { inherit: false })
  } catch (err) {
    console.error('[blue-green] nginx reload 失败，恢复原 upstream 并清理新槽位', err)
    if (previous) writeActiveColor(previous)
    compose(['exec', '-T', 'web', 'nginx', '-s', 'reload'], {}, { inherit: false })
    cleanupFailedSlot(target)
    process.exit(1)
  }
  console.log(`[blue-green] 已切流到 app-${target}（nginx reload 完成）`)

  // 5. 停止旧槽位（容器保留，回滚只需再执行一次本脚本）
  if (previous && previous !== target) {
    compose(['--profile', previous, 'stop', `app-${previous}`], {}, { inherit: false })
    console.log(`[blue-green] 已停止旧槽位 app-${previous}
[blue-green] 回滚方式：node scripts/blue-green-deploy.mjs --image <旧镜像标签>`)
  }
}

main().catch((err) => {
  console.error('[blue-green] 发布失败：', err instanceof Error ? err.message : err)
  process.exit(1)
})
