// AI 代理契约：重试与错误分类
//
// 429 退避（retry_after / Retry-After）、402 不重试、503 重试与练习题生成思考模式。
// 由 ai-proxy-contract.test.ts 按契约分组拆分而来，用例内容与断言未改动。

import { type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, installFetchMockSequence, installImmediateSetTimeout, restoreFetch } from '@/test/setup'

describe('AI 代理契约：重试与错误分类', () => {
  // 静默 baseProvider.ts 中的 console.debug 请求/响应日志，避免测试输出噪音
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })
  // ===== 重试与错误分类契约（Task: DeepSeek API 429 重试 / 错误分类 / 请求级日志 / 并发节流）=====

  it('429 响应触发重试（第一次 429，第二次 200）', async () => {
    const restoreTimer = installImmediateSetTimeout()
    const calls = installFetchMockSequence([
      {
        ok: false,
        status: 429,
        json: { error: { message: 'rate limited' } },
      },
      {
        ok: true,
        status: 200,
        json: { choices: [{ message: { content: 'ok' } }] },
      },
    ])
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      const result = await provider.generateTranslation('hello')
      expect(result).toBe('ok')
      expect(calls.length).toBe(2)
    } finally {
      restoreTimer()
      restoreFetch()
    }
  })

  it('429 带 retry_after 字段时使用该值作为退避时间', async () => {
    const restoreTimer = installImmediateSetTimeout()
    const calls = installFetchMockSequence([
      {
        ok: false,
        status: 429,
        json: { error: { message: 'rate limited' }, retry_after: 2 },
      },
      {
        ok: true,
        status: 200,
        json: { choices: [{ message: { content: 'ok' } }] },
      },
    ])

    // 捕获 setTimeout 的延迟参数，验证 retry_after=2（→2000ms）被用作退避时间
    const prevSetTimeout = global.setTimeout
    const delays: number[] = []
    global.setTimeout = ((cb: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof delay === 'number') delays.push(delay)
      return prevSetTimeout(cb as TimerHandler, 0, ...args)
    }) as unknown as typeof setTimeout

    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      const result = await provider.generateTranslation('hello')
      expect(result).toBe('ok')
      expect(calls.length).toBe(2)
      // retry_after=2 秒 = 2000ms 应在捕获的延迟列表中
      // （另含 AbortController 超时 60000ms，但被 clearTimeout 清理不会触发）
      expect(delays).toContain(2000)
    } finally {
      global.setTimeout = prevSetTimeout
      restoreTimer()
      restoreFetch()
    }
  })

  it('429 带 Retry-After 响应头（OpenAI/Cloudflare 约定）时使用该值作为退避时间', async () => {
    const restoreTimer = installImmediateSetTimeout()
    const calls = installFetchMockSequence([
      {
        ok: false,
        status: 429,
        json: { error: { message: 'rate limited' } },
        // OpenAI/Cloudflare 等网关通过响应头而非 body 字段传递建议等待时长
        headers: { 'Retry-After': '3' },
      },
      {
        ok: true,
        status: 200,
        json: { choices: [{ message: { content: 'ok' } }] },
      },
    ])

    const prevSetTimeout = global.setTimeout
    const delays: number[] = []
    global.setTimeout = ((cb: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof delay === 'number') delays.push(delay)
      return prevSetTimeout(cb as TimerHandler, 0, ...args)
    }) as unknown as typeof setTimeout

    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      const result = await provider.generateTranslation('hello')
      expect(result).toBe('ok')
      expect(calls.length).toBe(2)
      // Retry-After: 3 秒 = 3000ms 应被用作退避时间
      expect(delays).toContain(3000)
    } finally {
      global.setTimeout = prevSetTimeout
      restoreTimer()
      restoreFetch()
    }
  })

  it('429 body retry_after 字段优先于 Retry-After 响应头', async () => {
    const restoreTimer = installImmediateSetTimeout()
    installFetchMockSequence([
      {
        ok: false,
        status: 429,
        // 两种约定同时存在时应采用 body 内的 DeepSeek 官方约定值
        json: { error: { message: 'rate limited' }, retry_after: 2 },
        headers: { 'Retry-After': '10' },
      },
      {
        ok: true,
        status: 200,
        json: { choices: [{ message: { content: 'ok' } }] },
      },
    ])

    const prevSetTimeout = global.setTimeout
    const delays: number[] = []
    global.setTimeout = ((cb: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof delay === 'number') delays.push(delay)
      return prevSetTimeout(cb as TimerHandler, 0, ...args)
    }) as unknown as typeof setTimeout

    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      await provider.generateTranslation('hello')
      // body retry_after=2 → 2000ms 生效；头部的 10 秒（10000ms）应被忽略
      expect(delays).toContain(2000)
      expect(delays).not.toContain(10000)
    } finally {
      global.setTimeout = prevSetTimeout
      restoreTimer()
      restoreFetch()
    }
  })

  it('402 余额不足不重试，直接抛出明确错误', async () => {
    const restoreTimer = installImmediateSetTimeout()
    const calls = installFetchMock({
      ok: false,
      status: 402,
      json: { error: { message: 'insufficient balance' } },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      await expect(provider.generateTranslation('hello')).rejects.toThrow('余额不足')
      expect(calls.length).toBe(1)
    } finally {
      restoreTimer()
      restoreFetch()
    }
  })

  it('503 服务器繁忙触发重试', async () => {
    const restoreTimer = installImmediateSetTimeout()
    const calls = installFetchMockSequence([
      {
        ok: false,
        status: 503,
        json: { error: { message: 'server busy' } },
      },
      {
        ok: true,
        status: 200,
        json: { choices: [{ message: { content: 'ok' } }] },
      },
    ])
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      const result = await provider.generateTranslation('hello')
      expect(result).toBe('ok')
      expect(calls.length).toBe(2)
    } finally {
      restoreTimer()
      restoreFetch()
    }
  })

  // ===== 修复练习题生成失败：generateQuestions 禁用思考模式契约 =====

  it('generateQuestions 请求体信封内 body 应包含 thinking: { type: "disabled" } 且不含 reasoning_effort', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  id: 'q-1',
                  type: 'main_idea',
                  stem: '题干',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 0,
                  explanation: '解析',
                  locationClue: '线索',
                },
              ]),
            },
          },
        ],
      },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
        model: 'deepseek-v4-pro',
      })
      await provider.generateQuestions('art-1', 'article content')

      // 验证信封结构内 body 的思考模式配置
      const body = JSON.parse(calls[0].body) as {
        provider: string
        body: {
          model: string
          messages: ChatMessage[]
          reasoning_effort?: string
          thinking?: { type: string }
          max_tokens?: number
        }
      }
      expect(body.provider).toBe('deepseek')
      // 修复：思考模式 + JSON Output 模式存在内容截断与空 content 问题，
      // 改为禁用思考以保证稳定性（与 generateArticle / extractVocabulary 一致策略）
      expect(body.body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort（互斥语义）
      expect(body.body.reasoning_effort).toBeUndefined()
      // maxTokens 提升至 3072，避免 5 题 JSON 被截断
      expect(body.body.max_tokens).toBe(3072)
    } finally {
      restoreFetch()
    }
  })
})
