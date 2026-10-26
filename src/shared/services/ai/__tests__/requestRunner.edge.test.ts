// ProviderRequestRunner 传输层异常分支单元测试
//
// 覆盖场景：
// 1. callChat：网络错误重试、响应解析失败、JSON 模式空内容重试、非 JSON 空内容报错、Token 统计失败降级
// 2. callChatStream：未配置密钥、外部中断、超时与网络错误重试、HTTP 402/400/其他错误映射、空响应体、空内容报错
// 3. 流式成功路径的 Token 用量统计与统计失败降级
// 4. AI 来源追踪的成功 / 失败记录
//
// Mock 策略：mock tokenStats / aiUsageTracker 隔离持久化；fetch 按用例注入
// Response 或抛错，SSE 用 ReadableStream 构造真实流。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import {
  installImmediateSetTimeout,
  restoreFetch,
} from '@/test/setup'
import { recordUsage } from '../tokenStats'
import { recordAIUsage } from '../aiUsageTracker'

vi.mock('../tokenStats', () => ({
  recordUsage: vi.fn(),
  resetStats: vi.fn(),
}))

vi.mock('../aiUsageTracker', () => ({
  recordAIUsage: vi.fn(async () => {}),
}))

const recordUsageMock = vi.mocked(recordUsage)
const recordAIUsageMock = vi.mocked(recordAIUsage)

// ---------- protected 方法访问 ----------

interface ChatOptions {
  jsonMode?: boolean
  maxTokens?: number
  scenario?: string
}

interface StreamOptions {
  jsonMode?: boolean
  scenario?: string
  signal?: AbortSignal
  onChunk?: (delta: string, fullText: string) => void
}

interface Internals {
  callChat: (messages: ChatMessage[], options?: ChatOptions) => Promise<string>
  callChatStream: (messages: ChatMessage[], options: StreamOptions) => Promise<string>
}

function getInternals(provider: DeepSeekProvider): Internals {
  return provider as unknown as Internals
}

function makeMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
  ]
}

function makeProvider(apiKey = 'sk-test'): DeepSeekProvider {
  return new DeepSeekProvider({ apiKey, model: 'deepseek-v4-pro' })
}

// ---------- Response / fetch 工具 ----------

function baseResponse(overrides: {
  ok?: boolean
  status?: number
  statusText?: string
  json?: () => Promise<unknown>
  text?: () => Promise<string>
  body?: ReadableStream<Uint8Array> | null
}): Response {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    json: overrides.json ?? (async () => ({})),
    text: overrides.text ?? (async () => ''),
    body: overrides.body ?? null,
    headers: { get: () => null },
  } as unknown as Response
}

function jsonOk(payload: unknown): Response {
  return baseResponse({ json: async () => payload })
}

function errorRes(status: number, statusText = 'Error'): Response {
  return baseResponse({
    ok: false,
    status,
    statusText,
    json: async () => ({ error: { message: `err-${status}` } }),
  })
}

function createSSEResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return baseResponse({ body: stream })
}

function makeContentSSEChunks(content: string): string[] {
  return [
    `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\n`,
    'data: [DONE]\n\n',
  ]
}

const EMPTY_SSE_CHUNKS = [
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
]

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function installFetch(impl: FetchImpl): { count: number } {
  const counter = { count: 0 }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    counter.count++
    return impl(input, init)
  }) as unknown as typeof fetch
  return counter
}

// 每次调用返回新 Response（ReadableStream 只能消费一次）
function installSSESequence(factories: Array<() => Response>): { count: number } {
  let index = 0
  return installFetch(async () => {
    const factory = factories[Math.min(index, factories.length - 1)]
    index++
    return factory()
  })
}

