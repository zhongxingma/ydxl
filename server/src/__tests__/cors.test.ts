// CORS 白名单测试
// 验证未配置 CORS_ORIGIN 时允许所有来源，配置后仅允许白名单内来源
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import cors from 'cors'

function createTestApp(corsOrigin?: string) {
  const app = express()
  const corsOptions = corsOrigin
    ? { origin: corsOrigin.split(',').map((s) => s.trim()) }
    : {}
  app.use(cors(corsOptions))
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  return app
}

describe('CORS Configuration', () => {
  it('should allow all origins by default (no CORS_ORIGIN)', async () => {
    const app = createTestApp()
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.com')
    expect(res.status).toBe(200)
    // 默认 cors() 允许所有来源
  })

  it('should only allow whitelisted origins when CORS_ORIGIN is set', async () => {
    const app = createTestApp('https://ydxl.example.com')
    const res = await request(app).get('/api/health').set('Origin', 'https://ydxl.example.com')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://ydxl.example.com')
  })

  it('should reject non-whitelisted origins', async () => {
    const app = createTestApp('https://ydxl.example.com')
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.com')
    expect(res.status).toBe(200)
    // 非白名单来源不会返回 Access-Control-Allow-Origin 头
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('should accept every origin in a comma-separated whitelist', async () => {
    const app = createTestApp('https://a.example.com, https://b.example.com')
    const a = await request(app).get('/api/health').set('Origin', 'https://a.example.com')
    const b = await request(app).get('/api/health').set('Origin', 'https://b.example.com')
    expect(a.headers['access-control-allow-origin']).toBe('https://a.example.com')
    expect(b.headers['access-control-allow-origin']).toBe('https://b.example.com')
  })

  it('should answer preflight for whitelisted origin with 204 and allow headers', async () => {
    const app = createTestApp('https://ydxl.example.com')
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'https://ydxl.example.com')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://ydxl.example.com')
    expect(res.headers['access-control-allow-methods']).toContain('GET')
  })

  it('should not echo allow-origin on preflight from non-whitelisted origin', async () => {
    const app = createTestApp('https://ydxl.example.com')
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
