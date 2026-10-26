//
// 1. 第一次空内容 → 重试成功：fetch 调用 2 次，onChunk 在重试成功后一次性发送完整文本
// 2. 重试 2 次仍空 → 抛出 AIError（RetryableAIError 子类，fetch 调用 3 次）
// 3. 外部 signal 中断不重试：抛出 AbortError，不触发重试
// 4. generateQuestions 流式失败降级非流式：返回有效题目，onChunk('', '') 被调用（UI 重置）
// 5. generateArticle 流式失败降级非流式：返回有效文章
//
// Mock 策略：
// - SSE 流测试：mock 全局 fetch 返回 ReadableStream 模拟 SSE 响应
// - 降级测试：spyOn 实例的 callChatStream / callChat / callChatCached 方法（protected，需类型断言）

import { describe, it, expect, vi, afterEach } from 'vitest'
import { AIError, type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import {
  installImmediateSetTimeout,
  restoreFetch,
} from '@/test/setup'
import type { ArticleGenerationResult, QuestionGenerationResult } from '../types'

// ---------- SSE 流 mock 工具 ----------

// 构造 SSE Response：将字符串数组编码为 ReadableStream，包装为 Response
// 每次调用返回新的 Response（ReadableStream 仅可读一次，重试场景需新建）
function createSSEResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/event-stream' },
  })
}

// 空内容 SSE：只有 delta:{} 与 [DONE]，无 content chunk
const EMPTY_SSE_CHUNKS = [
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
]

// 构造含有效内容的 SSE chunks
function makeContentSSEChunks(content: string): string[] {
  return [
    `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\n`,
    'data: [DONE]\n\n',
  ]
}

// 安装 SSE fetch mock：每次 fetch 调用对应 factory 生成新的 Response（避免 stream 复用问题）
// signal 已 aborted 时抛出 AbortError，模拟真实 fetch 行为
function installSSEFetchMock(responseFactories: Array<() => Response>): {
  count: number
} {
  const counter = { count: 0 }
  let responseIndex = 0
  const mockFetch = async (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    counter.count++
    const signal = init?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const factory =
      responseFactories[Math.min(responseIndex, responseFactories.length - 1)]
    responseIndex++
    return factory()
  }
  globalThis.fetch = mockFetch as unknown as typeof fetch
  return counter
}

// ---------- protected 方法访问辅助 ----------

interface CallChatStreamOptions {
  jsonMode?: boolean
  maxTokens?: number
  thinkingDisabled?: boolean
  modelOverride?: string
  reasoningEffort?: 'high' | 'max'
  scenario?: string
  signal?: AbortSignal
  onChunk?: (delta: string, fullText: string) => void
}

interface CallChatOptions {
  jsonMode?: boolean
  maxTokens?: number
  thinkingDisabled?: boolean
  modelOverride?: string
  reasoningEffort?: 'high' | 'max'
  scenario?: string
}

interface CallChatCachedOptions extends CallChatOptions {
  ttlMs: number
}

type CallChatStreamFn = (
  messages: ChatMessage[],
  options: CallChatStreamOptions
) => Promise<string>

type CallChatFn = (
  messages: ChatMessage[],
  options?: CallChatOptions
) => Promise<string>

type CallChatCachedFn = (
  scenario: string,
  messages: ChatMessage[],
  options: CallChatCachedOptions
) => Promise<string>

// 通过类型断言访问 protected 方法，便于在测试中 spyOn
function getInternals(provider: DeepSeekProvider): {
  callChatStream: CallChatStreamFn
  callChat: CallChatFn
  callChatCached: CallChatCachedFn
} {
  return provider as unknown as {
    callChatStream: CallChatStreamFn
    callChat: CallChatFn
    callChatCached: CallChatCachedFn
  }
}

function makeProvider(): DeepSeekProvider {
  return new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
}

function makeMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'system message' },
    { role: 'user', content: 'user message' },
  ]
}

// ---------- 测试 ----------