describe('ProviderRequestRunner 异常分支', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreFetch()
  })

  describe('callChat', () => {
    it('网络错误重试 3 次后抛出网络错误文案', async () => {
      const restoreSetTimeout = installImmediateSetTimeout()
      try {
        const counter = installFetch(async () => {
          throw new TypeError('fetch failed')
        })

        await expect(
          getInternals(makeProvider()).callChat(makeMessages(), { scenario: 'test' }),
        ).rejects.toThrow(/请求发送失败（网络错误）/)

        expect(counter.count).toBe(3)
        expect(recordAIUsageMock).toHaveBeenLastCalledWith(
          'test',
          'deepseek',
          'DeepSeek',
          'deepseek-v4-pro',
          false,
        )
      } finally {
        restoreSetTimeout()
      }
    })

    it('响应 JSON 解析失败立即抛错且不重试', async () => {
      const counter = installFetch(async () =>
        baseResponse({ json: async () => Promise.reject(new Error('bad json')) }),
      )

      await expect(
        getInternals(makeProvider()).callChat(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/响应解析失败/)

      expect(counter.count).toBe(1)
    })

    it('JSON 模式空内容触发重试，第二次成功', async () => {
      const restoreSetTimeout = installImmediateSetTimeout()
      try {
        const counter = installSSESequence([
          () => jsonOk({ choices: [{ message: { content: '' } }] }),
          () => jsonOk({ choices: [{ message: { content: 'ok' } }] }),
        ])

        const result = await getInternals(makeProvider()).callChat(makeMessages(), {
          jsonMode: true,
          scenario: 'test',
        })

        expect(result).toBe('ok')
        expect(counter.count).toBe(2)
      } finally {
        restoreSetTimeout()
      }
    })

    it('非 JSON 模式空内容立即抛错', async () => {
      const counter = installFetch(async () =>
        jsonOk({ choices: [{ message: { content: '' } }] }),
      )

      await expect(
        getInternals(makeProvider()).callChat(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/未包含有效的文本内容/)

      expect(counter.count).toBe(1)
    })

    it('Token 统计抛错不影响返回并记录告警', async () => {
      recordUsageMock.mockImplementation(() => {
        throw new Error('stats down')
      })
      installFetch(async () =>
        jsonOk({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
      )

      const result = await getInternals(makeProvider()).callChat(makeMessages(), {
        scenario: 'test',
      })

      expect(result).toBe('ok')
      expect(recordUsageMock).toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalled()
      expect(recordAIUsageMock).toHaveBeenLastCalledWith(
        'test',
        'deepseek',
        'DeepSeek',
        'deepseek-v4-pro',
        true,
      )
    })
  })

  describe('callChatStream', () => {
    it('未配置密钥且无代理地址时立即抛错且不发起请求', async () => {
      const counter = installFetch(async () => {
        throw new Error('should not fetch')
      })

      await expect(
        getInternals(makeProvider('')).callChatStream(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/未配置 deepseek apiKey/)

      expect(counter.count).toBe(0)
    })

    it('外部 signal 中断：不重试并抛 AbortError', async () => {
      const controller = new AbortController()
      const counter = installFetch(async () => {
        controller.abort()
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      })

      await expect(
        getInternals(makeProvider()).callChatStream(makeMessages(), {
          scenario: 'test',
          signal: controller.signal,
          onChunk: vi.fn(),
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })

      expect(counter.count).toBe(1)
    })

    it('流式超时重试 3 次后抛出超时文案', async () => {
      const restoreSetTimeout = installImmediateSetTimeout()
      try {
        const counter = installFetch(async () => {
          const err = new Error('timeout')
          err.name = 'AbortError'
          throw err
        })

        await expect(
          getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
        ).rejects.toThrow(/流式请求超时/)

        expect(counter.count).toBe(3)
      } finally {
        restoreSetTimeout()
      }
    })

    it('流式网络错误重试 3 次后抛出网络错误文案', async () => {
      const restoreSetTimeout = installImmediateSetTimeout()
      try {
        const counter = installFetch(async () => {
          throw new TypeError('network down')
        })

        await expect(
          getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
        ).rejects.toThrow(/流式请求发送失败（网络错误）/)

        expect(counter.count).toBe(3)
      } finally {
        restoreSetTimeout()
      }
    })

    it('HTTP 500 重试 3 次后失败', async () => {
      const restoreSetTimeout = installImmediateSetTimeout()
      try {
        const counter = installFetch(async () => errorRes(500, 'Internal Server Error'))

        await expect(
          getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
        ).rejects.toThrow(/HTTP 500/)

        expect(counter.count).toBe(3)
      } finally {
        restoreSetTimeout()
      }
    })

    it('HTTP 402 不重试并返回余额不足文案', async () => {
      const counter = installFetch(async () => errorRes(402, 'Payment Required'))

      await expect(
        getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/余额不足/)

      expect(counter.count).toBe(1)
    })

    it('HTTP 400 不重试并返回请求体格式错误文案', async () => {
      const counter = installFetch(async () => errorRes(400, 'Bad Request'))

      await expect(
        getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/请求体格式错误/)

      expect(counter.count).toBe(1)
    })

    it('其他 HTTP 错误不重试并透传状态码', async () => {
      const counter = installFetch(async () => errorRes(404, 'Not Found'))

      await expect(
        getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/HTTP 404/)

      expect(counter.count).toBe(1)
    })

    it('响应 ok 但无 body 时按错误处理', async () => {
      const counter = installFetch(async () => baseResponse({ body: null }))

      await expect(
        getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/HTTP 200/)

      expect(counter.count).toBe(1)
    })

    it('流式成功时记录 Token 用量与来源', async () => {
      installFetch(async () =>
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n',
          'data: [DONE]\n\n',
        ]),
      )

      const result = await getInternals(makeProvider()).callChatStream(makeMessages(), {
        scenario: 'test',
      })

      expect(result).toBe('Hi')
      expect(recordUsageMock).toHaveBeenCalledWith(
        'test',
        'deepseek-v4-pro',
        {
          prompt_tokens: 10,
          completion_tokens: 3,
          prompt_cache_hit_tokens: undefined,
          prompt_cache_miss_tokens: undefined,
        },
        false,
      )
      expect(recordAIUsageMock).toHaveBeenLastCalledWith(
        'test',
        'deepseek',
        'DeepSeek',
        'deepseek-v4-pro',
        true,
      )
    })

    it('非 JSON 模式流式空内容立即抛错', async () => {
      const counter = installSSESequence([() => createSSEResponse(EMPTY_SSE_CHUNKS)])

      await expect(
        getInternals(makeProvider()).callChatStream(makeMessages(), { scenario: 'test' }),
      ).rejects.toThrow(/流式响应中未包含有效的文本内容/)

      expect(counter.count).toBe(1)
    })

    it('流式 Token 统计抛错不影响返回', async () => {
      recordUsageMock.mockImplementation(() => {
        throw new Error('stats down')
      })
      installFetch(async () =>
        createSSEResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          'data: [DONE]\n\n',
        ]),
      )

      const result = await getInternals(makeProvider()).callChatStream(makeMessages(), {
        scenario: 'test',
      })

      expect(result).toBe('Hi')
      expect(console.warn).toHaveBeenCalled()
    })

    it('首次流式内容为空但重试成功时一次性回传完整文本', async () => {
      const restoreSetTimeout = installImmediateSetTimeout()
      try {
        const counter = installSSESequence([
          () => createSSEResponse(EMPTY_SSE_CHUNKS),
          () => createSSEResponse(makeContentSSEChunks('retried')),
        ])
        const onChunk = vi.fn()

        const result = await getInternals(makeProvider()).callChatStream(makeMessages(), {
          jsonMode: true,
          scenario: 'test',
          onChunk,
        })

        expect(result).toBe('retried')
        expect(counter.count).toBe(2)
        expect(onChunk).toHaveBeenCalledWith('', '')
        expect(onChunk).toHaveBeenCalledWith('retried', 'retried')
      } finally {
        restoreSetTimeout()
      }
    })
  })
})
