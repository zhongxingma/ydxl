// AI 用量记录、日/月预算校验与成本聚合
//
// 数据来源：operation_logs 中 action = 'ai.proxy.usage' 的明细行
// - 每次成功调用记录 provider / model / 输入输出 token / 估算成本（不记 prompt 内容）
// - 预算与面板均基于该表聚合，不新增表，沿用 180 天保留期
// - 明细键名避免使用 token 等敏感词（audit.sanitizeDetail 会剔除含 token 的键），
//   因此用 prompt / completion / total 表示三类 token 数
import { db } from './db.js'
import { logOperation, AUDIT_ACTIONS } from './audit.js'

// 单次调用的 token 统计（来自上游 usage 字段）
export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface AiUsageContext {
  userId: string
  username: string | null
  provider: string
  model: string
  stream: boolean
  durationMs: number
}

/** 校验失败时的统一响应体（供代理路由复用） */
export function budgetExceededPayload(state: AiBudgetState): Record<string, unknown> {
  return {
    error: {
      code: 'AI_BUDGET_EXCEEDED',
      message:
        state.scope === 'daily'
          ? '今日 AI 用量已达上限，请明天再试或联系管理员'
          : '本月 AI 用量已达上限，请联系管理员',
      scope: state.scope,
      dailyUsed: state.dailyUsed,
      dailyLimit: state.dailyLimit,
      monthlyUsed: state.monthlyUsed,
      monthlyLimit: state.monthlyLimit,
    },
  }
}

// 模型价格表：人民币 / 百万 token（估算值，可按部署实际价格调整）
interface ModelPrice {
  input: number
  output: number
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-pro': { input: 24, output: 96 },
  'deepseek-v4-flash': { input: 6, output: 24 },
  'gpt-5.2': { input: 105, output: 420 },
  'gpt-5.2-mini': { input: 26, output: 105 },
  'qwen3-max': { input: 20, output: 80 },
  'qwen3-turbo': { input: 5, output: 25 },
}

// 未知模型回退价格（取 pro 档，宁可高估）
const DEFAULT_PRICE: ModelPrice = { input: 24, output: 96 }

/** 估算单次调用成本（元，保留 6 位小数） */
export function estimateCostCny(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[model] ?? DEFAULT_PRICE
  const cost =
    (usage.prompt / 1_000_000) * price.input + (usage.completion / 1_000_000) * price.output
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** 解析上游 usage 字段（兼容 OpenAI / DeepSeek 命名） */
export function parseUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0)
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0)
  const totalRaw = Number(u.total_tokens ?? 0)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : prompt + completion
  if (prompt <= 0 && completion <= 0) return null
  return { prompt, completion, total }
}

/** 从非流式 JSON 响应体中提取 usage（解析失败返回 null，不影响转发） */
export function extractUsageFromJson(text: string): TokenUsage | null {
  try {
    const parsed = JSON.parse(text) as { usage?: unknown }
    return parseUsage(parsed?.usage)
  } catch {
    return null
  }
}

/**
 * SSE 用量采集器：逐 chunk 解析 `data:` 行，提取流末尾的 usage
 * - 不缓存完整响应，仅保留未闭合的事件片段，内存占用与单事件大小相关
 * - 上游返回 `data: [DONE]`、心跳或非 JSON 行时静默跳过
 */
export function createSseUsageCollector(): {
  feed: (chunk: string) => void
  getUsage: () => TokenUsage | null
} {
  let buffer = ''
  let usage: TokenUsage | null = null
  return {
    feed(chunk: string): void {
      buffer += chunk.replace(/\r\n/g, '\n')
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload) as { usage?: unknown }
            const parsedUsage = parseUsage(parsed?.usage)
            if (parsedUsage) usage = parsedUsage
          } catch {
            // 非 JSON 行（心跳 / 注释）：忽略
          }
        }
      }
    },
    getUsage: () => usage,
  }
}

