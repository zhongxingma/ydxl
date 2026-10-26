// 自定义 API 优先 + DeepSeek 兜底降级策略测试
//
// 覆盖三类场景（对应「自定义 API 优先调用、DeepSeek 兜底」策略规格）：
// 1. 自定义 API 正常调用：仅请求主供应商，不触发兜底
// 2. 自定义 API 异常自动切换：主供应商失败（HTTP 错误/配置不可用）→ 自动以相同参数
//    调用 DeepSeek；DeepSeek 密钥未配置时抛回主供应商原始错误；两者均失败时抛聚合错误
// 3. DeepSeek 直调：用户选择 deepseek 时不包装降级层（由 dynamicProvider.test.ts 覆盖）
//
// 另覆盖流式边界：已向前端输出 chunk 后主供应商失败，不降级（防内容重复重放）
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  FallbackAIProvider,
  createUnavailableProvider,
} from '../fallbackProvider'
import { aiProvider } from '../index'
import { CustomProvider } from '../customProvider'
import { DeepSeekProvider } from '../deepseekProvider'
import { AIError } from '../types'
import type { AIProvider } from '../types'
import { restoreFetch, type FetchCall } from '@/test/setup'

const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'
const LS_KEY_CUSTOM_ENDPOINT = 'ydxl-ext-ai-custom-endpoint'
const LS_KEY_CUSTOM_MODEL = 'ydxl-ext-ai-custom-model'
const LS_KEY_SECURE_CUSTOM_KEY = 'ydxl-ext-ai-api-key-custom'
const LS_KEY_SECURE_DEEPSEEK_KEY = 'ydxl-ext-ai-api-key-deepseek'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

// 构造可编程假供应商：按方法名指定实现，未指定的方法抛「不应被调用」错误
function makeFakeProvider(
  impls: Partial<Record<keyof AIProvider, (...args: unknown[]) => unknown>>,
): AIProvider {
  const guard = async (...args: unknown[]): Promise<never> => {
    throw new AIError(`不应调用该方法（args: ${JSON.stringify(args.slice(0, 2))}）`)
  }
  const provider = {} as AIProvider
  for (const key of Object.keys(impls) as (keyof AIProvider)[]) {
    ;(provider as unknown as Record<string, unknown>)[key] = impls[key]
  }
  const methodNames: (keyof AIProvider)[] = [
    'generateArticle',
    'generateQuestions',
    'generateGrammarFillQuestions',
    'generateTranslation',
    'extractVocabulary',
    'extractArticlePhrases',
    'generateWordHint',
    'generateWordBreakdown',
    'generateMnemonic',
    'generateExampleSentence',
    'generateEmojiHint',
    'enrichSingleWord',
  ]
  for (const name of methodNames) {
    if (!impls[name]) {
      ;(provider as unknown as Record<string, unknown>)[name] = guard
    }
  }
  return provider
}