describe('callChatStream 空内容重试与降级', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    restoreFetch()
  })

  // 1. 第一次空内容 → 重试成功
  it('第一次空内容 → 重试成功：fetch 调用 2 次，重试成功后 onChunk(fullText, fullText) 被调用一次', async () => {
    const restoreSetTimeout = installImmediateSetTimeout()
    const validContent = '[{"phrase":"test","meaning":"测试"}]'
    const fetchCounter = installSSEFetchMock([
      () => createSSEResponse(EMPTY_SSE_CHUNKS), // 首次：空内容
      () => createSSEResponse(makeContentSSEChunks(validContent)), // 重试：有效内容
    ])

    const provider = makeProvider()
    const onChunk = vi.fn()

    try {
      const result = await getInternals(provider).callChatStream(makeMessages(), {
        jsonMode: true,
        scenario: 'test',
        onChunk,
      })

      // 验证 fetch 调用 2 次（首次空 + 重试成功）
      expect(fetchCounter.count).toBe(2)
      // 验证返回有效文本
      expect(result).toBe(validContent)

      // 验证 onChunk('', '') 被调用（首次失败时 UI 重置信号）
      const resetCall = onChunk.mock.calls.find(
        (call) => call[0] === '' && call[1] === ''
      )
      expect(resetCall).toBeDefined()

      // 验证 onChunk(fullText, fullText) 被调用一次（重试成功后一次性发送完整文本）
      const fullTextCalls = onChunk.mock.calls.filter(
        (call) => call[0] === validContent && call[1] === validContent
      )
      expect(fullTextCalls.length).toBe(1)
    } finally {
      restoreSetTimeout()
    }
  })

  // 2. 重试 2 次仍空 → 抛出 AIError（RetryableAIError 子类）
  it('重试 2 次仍空 → 抛出 AIError，fetch 调用 3 次（1 初始 + 2 重试）', async () => {
    const restoreSetTimeout = installImmediateSetTimeout()
    const fetchCounter = installSSEFetchMock([
      () => createSSEResponse(EMPTY_SSE_CHUNKS),
      () => createSSEResponse(EMPTY_SSE_CHUNKS),
      () => createSSEResponse(EMPTY_SSE_CHUNKS),
    ])

    const provider = makeProvider()
    const onChunk = vi.fn()

    try {
      await expect(
        getInternals(provider).callChatStream(makeMessages(), {
          jsonMode: true,
          scenario: 'test',
          onChunk,
        })
      ).rejects.toThrow(AIError)

      // 验证 fetch 调用 3 次（1 初始 + 2 重试）
      expect(fetchCounter.count).toBe(3)
    } finally {
      restoreSetTimeout()
    }
  })

  // 3. 外部 signal 中断不重试
  it('外部 signal 中断：fetch 最多调用 1 次，不重试，抛出错误（AbortError）', async () => {
    const restoreSetTimeout = installImmediateSetTimeout()
    const fetchCounter = installSSEFetchMock([
      () => createSSEResponse(EMPTY_SSE_CHUNKS),
    ])

    const provider = makeProvider()
    const onChunk = vi.fn()
    const controller = new AbortController()
    controller.abort()

    try {
      await expect(
        getInternals(provider).callChatStream(makeMessages(), {
          jsonMode: true,
          scenario: 'test',
          signal: controller.signal,
          onChunk,
        })
      ).rejects.toThrow()

      // 验证 fetch 最多调用 1 次（不重试）
      expect(fetchCounter.count).toBeLessThanOrEqual(1)

      // 验证抛出的是 AbortError（name === 'AbortError'）
      try {
        await getInternals(provider).callChatStream(makeMessages(), {
          jsonMode: true,
          scenario: 'test',
          signal: controller.signal,
          onChunk,
        })
      } catch (err) {
        expect((err as Error).name).toBe('AbortError')
      }
    } finally {
      restoreSetTimeout()
    }
  })

  // 4. generateQuestions 流式失败降级非流式
  it('generateQuestions 流式失败降级非流式：返回有效题目，onChunk("", "") 被调用（UI 重置）', async () => {
    const provider = makeProvider()
    const internals = getInternals(provider)

    const questions: QuestionGenerationResult[] = [
      {
        id: 'art-1-1',
        type: 'main_idea',
        stem: '文章的主旨是什么？',
        options: ['选项A', '选项B', '选项C', '选项D'],
        correctIndex: 0,
        explanation: '解析说明',
        locationClue: '第一段',
      },
    ]

    // mock callChatStream 抛错（重试耗尽，非 AbortError）
    vi.spyOn(internals, 'callChatStream').mockRejectedValue(
      new AIError('流式重试耗尽')
    )
    // mock callChatCached 返回有效题目 JSON
    vi.spyOn(internals, 'callChatCached').mockResolvedValue(
      JSON.stringify(questions)
    )

    const onChunk = vi.fn()
    const result = await provider.generateQuestions('art-1', 'article contents', undefined, {
      onChunk,
    })

    // 验证返回有效题目
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('art-1-1')
    expect(result[0].stem).toBe('文章的主旨是什么？')

    // 验证 onChunk('', '') 被调用（UI 重置信号，切换到备选方案状态）
    expect(onChunk).toHaveBeenCalledWith('', '')

    // 验证 callChatCached 被调用（降级到非流式 + 7 天缓存）
    expect(internals.callChatCached).toHaveBeenCalled()
    const cachedCallArgs = (
      internals.callChatCached as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]
    expect(cachedCallArgs[0]).toBe('questions') // scenario
    expect((cachedCallArgs[2] as CallChatCachedOptions).ttlMs).toBe(
      Infinity // 永久缓存
    )
  })

  // 5. generateArticle 流式失败降级非流式
  it('generateArticle 流式失败降级非流式：返回有效文章', async () => {
    const provider = makeProvider()
    const internals = getInternals(provider)

    const article: ArticleGenerationResult = {
      title: 'The Brave Boy',
      content: 'Once there was a brave boy who saved a cat from a tall tree.',
      translation: '从前有一个勇敢的男孩，从高高的树上救下了一只猫。',
      genre: 'narrative',
      wordCount: 14,
      topic: 'biography',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
      highlightedWords: [
        {
          word: 'brave',
          phonetic: '/breɪv/',
          pos: 'adj.',
          definition: '勇敢的',
          example: 'a brave boy',
        },
      ],
    }

    // mock callChatStream 抛错（重试耗尽，非 AbortError）
    vi.spyOn(internals, 'callChatStream').mockRejectedValue(
      new AIError('流式重试耗尽')
    )
    // mock callChat 返回有效文章 JSON
    vi.spyOn(internals, 'callChat').mockResolvedValue(JSON.stringify(article))

    const onChunk = vi.fn()
    const result = await provider.generateArticle(
      '2024-01-01',
      undefined,
      undefined,
      undefined,
      undefined,
      { onChunk }
    )

    // 验证返回有效文章
    expect(result.title).toBe('The Brave Boy')
    expect(result.content).toBe(
      'Once there was a brave boy who saved a cat from a tall tree.'
    )
    expect(result.translation).toBe('从前有一个勇敢的男孩，从高高的树上救下了一只猫。')
    expect(result.genre).toBe('narrative')
    expect(result.topic).toBe('biography')

    // 验证 onChunk('', '') 被调用（UI 重置信号）
    expect(onChunk).toHaveBeenCalledWith('', '')

    // 验证 callChat 被调用（降级到非流式）
    expect(internals.callChat).toHaveBeenCalled()
  })

  // 6. generateGrammarFillQuestions 非流式成功
  it('generateGrammarFillQuestions 非流式：返回有效语法题并透传缓存参数', async () => {
    const provider = makeProvider()
    const internals = getInternals(provider)

    const grammarQuestions: QuestionGenerationResult[] = [
      {
        id: 'art-1-g1',
        type: 'grammar_fill',
        stem: 'He ______ to school every day.',
        options: ['go', 'goes', 'going', 'gone'],
        correctIndex: 1,
        explanation: '第三人称单数用 goes',
        locationClue: '第一段',
      },
    ]

    vi.spyOn(internals, 'callChatCached').mockResolvedValue(
      JSON.stringify(grammarQuestions)
    )

    const result = await provider.generateGrammarFillQuestions('art-1', 'article body')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('art-1-g1')
    const cachedCall = vi.mocked(internals.callChatCached).mock.calls[0]
    expect(cachedCall[0]).toBe('grammar_fill')
    expect(cachedCall[2].ttlMs).toBe(Infinity)
    expect(cachedCall[2].maxTokens).toBe(4096)
  })

  // 7. generateGrammarFillQuestions 流式失败降级非流式
  it('generateGrammarFillQuestions 流式失败降级非流式：返回有效语法题', async () => {
    const provider = makeProvider()
    const internals = getInternals(provider)

    const grammarQuestions: QuestionGenerationResult[] = [
      {
        id: 'art-1-g1',
        type: 'grammar_fill',
        stem: 'She ______ a student.',
        options: ['is', 'are', 'am', 'be'],
        correctIndex: 0,
        explanation: '主语为第三人称单数',
        locationClue: '第一段',
      },
    ]

    vi.spyOn(internals, 'callChatStream').mockRejectedValue(new AIError('流式重试耗尽'))
    vi.spyOn(internals, 'callChatCached').mockResolvedValue(
      JSON.stringify(grammarQuestions)
    )

    const onChunk = vi.fn()
    const result = await provider.generateGrammarFillQuestions('art-1', 'article body', {
      onChunk,
    })

    expect(result).toHaveLength(1)
    expect(onChunk).toHaveBeenCalledWith('', '')
    expect(internals.callChatCached).toHaveBeenCalled()
  })

  // 8. generateGrammarFillQuestions 外部中断不降级
  it('generateGrammarFillQuestions 流式 AbortError 不降级（包装为 AIError 抛出）', async () => {
    const provider = makeProvider()
    const internals = getInternals(provider)
    const abortErr = new Error('请求被外部中断')
    abortErr.name = 'AbortError'

    vi.spyOn(internals, 'callChatStream').mockRejectedValue(abortErr)
    const cachedSpy = vi.spyOn(internals, 'callChatCached')

    await expect(
      provider.generateGrammarFillQuestions('art-1', 'article body', { onChunk: vi.fn() })
    ).rejects.toThrow(/请求被外部中断/)

    expect(cachedSpy).not.toHaveBeenCalled()
  })

  // 9. generateQuestions 空数组直接报错
  it('generateQuestions 空数组 → 抛出非空数组错误', async () => {
    const provider = makeProvider()
    const internals = getInternals(provider)

    vi.spyOn(internals, 'callChatCached').mockResolvedValue('[]')

    await expect(provider.generateQuestions('art-1', 'article body')).rejects.toThrow(
      /不是有效的非空数组/
    )
  })
})
