// AI 代理按用户配额测试
//
// 背景：AI 端点 /api/v1/ai-proxy 原按 IP 限流（20/min/IP）。班级机房 / 宿舍 NAT
//       等共享出口场景下，一个用户刷满会耗尽整个出口额度、误伤同网段其他学员。
//       将配额主维度切换为 req.user.id（20/min/user），共享 IP 不再互斥。
//
// 覆盖：
// 1. 配额按用户隔离：同一 IP 下 A 刷满不影响 B（核心行为，证明非按 IP）
// 2. keyGenerator 匿名回退：无 req.user 时按 IP 计量，不抛错、能正常限流
//
// 说明：
// - 用 createAiProxyLimiter 自建小配额实例（max=3 / max=2）缩短触发路径，
//   且显式 skip: () => false，避免默认「NODE_ENV=test 跳过」导致限流失效
// - 挂载顺序与生产 index.ts 一致：authMiddleware（认证门）→ limiter → aiProxyRouter
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { aiProxyRouter, createAiProxyLimiter } from '../ai-proxy.js'
import { authMiddleware } from '../auth.js'
import { createRealUser } from './testUsers.js'
import { db } from '../db.js'
import { AUDIT_ACTIONS } from '../audit.js'
import {
  checkAiBudget,
  createSseUsageCollector,
  estimateCostCny,
  extractUsageFromJson,
  getAiCostReport,
  recordAiUsage,
} from '../aiUsage.js'

const VALID_BODY = { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] }

describe('AI 代理按用户配额', () => {
  const originalFetch = global.fetch
  const originalKey = process.env.DEEPSEEK_API_KEY

  beforeEach(() => {
    // mock 上游返回 200，让请求能走完到「放行」分支，便于观察 200 vs 429
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    }) as unknown as typeof fetch
    process.env.DEEPSEEK_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
    vi.restoreAllMocks()
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM users').run()
  })

  // 挂载顺序与 index.ts 生产一致：认证门 → 配额 → AI 路由
  function createApp(max: number) {
    const app = express()
    app.use(express.json())
    app.use(authMiddleware)
    app.use('/api/v1/ai-proxy', createAiProxyLimiter({ max, skip: () => false }), aiProxyRouter)
    return app
  }

  it('配额按用户隔离：同一 IP 下 A 刷满不影响 B（证明非按 IP 计量）', async () => {
    const app = createApp(3)
    // supertest 全部请求来自同一本地出口（同一 IP），正好复现机房 / NAT 共享出口场景
    const a = createRealUser({ username: 'quota-a' })
    const b = createRealUser({ username: 'quota-b' })

    // A 请求 3 次 → 全部放行
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/v1/ai-proxy/deepseek')
        .set('x-user-token', a.token)
        .send(VALID_BODY)
      expect(res.status).toBe(200)
    }
    // A 第 4 次 → 触发自身配额上限
    const a4 = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .set('x-user-token', a.token)
      .send(VALID_BODY)
    expect(a4.status).toBe(429)
    expect(a4.body.error.code).toBe('RATE_LIMITED')

    // B 首次请求 → 仍放行（独立配额桶）
    // 若是按 IP 计量，B 与 A 同 IP，此时 B 早已被 A 的计数拖到 429
    const b1 = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .set('x-user-token', b.token)
      .send(VALID_BODY)
    expect(b1.status).toBe(200)
  })
})

describe('AI 配额 keyGenerator 匿名回退', () => {
  it('无 req.user 时按 IP 计量（不抛错、能正常限流）', async () => {
    const app = express()
    app.use(express.json())
    // 故意不挂 authMiddleware：模拟无用户上下文，keyGenerator 应回退到 req.ip
    app.use(
      '/api/v1/ai-proxy',
      createAiProxyLimiter({ max: 2, skip: () => false }),
      aiProxyRouter,
    )

    // 前 2 次穿过限流器（下游可能 503 未配 key，但绝不该是 429）
    const ok1 = await request(app).post('/api/v1/ai-proxy/deepseek').send({ body: VALID_BODY })
    expect(ok1.status).not.toBe(429)
    const ok2 = await request(app).post('/api/v1/ai-proxy/deepseek').send({ body: VALID_BODY })
    expect(ok2.status).not.toBe(429)
    // 第 3 次 → 同一 IP 桶已满 → 429
    const limited = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: VALID_BODY })
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
  })
})

describe('AI 用量解析与成本估算（L2）', () => {
  it('extractUsageFromJson 兼容 OpenAI / DeepSeek 字段并忽略无效响应', () => {
    const usage = extractUsageFromJson(
      JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    )
    expect(usage).toEqual({ prompt: 100, completion: 50, total: 150 })
    expect(extractUsageFromJson('not-json')).toBeNull()
    expect(extractUsageFromJson(JSON.stringify({ prompt_tokens: 1 }))).toBeNull()
  })

  it('SSE 采集器跨 chunk 拼接事件并提取流末尾 usage', () => {
    const collector = createSseUsageCollector()
    collector.feed('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"usage":{"prompt_tokens":10,')
    collector.feed('"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n')
    expect(collector.getUsage()).toEqual({ prompt: 10, completion: 5, total: 15 })
  })

  it('estimateCostCny 按模型价格表估算（pro 档 1000 输入 + 500 输出 = ¥0.072）', () => {
    expect(estimateCostCny('deepseek-v4-pro', { prompt: 1000, completion: 500, total: 1500 })).toBe(
      0.072,
    )
    // 未知模型回退 pro 档价格
    expect(estimateCostCny('unknown-model', { prompt: 1000, completion: 0, total: 1000 })).toBe(
      0.024,
    )
  })
})