// 安装按 URL 路由的 fetch mock（custom 端点与 deepseek 端点返回不同响应）
function installRoutedFetchMock(
  routes: Record<string, { ok?: boolean; status?: number; json?: unknown }>,
): FetchCall[] {
  const calls: FetchCall[] = []
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: (init?.body ?? '') as string,
    })
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    const spec = route?.[1] ?? { status: 200, json: {} }
    return new Response(JSON.stringify(spec.json ?? {}), {
      status: spec.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  globalThis.fetch = mockFetch as unknown as typeof fetch
  return calls
}

// ---------- FallbackAIProvider 单元测试（假供应商，聚焦降级决策逻辑） ----------

describe('FallbackAIProvider 降级决策', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('主供应商成功时直接返回结果，不调用兜底供应商', async () => {
    const primary = makeFakeProvider({
      generateTranslation: async () => 'primary-result',
    })
    const fallback = makeFakeProvider({
      generateTranslation: async () => 'fallback-result',
    })
    const provider = new FallbackAIProvider(primary, fallback)
    const result = await provider.generateTranslation('hello')
    expect(result).toBe('primary-result')
  })

  it('主供应商失败时自动切换兜底供应商（相同参数透传）', async () => {
    const primary = makeFakeProvider({
      extractVocabulary: async () => {
        throw new AIError('HTTP 503 Service Unavailable')
      },
    })
    const fallback = makeFakeProvider({
      extractVocabulary: async (content: unknown) => [`vocab-of:${content}`] as never,
    })
    const provider = new FallbackAIProvider(primary, fallback)
    const result = await provider.extractVocabulary('article-body')
    expect(result).toEqual(['vocab-of:article-body'])
  })

  it('降级发生时输出 console.warn（避免静默吞错）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const primary = makeFakeProvider({
      generateTranslation: async () => {
        throw new AIError('custom 挂了')
      },
    })
    const fallback = makeFakeProvider({
      generateTranslation: async () => 'fallback-result',
    })
    const provider = new FallbackAIProvider(primary, fallback)
    await provider.generateTranslation('hello')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('generateTranslation 调用失败，自动切换 DeepSeek 兜底'),
      expect.any(AIError),
    )
  })

  it('兜底供应商密钥未配置时抛回主供应商原始错误（兜底不可用）', async () => {
    const primaryError = new AIError('自定义 API 请求失败：HTTP 500')
    const primary = makeFakeProvider({
      generateTranslation: async () => {
        throw primaryError
      },
    })
    const fallback = makeFakeProvider({
      generateTranslation: async () => {
        throw new AIError('未配置 deepseek apiKey 且未设置代理地址，无法发起请求')
      },
    })
    const provider = new FallbackAIProvider(primary, fallback)
    // 原始错误比「deepseek 未配置」更具诊断价值
    await expect(provider.generateTranslation('hello')).rejects.toThrow(/HTTP 500/)
  })

  it('主供应商与兜底均失败时抛聚合错误（含两侧错误摘要）', async () => {
    const primary = makeFakeProvider({
      generateTranslation: async () => {
        throw new AIError('自定义 API 请求失败：HTTP 503')
      },
    })
    const fallback = makeFakeProvider({
      generateTranslation: async () => {
        throw new AIError('DeepSeek 请求被限速')
      },
    })
    const provider = new FallbackAIProvider(primary, fallback)
    await expect(provider.generateTranslation('hello')).rejects.toThrow(
      /均调用失败.*\[自定义 API\].*HTTP 503.*\[DeepSeek\].*限速/s,
    )
  })

  it('流式输出 chunk 前主供应商失败 → 降级兜底并正常流式', async () => {
    // primary 在建立连接阶段即失败（尚未发出任何 chunk）
    const primary = makeFakeProvider({
      generateArticle: async () => {
        throw new AIError('连接超时')
      },
    })
    let fallbackChunks = 0
    const article = { title: 't', content: 'c', translation: '翻译', highlightedWords: ['a'] }
    const fallback = makeFakeProvider({
      generateArticle: async (
        _date: unknown,
        _genre: unknown,
        _topic: unknown,
        _difficulty: unknown,
        _avoid: unknown,
        streamOptions: unknown,
      ) => {
        const opts = streamOptions as { onChunk?: (d: string, f: string) => void }
        opts.onChunk?.('chunk-a', 'chunk-a')
        fallbackChunks++
        return article as never
      },
    })
    const provider = new FallbackAIProvider(primary, fallback)
    const chunks: string[] = []
    const result = await provider.generateArticle(
      '2026-08-29',
      undefined,
      undefined,
      undefined,
      undefined,
      { onChunk: (delta) => chunks.push(delta) },
    )
    expect(result).toEqual(article)
    expect(chunks).toEqual(['chunk-a'])
    expect(fallbackChunks).toBe(1)
  })

  it('流式已输出 chunk 后主供应商失败 → 不降级（防内容重复重放）', async () => {
    let fallbackCalled = false
    const primary = makeFakeProvider({
      generateArticle: async (
        _date: unknown,
        _genre: unknown,
        _topic: unknown,
        _difficulty: unknown,
        _avoid: unknown,
        streamOptions: unknown,
      ) => {
        // 先发出部分内容，再中途失败
        const opts = streamOptions as { onChunk?: (d: string, f: string) => void }
        opts.onChunk?.('partial', 'partial')
        throw new AIError('流式中断')
      },
    })
    const fallback = makeFakeProvider({
      generateArticle: async () => {
        fallbackCalled = true
        return { title: 't', content: 'c' } as never
      },
    })
    const provider = new FallbackAIProvider(primary, fallback)
    const chunks: string[] = []
    await expect(
      provider.generateArticle('2026-08-29', undefined, undefined, undefined, undefined, {
        onChunk: (delta) => chunks.push(delta),
      }),
    ).rejects.toThrow(/流式中断/)
    expect(chunks).toEqual(['partial'])
    expect(fallbackCalled).toBe(false)
  })

  it('所有方法在主供应商失败时调用兜底并透传参数', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls: Array<{ method: string; args: unknown[] }> = []
    const record = (method: string, result: unknown) =>
      async (...args: unknown[]) => {
        calls.push({ method, args })
        return result as never
      }

    const primary = makeFakeProvider({
      testConnection: async () => {
        throw new AIError('primary down')
      },
    })
    const fallback = makeFakeProvider({
      generateArticle: record('generateArticle', { title: 't', content: 'c' }),
      generateQuestions: record('generateQuestions', []),
      generateGrammarFillQuestions: record('generateGrammarFillQuestions', []),
      generateTranslation: record('generateTranslation', '译文'),
      extractVocabulary: record('extractVocabulary', []),
      extractArticlePhrases: record('extractArticlePhrases', []),
      generateWordHint: record('generateWordHint', { hint: 'h' }),
      generateWordBreakdown: record('generateWordBreakdown', { parts: [] }),
      generateMnemonic: record('generateMnemonic', { mnemonic: 'm' }),
      generateExampleSentence: record('generateExampleSentence', 'example'),
      generateEmojiHint: record('generateEmojiHint', ['🔥']),
      enrichSingleWord: record('enrichSingleWord', { word: 'w' }),
      testConnection: record('testConnection', undefined),
    })
    const provider = new FallbackAIProvider(primary, fallback)

    await expect(
      provider.generateArticle('2026-08-29', 'narrative', 'campus', 'medium', ['AI'])
    ).resolves.toMatchObject({ title: 't' })
    await expect(provider.generateQuestions('a1', 'body', 'narrative')).resolves.toEqual([])
    await expect(
      provider.generateGrammarFillQuestions('a1', 'body')
    ).resolves.toEqual([])
    await expect(provider.generateTranslation('hello')).resolves.toBe('译文')
    await expect(provider.extractVocabulary('body')).resolves.toEqual([])
    await expect(provider.extractArticlePhrases('body')).resolves.toEqual([])
    await expect(provider.generateWordHint('apple', '苹果')).resolves.toEqual({ hint: 'h' })
    await expect(provider.generateWordBreakdown('apple')).resolves.toEqual({ parts: [] })
    await expect(provider.generateMnemonic('apple', '苹果', 'apl')).resolves.toEqual({
      mnemonic: 'm',
    })
    await expect(provider.generateExampleSentence('apple', '苹果')).resolves.toBe('example')
    await expect(provider.generateEmojiHint('apple', '苹果')).resolves.toEqual(['🔥'])
    await expect(provider.enrichSingleWord('apple')).resolves.toEqual({ word: 'w' })
    await expect(provider.testConnection()).resolves.toBeUndefined()

    expect(calls.map((c) => c.method)).toEqual([
      'generateArticle',
      'generateQuestions',
      'generateGrammarFillQuestions',
      'generateTranslation',
      'extractVocabulary',
      'extractArticlePhrases',
      'generateWordHint',
      'generateWordBreakdown',
      'generateMnemonic',
      'generateExampleSentence',
      'generateEmojiHint',
      'enrichSingleWord',
      'testConnection',
    ])
    expect(calls[0].args.slice(0, 5)).toEqual([
      '2026-08-29',
      'narrative',
      'campus',
      'medium',
      ['AI'],
    ])
    expect(calls[1].args.slice(0, 3)).toEqual(['a1', 'body', 'narrative'])
    expect(calls[9].args).toEqual(['apple', '苹果'])
    expect(calls[10].args).toEqual(['apple', '苹果'])
  })

  it('问题生成在未输出 chunk 时失败仍会降级', async () => {
    const fallback = makeFakeProvider({
      generateQuestions: async () => [{ id: 'q1' }] as never,
    })
    const provider = new FallbackAIProvider(
      makeFakeProvider({
        generateQuestions: async () => {
          throw new AIError('primary questions down')
        },
      }),
      fallback,
    )

    await expect(provider.generateQuestions('a1', 'body', 'narrative')).resolves.toEqual([
      { id: 'q1' },
    ])
  })

  it('问题生成已输出 chunk 后失败不降级', async () => {
    let fallbackCalled = false
    const provider = new FallbackAIProvider(
      makeFakeProvider({
        generateQuestions: async (
          _id: unknown,
          _content: unknown,
          _genre: unknown,
          streamOptions: unknown,
        ) => {
          const opts = streamOptions as { onChunk?: (d: string, f: string) => void }
          opts.onChunk?.('partial', 'partial')
          throw new AIError('questions stream broken')
        },
      }),
      makeFakeProvider({
        generateQuestions: async () => {
          fallbackCalled = true
          return [] as never
        },
      }),
    )

    await expect(
      provider.generateQuestions('a1', 'body', undefined, {
        onChunk: () => {},
      })
    ).rejects.toThrow(/questions stream broken/)
    expect(fallbackCalled).toBe(false)
  })

  it('语法填空已输出 chunk 后失败不降级', async () => {
    let fallbackCalled = false
    const provider = new FallbackAIProvider(
      makeFakeProvider({
        generateGrammarFillQuestions: async (
          _id: unknown,
          _content: unknown,
          streamOptions: unknown,
        ) => {
          const opts = streamOptions as { onChunk?: (d: string, f: string) => void }
          opts.onChunk?.('partial', 'partial')
          throw new AIError('grammar stream broken')
        },
      }),
      makeFakeProvider({
        generateGrammarFillQuestions: async () => {
          fallbackCalled = true
          return [] as never
        },
      }),
    )

    await expect(
      provider.generateGrammarFillQuestions('a1', 'body', { onChunk: () => {} })
    ).rejects.toThrow(/grammar stream broken/)
    expect(fallbackCalled).toBe(false)
  })

  it('自定义标签用于降级日志与聚合错误', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = new FallbackAIProvider(
      makeFakeProvider({
        generateTranslation: async () => {
          throw new AIError('primary boom')
        },
      }),
      makeFakeProvider({
        generateTranslation: async () => {
          throw new AIError('fallback boom')
        },
      }),
      'SiliconFlow',
      'DeepSeek'
    )

    await expect(provider.generateTranslation('x')).rejects.toThrow(
      /SiliconFlow 与兜底 DeepSeek 均调用失败/
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SiliconFlow.generateTranslation'),
      expect.any(AIError)
    )
  })
})

