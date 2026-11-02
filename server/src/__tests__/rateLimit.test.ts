// 限流中间件测试
// 验证 express-rate-limit 在每 IP 每分钟 60 次的限制下正常放行，超限返回 429
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import rateLimit from 'express-rate-limit'
import cors from 'cors'

// 创建测试用 app（限流配置与生产一致）
function createTestApp() {
  const app = express()
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } })
    },
  })
  app.use(cors())
  app.use(express.json())
  app.use(limiter)
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  return app
}

describe('Rate Limiting', () => {
  it('should allow 60 requests per minute', async () => {
    const app = createTestApp()
    for (let i = 0; i < 60; i++) {
      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
    }
  })

  it('should return 429 after 60 requests', async () => {
    const app = createTestApp()
    for (let i = 0; i < 60; i++) {
      await request(app).get('/api/health')
    }
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
  })

  it('should expose standard RateLimit headers with decreasing remaining count', async () => {
    const app = createTestApp()
    const first = await request(app).get('/api/health')
    const second = await request(app).get('/api/health')

    // standardHeaders: true → RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset
    expect(first.headers['ratelimit-limit']).toBe('60')
    expect(first.headers['ratelimit-remaining']).toBe('59')
    expect(second.headers['ratelimit-remaining']).toBe('58')
    // RateLimit-Reset 为窗口剩余秒数（0 < x <= 60）
    const reset = Number(first.headers['ratelimit-reset'])
    expect(reset).toBeGreaterThan(0)
    expect(reset).toBeLessThanOrEqual(60)
    // legacyHeaders: false → 不返回旧版 X-RateLimit-* 头
    expect(first.headers['x-ratelimit-limit']).toBeUndefined()
  })

  it('should report zero remaining and unified error body when limited', async () => {
    const app = createTestApp()
    for (let i = 0; i < 60; i++) {
      await request(app).get('/api/health')
    }
    const res = await request(app).get('/api/health')
    expect(Number(res.headers['ratelimit-remaining'])).toBe(0)
    expect(res.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    })
  })
})
