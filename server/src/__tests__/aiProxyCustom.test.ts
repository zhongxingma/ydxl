// AI Proxy custom 上游
//
// 自定义模型节点未配置、鉴权头、模型白名单与上游错误映射。
// 由 aiProxy.test.ts 按供应商类型拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './aiProxyTestApp.js'

describe('AI Proxy custom 上游', () => {
  const originalFetch = global.fetch
  const originalCustomEndpoint = process.env.CUSTOM_API_ENDPOINT
  const originalCustomKey = process.env.CUSTOM_API_KEY
  const originalCustomModels = process.env.CUSTOM_MODELS

  beforeEach(() => {
    global.fetch = originalFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    for (const [key, value] of [
      ['CUSTOM_API_ENDPOINT', originalCustomEndpoint],
      ['CUSTOM_API_KEY', originalCustomKey],
      ['CUSTOM_MODELS', originalCustomModels],
    ] as const) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    vi.restoreAllMocks()
  })

  it('CUSTOM_API_ENDPOINT 未配置 → 返回 503 + CUSTOM_NOT_CONFIGURED', async () => {
    delete process.env.CUSTOM_API_ENDPOINT
    delete process.env.CUSTOM_API_KEY
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/custom')
      .send({ body: { model: 'my-model', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('CUSTOM_NOT_CONFIGURED')
    expect(res.body.error.message).toContain('CUSTOM_API_ENDPOINT')
  })

  it('配置后应转发到规范化的上游端点（Base URL 自动拼接 /chat/completions）', async () => {
    process.env.CUSTOM_API_ENDPOINT = 'https://gateway.example.com/v1'
    process.env.CUSTOM_API_KEY = 'custom-key'
    delete process.env.CUSTOM_MODELS
    const app = createTestApp()

    const upstreamBody = JSON.stringify({
      choices: [{ message: { content: 'Hello from custom upstream' } }],
    })
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => upstreamBody,
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/custom')
      .send({ body: { model: 'my-model', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(200)
    expect(res.text).toContain('Hello from custom upstream')
    // 上游端点规范化：Base URL 拼接 /chat/completions；Bearer 携带服务端密钥
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://gateway.example.com/v1/chat/completions',
    )
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer custom-key')
    // 转发的请求体为解包后的裸 body（不含 provider 信封）
    const body = JSON.parse(init.body as string) as { model: string }
    expect(body.model).toBe('my-model')
  })

  it('CUSTOM_MODELS 白名单外的 model → 返回 400 + INVALID_BODY', async () => {
    process.env.CUSTOM_API_ENDPOINT = 'https://gateway.example.com/v1'
    process.env.CUSTOM_API_KEY = 'custom-key'
    process.env.CUSTOM_MODELS = 'allowed-model-a,allowed-model-b'
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/custom')
      .send({ body: { model: 'not-allowed', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
    expect(res.body.error.message).toContain('Unsupported model')
  })

  it('CUSTOM_MODELS 未配置时任意 model 均放行（由上游计费管控）', async () => {
    process.env.CUSTOM_API_ENDPOINT = 'https://gateway.example.com/v1/chat/completions'
    process.env.CUSTOM_API_KEY = 'custom-key'
    delete process.env.CUSTOM_MODELS
    const app = createTestApp()

    const upstreamBody = JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    })
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => upstreamBody,
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/custom')
      .send({ body: { model: 'any-model-id', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(200)
    // 完整 URL（已含 /chat/completions）原样使用
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://gateway.example.com/v1/chat/completions',
    )
  })

  it('CUSTOM_API_KEY 未配置 → 返回 503 + PROXY_NOT_CONFIGURED', async () => {
    process.env.CUSTOM_API_ENDPOINT = 'https://gateway.example.com/v1'
    delete process.env.CUSTOM_API_KEY
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/custom')
      .send({ body: { model: 'my-model', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('PROXY_NOT_CONFIGURED')
    expect(res.body.error.message).toContain('CUSTOM_API_KEY')
  })
})


