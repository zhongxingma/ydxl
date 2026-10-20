// AI 代理按用户配额测试（多用户 P3）
//
// 背景：AI 端点 /api/v1/ai-proxy 原按 IP 限流（20/min/IP）。班级机房 / 宿舍 NAT
//       等共享出口场景下，一个用户刷满会耗尽整个出口额度、误伤同网段其他学员。
//       P3 将配额主维度切换为 req.user.id（20/min/user），共享 IP 不再互斥。
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

const VALID_BODY = { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] }

describe('AI 代理按用户配额（P3）', () => {
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
