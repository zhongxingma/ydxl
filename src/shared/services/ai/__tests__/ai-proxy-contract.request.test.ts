// AI 代理契约：JSON 模式与请求参数
//
// response_format、max_tokens、thinkingDisabled、默认模型名等请求体契约。
// 由 ai-proxy-contract.test.ts 按契约分组拆分而来，用例内容与断言未改动。

import { type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'

describe('AI 代理契约：JSON 模式与请求参数', () => {
  // 静默 baseProvider.ts 中的 console.debug 请求/响应日志，避免测试输出噪音
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
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

})
