// AI 代理路由端到端测试（Task 6.3 + Task 2 超时与重试）
//
// 测试范围：
// 1. DEEPSEEK_API_KEY 未配置 → 503 + PROXY_NOT_CONFIGURED
// 2. 正常转发 → 200 + 上游响应透传
// 3. 上游超时（AbortError）→ 504 + TIMEOUT（不重试）
// 4. 上游网络错误（重试耗尽）→ 502 + UPSTREAM_ERROR
// 5. 上游 5xx（重试耗尽）→ 502 + UPSTREAM_ERROR
// 6. 上游 5xx 后重试成功 → 200
// 7. 网络错误后重试成功 → 200
// 8. 上游 4xx → 原样转发
// 9. 缺少 body → 400 + INVALID_BODY
//
// 使用 supertest 测试 Express 路由，mock global fetch 模拟上游响应
// 参考 routes.test.ts 的测试模式
//
// 注意：涉及重试的测试使用真实定时器（退避延迟 1s/2s），需较长超时

import http from 'node:http'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { aiProxyRouter } from '../ai-proxy.js'

// 构建测试用 Express 应用，挂载 aiProxyRouter
function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/ai-proxy', aiProxyRouter)
  return app
}

describe('AI Proxy', () => {
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

  // 10. 上游返回 4xx → 原样转发状态码与响应体
  it('上游返回 4xx → 原样转发状态码与响应体', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const upstreamBody = JSON.stringify({ error: 'bad request' })
    global.fetch = vi.fn().mockResolvedValue({
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => upstreamBody,
    }) as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('bad request')
    // 4xx 不重试
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  // 11. body 为空字符串 → 400 + INVALID_BODY
  it('body 为空字符串 → 返回 400 + INVALID_BODY', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    // 发送 { body: '' }：req.body.body = ''（空字符串）
    // '' ?? req.body = ''（空字符串非 null/undefined，?? 返回左侧值）
    // !'' = true → 触发 400（不经过 fetch，无需 mock）
    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: '' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  // 12. messages 为空数组 → 400 + INVALID_BODY（请求体 schema 校验）
  it('messages 为空数组 → 返回 400 + INVALID_BODY', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: { model: 'deepseek-v4-pro', messages: [] } })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
    expect(res.body.error.message).toContain('messages')
  })

  // 13. model 不在白名单 → 400 + INVALID_BODY
  it('model 不在白名单 → 返回 400 + INVALID_BODY', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({
        body: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hi' }],
        },
      })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
    expect(res.body.error.message).toContain('Unsupported model')
  })

  // 14. max_tokens 超过上限 → 400 + INVALID_BODY
  it('max_tokens 超过上限 4096 → 返回 400 + INVALID_BODY', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({
        body: {
          model: 'deepseek-v4-pro',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 8192,
        },
      })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
    expect(res.body.error.message).toContain('max_tokens')
  })

  // 15. SSE 流式 - 正常转发上游 SSE 流到客户端
  it('SSE 流式 - 正常转发上游 SSE 流到客户端', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const chunks = ['data: {"choices":[]}\n\n', 'data: [DONE]\n\n']
    const encoder = new TextEncoder()
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const c of chunks) {
              controller.enqueue(encoder.encode(c))
            }
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    ) as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek/stream')
      .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.text).toContain('data: [DONE]')
    // 验证 stream / stream_options 被强制设置
    const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const init = fetchCall[1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  // 16. SSE 流式 - 上游返回非 2xx → 通过 SSE error 事件发送错误
  it('SSE 流式 - 上游返回非 2xx → 通过 SSE error 事件发送错误', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    global.fetch = vi.fn().mockResolvedValue(
      new Response('upstream error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    ) as unknown as typeof fetch

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek/stream')
      .send({ body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] } })

    // SSE 响应头已 flush（200），错误通过 event: error 传递
    expect(res.status).toBe(200)
    expect(res.text).toContain('event: error')
    const dataMatch = res.text.match(/data: (.+)\n/)
    const payload = JSON.parse(dataMatch![1]!)
    expect(payload.status).toBe(500)
    expect(payload.message).toBe('upstream error')
  })

  // 17. SSE 流式 - 客户端中断时上游 fetch 的 signal 被中断（abort 信号传播，核心 bug 修复验证）
  //     使用真实 http 服务器而非 supertest，以便精确控制客户端连接销毁，
  //     确保 req 'close' 事件可靠触发。
  it(
    'SSE 流式 - 客户端中断时上游 fetch 的 signal 被中断（abort 信号传播）',
    async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key'
      const app = createTestApp()
      const server = http.createServer(app)
      await new Promise<void>((resolve) => server.listen(0, resolve))
      const port = (server.address() as { port: number }).port

      let capturedSignal: AbortSignal | undefined
      let resolveFetchCalled!: () => void
      const fetchCalled = new Promise<void>((r) => {
        resolveFetchCalled = r
      })

      // mock fetch：捕获传给 fetch 的 signal（即 fetchWithRetry 本地 controller.signal），
      // 返回一个挂起的流；当 signal 中断时让流抛出 AbortError（模拟真实 fetch 在 signal
      // 中断时取消响应体读取的行为），便于路由 catch 块正常结束响应。
      global.fetch = vi.fn().mockImplementation((_url, init) => {
        const signal = (init as RequestInit).signal ?? undefined
        capturedSignal = signal
        resolveFetchCalled()
        const body = new ReadableStream({
          start(streamController) {
            signal?.addEventListener('abort', () => {
              streamController.error(
                new DOMException('The operation was aborted', 'AbortError'),
              )
            })
          },
        })
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        )
      }) as unknown as typeof fetch

      // 发起真实 HTTP 请求（便于精确销毁客户端连接模拟断连）
      const clientReq = http.request({
        port,
        path: '/api/v1/ai-proxy/deepseek/stream',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      // 吞掉销毁连接产生的 ECONNRESET，避免 unhandled error
      clientReq.on('error', () => {})
      clientReq.write(
        JSON.stringify({
          body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] },
        }),
      )
      clientReq.end()

      try {
        // 等待上游 fetch 被调用
        await fetchCalled
        expect(capturedSignal).toBeDefined()
        expect(capturedSignal!.aborted).toBe(false)

        // 销毁客户端连接，模拟客户端断连
        clientReq.destroy()

        // 等待中断传播链：
        // 客户端断连 → server 检测 socket 关闭 → res 'close' 事件（writableEnded=false）→
        // route controller.abort() → fetchWithRetry 转发 caller signal 到本地 controller →
        // fetch 的 signal (capturedSignal) aborted
        await new Promise((resolve) => setTimeout(resolve, 300))

        // 核心断言：客户端中断已传播到上游 fetch 的 signal
        expect(capturedSignal!.aborted).toBe(true)
      } finally {
        // 清理：强制关闭所有连接与服务器，避免句柄泄漏导致测试挂起
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
    10000,
  )
})

// ---------- custom 上游路由测试（生产代理模式自定义模型节点） ----------

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


