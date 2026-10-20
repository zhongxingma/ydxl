// AI 代理契约测试
//
// 验证 DeepSeekProvider 在代理模式下发送的请求体格式与后端 ProxyRequestBody 解析一致。
// 后端（server/src/ai-proxy.ts）期望代理模式请求体为信封结构：
//   { provider: 'deepseek', body: <上游原始请求体> }
//
// 已迁移到 vitest 风格（globals 模式），fetch mock 工具迁移至 src/test/setup.ts
//
// 测试覆盖：
// - DeepSeekProvider 代理模式：fetch body 应为 { provider: 'deepseek', body: { model, messages, max_tokens? } }
// - URL 拼接：proxyBaseUrl 为 /api 时请求 URL 应为 /api/v1/ai-proxy/deepseek
// - JSON 模式：jsonMode=true 时请求体应包含 response_format: { type: 'json_object' }
// - 纯文本模式：默认 jsonMode=false 时请求体不应包含 response_format
// - 模型名默认值：未指定 model 时应使用 deepseek-v4-pro
// - max_tokens 参数：各方法按场景配置不同 max_tokens 值
// - thinking 禁用：简单 JSON 方法应附加 thinking: { type: 'disabled' }；复杂方法不附加
// - 429 限速重试：第一次 429，第二次 200 → 应重试成功
// - 429 带 retry_after 字段：应使用该值（秒→毫秒）作为退避时间
// - 402 余额不足：不重试，直接抛出明确错误
// - 503 服务器繁忙：触发重试

import { type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, installFetchMockSequence, installImmediateSetTimeout, restoreFetch } from '@/test/setup'

