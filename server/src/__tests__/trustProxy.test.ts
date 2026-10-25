// 反向代理信任与登录限流键测试
// - TRUST_PROXY 解析：空 / 数字 / true / false / 自定义字符串
// - 设置 trust proxy 后，X-Forwarded-For 决定 req.ip，限流按真实客户端区分
// - 登录限流键为 IP + 用户名，同 IP 不同用户互不影响
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request } from 'express'
import rateLimit from 'express-rate-limit'
import { parseTrustProxy } from '../trustProxy.js'
import { loginLimiterKey } from '../authRoutes.js'

describe('parseTrustProxy', () => {
  it('未配置 / 空字符串 → 不信任（undefined）', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined()
    expect(parseTrustProxy('')).toBeUndefined()
    expect(parseTrustProxy('   ')).toBeUndefined()
  })

  it('数字字符串 → 信任跳数', () => {
    expect(parseTrustProxy('1')).toBe(1)
    expect(parseTrustProxy('2')).toBe(2)
  })

  it('true / false / 自定义字符串', () => {
    expect(parseTrustProxy('true')).toBe(true)
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('loopback')).toBe('loopback')
  })
})

describe('trust proxy 与按 IP 限流', () => {
  function createApp() {
    const app = express()
    app.set('trust proxy', 1)
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 1,
      standardHeaders: false,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: 'RATE_LIMITED' } })
      },
    })
    app.get('/probe', limiter, (req, res) => {
      res.json({ ip: req.ip })
    })
    return app
  }

  it('不同 X-Forwarded-For 视为不同客户端，互不触发限流', async () => {
    const app = createApp()
    const a = await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.1')
    const b = await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.2')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.ip).toBe('10.0.0.1')
    expect(b.body.ip).toBe('10.0.0.2')
  })

  it('同一 X-Forwarded-For 超过上限返回 429', async () => {
    const app = createApp()
    await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.3')
    const res = await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.3')
    expect(res.status).toBe(429)
  })
})

describe('loginLimiterKey', () => {
  it('返回 IP + 归一化用户名', () => {
    const req = { ip: '10.0.0.9', body: { username: '  Alice ' } } as unknown as Request
    expect(loginLimiterKey(req)).toBe('10.0.0.9|alice')
  })

  it('用户名缺失时仅使用 IP 键', () => {
    const req = { ip: '10.0.0.9', body: {} } as unknown as Request
    expect(loginLimiterKey(req)).toBe('10.0.0.9|')
  })

  it('同 IP 不同用户生成不同键', () => {
    const a = { ip: '10.0.0.9', body: { username: 'alice' } } as unknown as Request
    const b = { ip: '10.0.0.9', body: { username: 'bob' } } as unknown as Request
    expect(loginLimiterKey(a)).not.toBe(loginLimiterKey(b))
  })
})