/** 记录一次成功调用的用量与估算成本（写 operation_logs，失败不影响主流程） */
export function recordAiUsage(
  ctx: AiUsageContext,
  usage: TokenUsage,
  ip?: string | null,
): void {
  logOperation({
    userId: ctx.userId,
    username: ctx.username,
    action: AUDIT_ACTIONS.aiProxyUsage,
    resource: 'ai-proxy',
    resourceId: ctx.provider,
    detail: {
      provider: ctx.provider,
      model: ctx.model,
      stream: ctx.stream,
      prompt: usage.prompt,
      completion: usage.completion,
      total: usage.total,
      costCny: estimateCostCny(ctx.model, usage),
      durationMs: ctx.durationMs,
    },
    ip: ip ?? null,
  })
}

// ===== 预算配置与校验 =====

export interface AiBudgetLimits {
  // 每用户每日 token 上限（0 表示不限制）
  daily: number
  // 每用户每月 token 上限（0 表示不限制）
  monthly: number
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

/**
 * 读取预算配置（每次调用实时读取 env，便于测试与热更新）
 * - AI_DAILY_TOKEN_BUDGET / AI_MONTHLY_TOKEN_BUDGET
 * - 默认：日 100,000 / 月 2,000,000 token（约覆盖一个学生正常使用量）
 */
export function getAiBudgetLimits(): AiBudgetLimits {
  return {
    daily: parseLimit(process.env.AI_DAILY_TOKEN_BUDGET, 100_000),
    monthly: parseLimit(process.env.AI_MONTHLY_TOKEN_BUDGET, 2_000_000),
  }
}

function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfMonth(now: number): number {
  const d = new Date(now)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 统计某用户在指定时间点之后的累计 token（仅 ai.proxy.usage 行） */
function sumTokensSince(userId: string, since: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(detail, '$.total') AS INTEGER)), 0) AS tokens
       FROM operation_logs
       WHERE action = ? AND userId = ? AND createdAt >= ?`,
    )
    .get(AUDIT_ACTIONS.aiProxyUsage, userId, since) as { tokens: number }
  return Number(row?.tokens ?? 0)
}

export interface AiBudgetState {
  dailyLimit: number
  monthlyLimit: number
  dailyUsed: number
  monthlyUsed: number
  exceeded: boolean
  // 超限范围：daily 优先（更早触发）
  scope: 'daily' | 'monthly' | null
}

/** 校验用户当前是否超出日/月预算（0 上限视为不限制） */
export function checkAiBudget(userId: string, now = Date.now()): AiBudgetState {
  const limits = getAiBudgetLimits()
  const dailyUsed = limits.daily > 0 ? sumTokensSince(userId, startOfDay(now)) : 0
  const monthlyUsed = limits.monthly > 0 ? sumTokensSince(userId, startOfMonth(now)) : 0
  const dailyExceeded = limits.daily > 0 && dailyUsed >= limits.daily
  const monthlyExceeded = limits.monthly > 0 && monthlyUsed >= limits.monthly
  return {
    dailyLimit: limits.daily,
    monthlyLimit: limits.monthly,
    dailyUsed,
    monthlyUsed,
    exceeded: dailyExceeded || monthlyExceeded,
    scope: dailyExceeded ? 'daily' : monthlyExceeded ? 'monthly' : null,
  }
}

// ===== 成本可观测性聚合 =====

export interface AiCostBucket {
  tokens: number
  costCny: number
  calls: number
}

export interface AiCostDaily extends AiCostBucket {
  date: string
}

export interface AiCostByModel extends AiCostBucket {
  model: string
  provider: string
}

export interface AiCostByUser extends AiCostBucket {
  userId: string
  username: string | null
}

export interface AiCostReport {
  days: number
  from: string
  to: string
  totals: {
    today: AiCostBucket
    month: AiCostBucket
    window: AiCostBucket
  }
  budgets: AiBudgetLimits
  daily: AiCostDaily[]
  byModel: AiCostByModel[]
  byUser: AiCostByUser[]
}

const MAX_REPORT_DAYS = 180

function mapBucket(row: Record<string, unknown>): AiCostBucket {
  return {
    tokens: Number(row.tokens ?? 0),
    costCny: Math.round(Number(row.cost ?? 0) * 1_000_000) / 1_000_000,
    calls: Number(row.calls ?? 0),
  }
}

function sumBetween(from: number, to: number): AiCostBucket {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(CAST(json_extract(detail, '$.total') AS INTEGER)), 0) AS tokens,
              COALESCE(SUM(CAST(json_extract(detail, '$.costCny') AS REAL)), 0) AS cost
       FROM operation_logs
       WHERE action = ? AND createdAt >= ? AND createdAt < ?`,
    )
    .get(AUDIT_ACTIONS.aiProxyUsage, from, to) as Record<string, unknown>
  return mapBucket(row)
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 聚合近 days 天的 AI 用量与估算成本（today / month / window + 日/模型/用户维度） */
export function getAiCostReport(days = 30, now = Date.now()): AiCostReport {
  const safeDays = Math.min(Math.max(Math.floor(days) || 30, 1), MAX_REPORT_DAYS)
  const todayStart = startOfDay(now)
  const windowStart = todayStart - (safeDays - 1) * 86_400_000
  const monthStart = startOfMonth(now)

  const windowRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', createdAt / 1000, 'unixepoch', 'localtime') AS date,
              COUNT(*) AS calls,
              COALESCE(SUM(CAST(json_extract(detail, '$.total') AS INTEGER)), 0) AS tokens,
              COALESCE(SUM(CAST(json_extract(detail, '$.costCny') AS REAL)), 0) AS cost
       FROM operation_logs
       WHERE action = ? AND createdAt >= ?
       GROUP BY date
       ORDER BY date ASC`,
    )
    .all(AUDIT_ACTIONS.aiProxyUsage, windowStart) as Record<string, unknown>[]

  const modelRows = db
    .prepare(
      `SELECT COALESCE(json_extract(detail, '$.model'), 'unknown') AS model,
              COALESCE(json_extract(detail, '$.provider'), 'unknown') AS provider,
              COUNT(*) AS calls,
              COALESCE(SUM(CAST(json_extract(detail, '$.total') AS INTEGER)), 0) AS tokens,
              COALESCE(SUM(CAST(json_extract(detail, '$.costCny') AS REAL)), 0) AS cost
       FROM operation_logs
       WHERE action = ? AND createdAt >= ?
       GROUP BY model, provider
       ORDER BY cost DESC`,
    )
    .all(AUDIT_ACTIONS.aiProxyUsage, windowStart) as Record<string, unknown>[]

  const userRows = db
    .prepare(
      `SELECT userId,
              MAX(username) AS username,
              COUNT(*) AS calls,
              COALESCE(SUM(CAST(json_extract(detail, '$.total') AS INTEGER)), 0) AS tokens,
              COALESCE(SUM(CAST(json_extract(detail, '$.costCny') AS REAL)), 0) AS cost
       FROM operation_logs
       WHERE action = ? AND createdAt >= ? AND userId IS NOT NULL
       GROUP BY userId
       ORDER BY cost DESC
       LIMIT 100`,
    )
    .all(AUDIT_ACTIONS.aiProxyUsage, windowStart) as Record<string, unknown>[]

  return {
    days: safeDays,
    from: formatDate(windowStart),
    to: formatDate(todayStart),
    totals: {
      today: sumBetween(todayStart, now + 1),
      month: sumBetween(monthStart, now + 1),
      window: sumBetween(windowStart, now + 1),
    },
    budgets: getAiBudgetLimits(),
    daily: windowRows.map((row) => ({
      date: String(row.date),
      ...mapBucket(row),
    })),
    byModel: modelRows.map((row) => ({
      model: String(row.model),
      provider: String(row.provider),
      ...mapBucket(row),
    })),
    byUser: userRows.map((row) => ({
      userId: String(row.userId),
      username: (row.username as string | null) ?? null,
      ...mapBucket(row),
    })),
  }
}
