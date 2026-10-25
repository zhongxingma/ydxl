// AI Proxy 请求校验与流式转发
//
// 4xx 透传、body / messages / model / max_tokens 校验与 SSE 流式转发。
// 由 aiProxy.test.ts 按职责拆分而来，用例内容与断言未改动。

import http from 'node:http'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './aiProxyTestApp.js'

describe('AI Proxy 请求校验与流式转发', () => {
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

  // 12b. 消息条数超限 → 400
  it('messages 超过 50 条 → 返回 400', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()
    const messages = Array.from({ length: 51 }, () => ({ role: 'user', content: 'hi' }))

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({ body: { model: 'deepseek-v4-pro', messages } })

    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('messages exceeds limit')
  })

  // 12c. 消息总内容超限 → 400
  it('messages 总字符数超过 100000 → 返回 400', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const app = createTestApp()

    const res = await request(app)
      .post('/api/v1/ai-proxy/deepseek')
      .send({
        body: {
          model: 'deepseek-v4-pro',
          messages: [{ role: 'user', content: 'x'.repeat(100_001) }],
        },
      })

    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('messages content exceeds limit')
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