// ---------- createUnavailableProvider 测试 ----------

describe('createUnavailableProvider', () => {
  it('所有方法均抛出指定原因的 AIError', async () => {
    const provider = createUnavailableProvider('自定义模型未配置完整')
    await expect(provider.generateTranslation('x')).rejects.toThrow(/自定义模型未配置完整/)
    await expect(provider.extractVocabulary('x')).rejects.toThrow(/自定义模型未配置完整/)
    await expect(provider.enrichSingleWord('x')).rejects.toThrow(/自定义模型未配置完整/)
  })

  it('作为 primary 与可用兜底组合时自动降级', async () => {
    const fallback = makeFakeProvider({
      generateTranslation: async () => 'from-deepseek',
    })
    const provider = new FallbackAIProvider(
      createUnavailableProvider('自定义模型未配置完整'),
      fallback,
    )
    const result = await provider.generateTranslation('hello')
    expect(result).toBe('from-deepseek')
  })
})

// ---------- 端到端集成测试（真实 Provider + 按 URL 路由 fetch mock） ----------

describe('自定义 API → DeepSeek 端到端降级', () => {
  afterEach(() => {
    restoreFetch()
    window.localStorage.removeItem(LS_KEY_AI_PROVIDER)
    window.localStorage.removeItem(LS_KEY_CUSTOM_ENDPOINT)
    window.localStorage.removeItem(LS_KEY_CUSTOM_MODEL)
    window.localStorage.removeItem(LS_KEY_SECURE_CUSTOM_KEY)
    window.localStorage.removeItem(LS_KEY_SECURE_DEEPSEEK_KEY)
  })

  it('custom 返回 401 时自动降级 DeepSeek 并成功返回', async () => {
    // 模拟用户配置：供应商 custom + 完整端点/模型/密钥，DeepSeek 密钥可用
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'custom')
    window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://openrouter.ai/api/v1')
    window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, 'nvidia/nemotron-3-ultra-550b-a55b:free')
    window.localStorage.setItem(LS_KEY_SECURE_CUSTOM_KEY, 'sk-or-invalid')
    window.localStorage.setItem(LS_KEY_SECURE_DEEPSEEK_KEY, 'sk-deepseek-valid')

    // 按 URL 路由：openrouter 返回 401（key 失效），deepseek 返回正常结果
    const calls = installRoutedFetchMock({
      'https://openrouter.ai': { ok: false, status: 401, json: { error: 'invalid key' } },
      'https://api.deepseek.com': {
        json: { choices: [{ message: { content: 'deepseek-兜底结果' } }] },
      },
    })

    const result = await aiProvider.generateTranslation('e2e-fallback-a')
    expect(result).toBe('deepseek-兜底结果')
    // 两次请求分别命中 custom 与 deepseek 端点（401 不可重试，无额外重试请求）
    expect(calls.map((c) => c.url)).toEqual([OPENROUTER_URL, DEEPSEEK_URL])
  })

  it('custom 成功时不触发 DeepSeek（仅一次请求）', async () => {
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'custom')
    window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://openrouter.ai/api/v1')
    window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, 'nvidia/nemotron-3-ultra-550b-a55b:free')
    window.localStorage.setItem(LS_KEY_SECURE_CUSTOM_KEY, 'sk-or-valid')

    const calls = installRoutedFetchMock({
      'https://openrouter.ai': {
        json: { choices: [{ message: { content: 'custom-正常结果' } }] },
      },
    })

    const result = await aiProvider.generateTranslation('e2e-fallback-b')
    expect(result).toBe('custom-正常结果')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(OPENROUTER_URL)
  })

  it('custom 与 deepseek 均无密钥时抛回主供应商原始错误', async () => {
    // custom 请求成功返回 500（可重试错误会内部重试，这里用 402 不可重试快速失败）
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'custom')
    window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://openrouter.ai/api/v1')
    window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, 'nvidia/nemotron-3-ultra-550b-a55b:free')
    window.localStorage.setItem(LS_KEY_SECURE_CUSTOM_KEY, 'sk-or-any')
    // 未设置 deepseek 密钥（env 已被 vitest.config.ts 清空）

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    installRoutedFetchMock({
      'https://openrouter.ai': { ok: false, status: 402, json: {} },
      'https://api.deepseek.com': {
        json: { choices: [{ message: { content: 'never' } }] },
      },
    })

    // deepseek 无密钥 → 抛回 custom 的原始错误（402 余额不足的中文化错误消息）
    await expect(aiProvider.generateTranslation('e2e-fallback-c')).rejects.toThrow(/余额不足/)
    vi.restoreAllMocks()
  })

  it('FallbackAIProvider 直连组合：custom 402 → deepseek 成功（真实 Provider 组合）', async () => {
    // 验证 FallbackAIProvider 对真实 Provider 实例组合的兼容性
    const custom = new CustomProvider({
      endpoint: 'https://openrouter.ai/api/v1',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      apiKey: 'sk-or-broke',
    })
    const deepseek = new DeepSeekProvider({ apiKey: 'sk-deepseek-ok' })
    const provider = new FallbackAIProvider(custom, deepseek)

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = installRoutedFetchMock({
      'https://openrouter.ai': { ok: false, status: 402, json: {} },
      'https://api.deepseek.com': {
        json: { choices: [{ message: { content: 'real-provider-fallback' } }] },
      },
    })

    const result = await provider.generateTranslation('e2e-real-combo')
    expect(result).toBe('real-provider-fallback')
    expect(calls.map((c) => c.url)).toEqual([OPENROUTER_URL, DEEPSEEK_URL])
    // deepseek 请求使用 deepseek 模型（而非透传 custom 模型 ID）；
    // generateTranslation 为简单任务，按模型分级使用 flash 模型
    const dsBody = JSON.parse(calls[1].body) as { model: string }
    expect(dsBody.model).toBe('deepseek-v4-flash')
    vi.restoreAllMocks()
  })
})
