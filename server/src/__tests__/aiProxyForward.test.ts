// AI Proxy 转发与重试
//
// 密钥缺失、正常转发（信封 / 裸 body）、超时、网络错误与 5xx 重试。
// 由 aiProxy.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './aiProxyTestApp.js'

describe('AI Proxy 转发与重试', () => {
  // 保存原始 fetch 与环境变量，便于恢复
  const originalFetch = global.fetch
  const originalKey = process.env.DEEPSEEK_API_KEY

  beforeEach(() => {
    // 每个用例前确保 fetch 为原始状态
    global.fetch = originalFetch
  })

  afterEach(() => {
    // 恢复 fetch 与环境变量
    global.fetch = originalFetch
    if (originalKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
    vi.restoreAllMocks()
  })

  // 1. DEEPSEEK_API_KEY 未配置 → 503 + PROXY_NOT_CONFIGURED
  it('DEEPSEEK_API_KEY 未配置 → 返回 503 + PROXY_NOT_CONFIGURED', async () => {
    delete process.env.DEEPSEEK_API_KEY
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('PROXY_NOT_CONFIGURED')
    expect(res.body.error.message).toContain('DEEPSEEK_API_KEY')
  })

  // 2. 正常转发 → 200 + 上游响应透传
  it('正常转发 → 返回上游响应（200）', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    // mock fetch 返回 200 + 上游响应
    const upstreamBody = JSON.stringify({
      choices: [{ message: { content: 'Hello from upstream' } }],
    })
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => upstreamBody,
    }) as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(200)
    expect(res.body.choices[0].message.content).toBe('Hello from upstream')

    // 验证 fetch 被调用，且携带 Authorization header
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const init = fetchCall[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  // 3. 正常转发（裸 body 形式，非信封包装）→ 200
  it('正常转发（裸 body 形式）→ 返回上游响应', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const upstreamBody = JSON.stringify({ ok: true })
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => upstreamBody,
    }) as unknown as typeof fetch

    // 直接发送裸 body（非 { body: ... } 包装）
    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  // 4. 上游超时（AbortError）→ 504 + TIMEOUT（不重试，fetch 仅调用 1 次）
  it('上游超时（AbortError）→ 返回 504 + TIMEOUT', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    // mock fetch 抛出 AbortError（模拟 controller.abort() 触发）
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    global.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(504)
    expect(res.body.error.code).toBe('TIMEOUT')
    expect(res.body.error.message).toContain('timed out')
    // AbortError 不重试，fetch 仅调用 1 次
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  // 5. 上游网络错误（重试耗尽）→ 502 + UPSTREAM_ERROR
  // 真实退避延迟 1s + 2s = 3s，需 10s 超时
  it(
    '上游网络错误（重试耗尽）→ 返回 502 + UPSTREAM_ERROR',
    async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key'
      const app = createTestApp()

      // mock fetch 始终抛出网络错误
      global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch

      const res = await request(app)
        .post('/api/v1/ai-proxy/deepseek')
        .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

      expect(res.status).toBe(502)
      expect(res.body.error.code).toBe('UPSTREAM_ERROR')
      expect(res.body.error.message).toBe('network error')
      // 初始 + 2 次重试 = 3 次调用
      expect(global.fetch).toHaveBeenCalledTimes(3)
    },
    10000,
  )

  // 6. 上游错误（非 Error 类型，重试耗尽）→ 502 + 默认消息
  // 真实退避延迟 1s + 2s = 3s，需 10s 超时
  it(
    '上游错误（非 Error 类型，重试耗尽）→ 返回 502 + 默认消息',
    async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key'
      const app = createTestApp()

      // mock fetch 抛出非 Error 类型（如字符串）
      global.fetch = vi.fn().mockRejectedValue('string error') as unknown as typeof fetch

      const res = await request(app)
        .post('/api/v1/ai-proxy/deepseek')
        .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

      expect(res.status).toBe(502)
      expect(res.body.error.code).toBe('UPSTREAM_ERROR')
      expect(res.body.error.message).toBe('Upstream request failed')
      expect(global.fetch).toHaveBeenCalledTimes(3)
    },
    10000,
  )

  // 7. 上游持续 500（重试耗尽）→ 502 + UPSTREAM_ERROR
  // 真实退避延迟 1s + 2s = 3s，需 10s 超时
  it(
    '上游持续 500（重试耗尽）→ 返回 502 + UPSTREAM_ERROR',
    async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key'
      const app = createTestApp()

      global.fetch = vi.fn().mockResolvedValue({
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: 'internal server error' }),
      }) as unknown as typeof fetch

      const res = await request(app)
        .post('/api/v1/ai-proxy/deepseek')
        .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

      expect(res.status).toBe(502)
      expect(res.body.error.code).toBe('UPSTREAM_ERROR')
      expect(global.fetch).toHaveBeenCalledTimes(3)
    },
    10000,
  )

  // 8. 上游 500 后重试成功 → 200
  // 真实退避延迟 1s，需 10s 超时
  it(
    '上游 500 后重试成功 → 返回 200',
    async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key'
      const app = createTestApp()

      const successBody = JSON.stringify({ ok: true })
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          status: 500,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{}',
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => successBody,
        }) as unknown as typeof fetch

      const res = await request(app)
        .post('/api/v1/ai-proxy/deepseek')
        .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    },
    10000,
  )

  // 9. 网络错误后重试成功 → 200
  // 真实退避延迟 1s，需 10s 超时
  it(
    '网络错误后重试成功 → 返回 200',
    async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key'
      const app = createTestApp()

      const successBody = JSON.stringify({ ok: true })
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => successBody,
        }) as unknown as typeof fetch

      const res = await request(app)
        .post('/api/v1/ai-proxy/deepseek')
        .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    },
    10000,
  )
})