describe('AI 代理契约测试', () => {
  // 静默 baseProvider.ts 中的 console.debug 请求/响应日志，避免测试输出噪音
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  // ===== DeepSeekProvider 代理模式契约 =====

  it('DeepSeekProvider 代理模式：fetch body 应为 { provider, body: { model, messages, max_tokens } } 信封结构', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
        model: 'deepseek-v4-pro',
      })
      await provider.generateTranslation('hello')

      // 验证 URL 拼接：proxyBaseUrl + /v1/ai-proxy/deepseek
      expect(calls[0].url).toBe('/api/v1/ai-proxy/deepseek')

      // 验证请求体结构（信封格式）
      const body = JSON.parse(calls[0].body) as {
        provider: string
        body: {
          model: string
          messages: ChatMessage[]
          max_tokens?: number
          response_format?: { type: string }
          thinking?: { type: string }
        }
      }
      expect(body.provider).toBe('deepseek')
      // 注：generateTranslation 为简单任务，按模型分级策略降级到 deepseek-v4-flash（覆盖 config.model）
      expect(body.body.model).toBe('deepseek-v4-flash')
      expect(Array.isArray(body.body.messages)).toBe(true)
      expect(body.body.messages.length).toBe(2)
      expect(body.body.messages[0].role).toBe('system')
      expect(body.body.messages[1].role).toBe('user')
      expect(body.body.messages[0].content.length > 0).toBe(true)
      // Phase 2 fine-tune: generateTranslation maxTokens 2048 → 768（典型 ~500 token，1.5x 上限）
      expect(body.body.max_tokens).toBe(768)
      // 纯文本场景不应有 response_format
      expect(body.body.response_format).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  // ===== URL 拼接契约（含尾部斜杠处理）=====

  it('代理模式 URL 拼接：proxyBaseUrl 含尾部斜杠时应正确去除并拼接 /v1/ai-proxy/deepseek', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api/',
        apiKey: 'proxy-token',
      })
      await provider.generateTranslation('hello')
      expect(calls[0].url).toBe('/api/v1/ai-proxy/deepseek')
    } finally {
      restoreFetch()
    }
  })

  // ===== JSON 模式契约（jsonMode + response_format）=====

  it('JSON 模式：generateArticle 应附加 response_format 与 max_tokens: 3072（Phase 2 fine-tune）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'T',
                content: 'C',
                translation: 'T',
                genre: 'narrative',
                wordCount: 10,
                topic: 'campus',
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
              }),
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
      await provider.generateArticle('2026-07-14')

      const body = JSON.parse(calls[0].body) as {
        provider: string
        body: {
          model: string
          messages: ChatMessage[]
          max_tokens?: number
          response_format?: { type: string }
          thinking?: { type: string }
        }
      }
      // 验证 JSON 模式已启用
      expect(body.body.response_format).toBeDefined()
      expect(body.body.response_format?.type).toBe('json_object')
      // Phase 2 fine-tune: max_tokens 4096 → 3072（典型 ~2000 token，1.5x 上限）
      expect(body.body.max_tokens).toBe(3072)
      // Phase 2 关闭思考：文章结构由 JSON schema 严格约束，附加 thinking: { type: 'disabled' }
      expect(body.body.thinking).toEqual({ type: 'disabled' })
    } finally {
      restoreFetch()
    }
  })

  it('纯文本模式：generateTranslation 不应附加 response_format', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: '翻译结果' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
        model: 'deepseek-v4-pro',
      })
      await provider.generateTranslation('hello')

      const body = JSON.parse(calls[0].body) as {
        body: {
          response_format?: { type: string }
        }
      }
      // 验证纯文本场景未启用 JSON 模式
      expect(body.body.response_format).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  // ===== max_tokens 与 thinking 参数契约（Task 5）=====

  it('enrichSingleWord：请求体应包含 max_tokens: 1024 与 thinking: { type: "disabled" }（2026-07-26 修复生词补全失败）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                word: 'brave',
                phonetic: '/breɪv/',
                pos: 'adj.',
                definition: '勇敢的',
                example: 'a brave boy',
                importance: 'high',
              }),
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
      await provider.enrichSingleWord('brave')

      const body = JSON.parse(calls[0].body) as {
        provider: string
        body: {
          model: string
          messages: ChatMessage[]
          max_tokens?: number
          response_format?: { type: string }
          thinking?: { type: string }
        }
      }
      // 验证 JSON 模式已启用
      expect(body.body.response_format?.type).toBe('json_object')
      // 2026-07-26 修复：max_tokens 512 → 1024（含 0-3 个 phrases 时实际需求 350-600 token，512 临界值会截断）
      expect(body.body.max_tokens).toBe(1024)
      // 验证思考模式已禁用（简单 JSON 任务无需推理，降低延迟）
      expect(body.body.thinking).toBeDefined()
      expect(body.body.thinking?.type).toBe('disabled')
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle：请求体应包含 max_tokens: 3072 与 thinking: { type: "disabled" }（Phase 2）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'T',
                content: 'C',
                translation: 'T',
                genre: 'narrative',
                wordCount: 10,
                topic: 'campus',
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
              }),
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
      await provider.generateArticle('2026-07-14')

      const body = JSON.parse(calls[0].body) as {
        body: {
          max_tokens?: number
          thinking?: { type: string }
        }
      }
      // Phase 2 fine-tune: max_tokens 4096 → 3072（典型 ~2000 token，1.5x 上限）
      expect(body.body.max_tokens).toBe(3072)
      // Phase 2 关闭思考：文章结构由 JSON schema 严格约束，附加 thinking: { type: 'disabled' }
      expect(body.body.thinking).toEqual({ type: 'disabled' })
    } finally {
      restoreFetch()
    }
  })

  it('默认模型名：未指定 model 时应使用 deepseek-v4-pro', async () => {
    // 注：使用 generateArticle（复杂任务）验证 defaultModel()，因其不触发模型分级降级
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'T',
                content: 'C',
                translation: 'T',
                genre: 'narrative',
                wordCount: 10,
                topic: 'campus',
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
              }),
            },
          },
        ],
      },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      await provider.generateArticle('2026-07-14')

      const body = JSON.parse(calls[0].body) as {
        body: { model: string }
      }
      expect(body.body.model).toBe('deepseek-v4-pro')
    } finally {
      restoreFetch()
    }
  })

  it('generateEmojiHint：请求体应包含 thinking: { type: "disabled" } 与 max_tokens: 256（第三方模型截断防护）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify(['☀️', '🌞']),
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
      await provider.generateEmojiHint('sun', '太阳')

      const body = JSON.parse(calls[0].body) as {
        body: {
          max_tokens?: number
          thinking?: { type: string }
          response_format?: { type: string }
        }
      }
      // 2026-08-29: max_tokens 64 → 256——推理型第三方模型会先输出思考内容，
      // 64 tokens 极易截断导致 JSON 不完整（连接测试报「无法解析为 JSON」根因之一）
      expect(body.body.max_tokens).toBe(256)
      expect(body.body.thinking?.type).toBe('disabled')
      expect(body.body.response_format?.type).toBe('json_object')
    } finally {
      restoreFetch()
    }
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

  // ===== 2026-07-26 修复练习题生成失败：generateQuestions 禁用思考模式契约 =====

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
      // 2026-07-26 修复：思考模式 + JSON Output 模式存在内容截断与空 content 问题，
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