describe('AI 日/月预算与成本聚合（L2）', () => {
  const originalDaily = process.env.AI_DAILY_TOKEN_BUDGET
  const originalMonthly = process.env.AI_MONTHLY_TOKEN_BUDGET
  const originalFetch = global.fetch
  const originalKey = process.env.DEEPSEEK_API_KEY

  beforeEach(() => {
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM users').run()
    db.prepare('DELETE FROM operation_logs').run()
    process.env.DEEPSEEK_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalDaily === undefined) delete process.env.AI_DAILY_TOKEN_BUDGET
    else process.env.AI_DAILY_TOKEN_BUDGET = originalDaily
    if (originalMonthly === undefined) delete process.env.AI_MONTHLY_TOKEN_BUDGET
    else process.env.AI_MONTHLY_TOKEN_BUDGET = originalMonthly
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
    vi.restoreAllMocks()
    db.prepare('DELETE FROM operation_logs').run()
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM users').run()
  })

  it('recordAiUsage 写入用量后按日 / 模型 / 用户聚合', () => {
    const { user } = createRealUser({ username: 'cost-user' })
    recordAiUsage(
      {
        userId: user.id,
        username: user.username,
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        stream: false,
        durationMs: 12,
      },
      { prompt: 1000, completion: 500, total: 1500 },
    )

    const report = getAiCostReport(7)
    expect(report.totals.today).toMatchObject({ tokens: 1500, calls: 1 })
    expect(report.totals.today.costCny).toBeCloseTo(0.072, 6)
    expect(report.byModel[0]).toMatchObject({
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      tokens: 1500,
    })
    expect(report.byUser[0]).toMatchObject({ username: 'cost-user', tokens: 1500 })
    expect(report.daily).toHaveLength(1)
    expect(report.daily[0]?.tokens).toBe(1500)
  })

  it('预算超限：日用量达到上限时 scope=daily，月上限为 0 时不参与判断', () => {
    process.env.AI_DAILY_TOKEN_BUDGET = '100'
    process.env.AI_MONTHLY_TOKEN_BUDGET = '0'
    const { user } = createRealUser({ username: 'budget-a' })
    recordAiUsage(
      {
        userId: user.id,
        username: user.username,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        stream: false,
        durationMs: 5,
      },
      { prompt: 60, completion: 60, total: 120 },
    )

    const state = checkAiBudget(user.id)
    expect(state.exceeded).toBe(true)
    expect(state.scope).toBe('daily')
    expect(state.dailyLimit).toBe(100)
    expect(state.monthlyLimit).toBe(0)
  })

  it('预算上限为 0 表示不限制（即使已有用量）', () => {
    process.env.AI_DAILY_TOKEN_BUDGET = '0'
    process.env.AI_MONTHLY_TOKEN_BUDGET = '0'
    const { user } = createRealUser({ username: 'budget-b' })
    recordAiUsage(
      {
        userId: user.id,
        username: user.username,
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        stream: false,
        durationMs: 5,
      },
      { prompt: 5000, completion: 5000, total: 10000 },
    )
    const state = checkAiBudget(user.id)
    expect(state.exceeded).toBe(false)
    expect(state.scope).toBeNull()
  })

  it('超预算请求在代理层返回 429 AI_BUDGET_EXCEEDED，且不调用上游', async () => {
    process.env.AI_DAILY_TOKEN_BUDGET = '1'
    const { user, token } = createRealUser({ username: 'budget-c' })
    recordAiUsage(
      {
        userId: user.id,
        username: user.username,
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        stream: false,
        durationMs: 5,
      },
      { prompt: 1, completion: 1, total: 2 },
    )
    global.fetch = vi.fn()

    const app = express()
    app.use(express.json())
    app.use(authMiddleware)
    app.use('/api/v1/ai-proxy', aiProxyRouter)

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .set('x-user-token', token)
      .send(VALID_BODY)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('AI_BUDGET_EXCEEDED')
    expect(res.body.error.scope).toBe('daily')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('成功响应含 usage 时写入 ai.proxy.usage 明细（tokens 与成本）', async () => {
    delete process.env.AI_DAILY_TOKEN_BUDGET
    delete process.env.AI_MONTHLY_TOKEN_BUDGET
    const { token } = createRealUser({ username: 'usage-a' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
    }) as unknown as typeof fetch

    const app = express()
    app.use(express.json())
    app.use(authMiddleware)
    app.use('/api/v1/ai-proxy', aiProxyRouter)

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .set('x-user-token', token)
      .send(VALID_BODY)
    expect(res.status).toBe(200)

    const row = db
      .prepare('SELECT detail FROM operation_logs WHERE action = ?')
      .get(AUDIT_ACTIONS.aiProxyUsage) as { detail: string }
    expect(row).toBeDefined()
    const detail = JSON.parse(row.detail) as Record<string, unknown>
    expect(detail).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      stream: false,
      prompt: 100,
      completion: 50,
      total: 150,
    })
    expect(Number(detail.costCny)).toBeGreaterThan(0)
  })
})
