// 性能压测脚本：30 并发压测服务端
//
// 运行（服务需先启动，见下方前置条件）：
//   # 方式一：直连 token（推荐，从登录接口或浏览器获取）
//   npx tsx src/loadtest.ts --url http://localhost:3001 --token <x-user-token>
//   # 方式二：用户名密码登录（首次管理员密码见服务端启动日志）
//   npx tsx src/loadtest.ts --url http://localhost:3001 --username admin --password <initial-pw>
//   # 覆盖并发数 / 总请求数 / 压测路径
//   npx tsx src/loadtest.ts --concurrency 30 --total 300 --path /api/articles?limit=20
//
// 说明：
// - 纯 Node fetch，零第三方依赖；统计 RPS、延迟分位（p50/p90/p99/min/max/avg）、状态码分布
// - 全局限流为 60/min/IP（见 index.ts），单进程压测超过该阈值后部分请求会收到 429，
//   属限流保护生效的预期表现；脚本如实统计 2xx 与 429 的延迟与占比
// - 压测为只读 GET（默认 articles 列表），不写入业务数据
// - 生产环境请勿对承载真实数据的实例长时间高压，建议指向隔离的测试库
import { logger } from './logger.js'
import process from 'node:process'

interface Args {
  url: string
  token?: string
  username?: string
  password?: string
  concurrency: number
  total: number
  path: string
}

/** 解析命令行参数（--key value），缺省值合理，最小化手动配置 */
function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1] ?? ''
      i++
    }
  }
  const url = out.url ?? 'http://localhost:3001'
  const base = url.endsWith('/') ? url.slice(0, -1) : url
  return {
    url: base,
    token: out.token,
    username: out.username,
    password: out.password,
    concurrency: Math.max(1, Math.min(200, Number(out.concurrency) || 30)),
    total: Math.max(1, Number(out.total) || 300),
    path: out.path ?? '/api/articles?limit=20',
  }
}

interface ReqStat {
  status: number
  latencyMs: number
  ok: boolean
}

/** 延迟分位数（输入需已升序），用线性插值近似 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]!
  const frac = idx - lo
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** 用给定 token 发起单次压测请求，返回状态与延迟 */
async function oneRequest(
  base: string,
  path: string,
  token: string | undefined,
): Promise<ReqStat> {
  const headers: Record<string, string> = {}
  if (token) headers['x-user-token'] = token
  const t0 = performance.now()
  let status = 0
  try {
    const res = await fetch(base + path, { headers })
    status = res.status
    // 消费响应体，避免连接挂起（keep-alive 池复用）
    await res.arrayBuffer()
  } catch {
    status = 0 // 网络错误
  }
  const latencyMs = performance.now() - t0
  return { status, latencyMs, ok: status >= 200 && status < 300 }
}

/** 通过用户名密码登录获取 token（失败抛错） */
async function login(base: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    token?: string
    error?: { message?: string }
  }
  if (!res.ok || !body.token) {
    throw new Error(`登录失败（${res.status}）：${body.error?.message ?? '未知错误'}`)
  }
  return body.token
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // 认证：优先 --token，否则 --username/--password 登录
  let token = args.token
  if (!token) {
    if (!args.username || !args.password) {
      logger.error('缺少认证：请提供 --token，或同时提供 --username 与 --password')
      process.exit(1)
    }
    logger.info(`[loadtest] 登录 ${args.username} ...`)
    token = await login(args.url, args.username, args.password)
    logger.info('[loadtest] 登录成功')
  }

  logger.info(
    `[loadtest] 目标 ${args.url}${args.path} | 并发 ${args.concurrency} | 总请求 ${args.total}`,
  )

  const stats: ReqStat[] = new Array(args.total)
  let next = 0

  // 固定并发 worker 池：每个 worker 循环领取请求直到发满 total
  const workers = Array.from({ length: args.concurrency }, async () => {
    for (;;) {
      const i = next++
      if (i >= args.total) return
      stats[i] = await oneRequest(args.url, args.path, token)
    }
  })

  const wallStart = performance.now()
  await Promise.all(workers)
  const wallMs = performance.now() - wallStart

  // 汇总
  const latenciesAll = stats.map((s) => s.latencyMs).sort((a, b) => a - b)
  const okStats = stats.filter((s) => s.ok)
  const okLat = okStats.map((s) => s.latencyMs).sort((a, b) => a - b)
  const statusCount = new Map<number, number>()
  for (const s of stats) {
    statusCount.set(s.status, (statusCount.get(s.status) ?? 0) + 1)
  }

  const rps = (args.total / (wallMs / 1000)).toFixed(1)
  const okRate = ((okStats.length / args.total) * 100).toFixed(1)

  logger.info('\n===== 压测结果 =====')
  logger.info(`总耗时       : ${wallMs.toFixed(0)} ms`)
  logger.info(`吞吐 (RPS)   : ${rps}`)
  logger.info(`成功率       : ${okRate}% (${okStats.length}/${args.total})`)
  logger.info('状态码分布   : ' + [...statusCount.entries()].map(([c, n]) => `${c}×${n}`).join('  '))
  logger.info('\n-- 全部请求延迟 (ms) --')
  logger.info(
    `min ${fmtNum(latenciesAll[0]!)} | avg ${fmtNum(
      latenciesAll.reduce((a, b) => a + b, 0) / latenciesAll.length,
    )} | p50 ${fmtNum(percentile(latenciesAll, 0.5))} | p90 ${fmtNum(
      percentile(latenciesAll, 0.9),
    )} | p99 ${fmtNum(percentile(latenciesAll, 0.99))} | max ${fmtNum(latenciesAll[latenciesAll.length - 1]!)}`,
  )
  if (okLat.length > 0) {
    logger.info('\n-- 成功(2xx)请求延迟 (ms) --')
    logger.info(
      `min ${fmtNum(okLat[0]!)} | avg ${fmtNum(
        okLat.reduce((a, b) => a + b, 0) / okLat.length,
      )} | p50 ${fmtNum(percentile(okLat, 0.5))} | p90 ${fmtNum(
        percentile(okLat, 0.9),
      )} | p99 ${fmtNum(percentile(okLat, 0.99))} | max ${fmtNum(okLat[okLat.length - 1]!)}`,
    )
  }

  // 网络错误（status=0）提示
  const netErr = statusCount.get(0) ?? 0
  if (netErr > 0) {
    logger.info(`\n[loadtest] 警告：${netErr} 次网络错误（连接失败/超时），请检查服务是否存活`)
  }
}

main().catch((err) => {
  logger.error('[loadtest] 执行失败：', err)
  process.exit(1)
})
