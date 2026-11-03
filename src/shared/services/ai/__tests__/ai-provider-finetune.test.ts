// AI Provider 请求参数调优
//
// reasoning_effort 与 thinkingDisabled 与 max_tokens fine-tune。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'

describe('reasoning_effort 与 thinkingDisabled 与 max_tokens fine-tune', () => {
  // 静默 baseProvider.ts 中的 console.debug 请求/响应日志，避免测试输出噪音
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })


  it('extractVocabulary 请求体应包含 thinking: { type: "disabled" }（机械任务关闭思考）', async () => {
    const vocabulary = [
      {
        word: 'adventure',
        phonetic: '/ədˈventʃər/',
        pos: 'n.',
        definition: '冒险',
        example: 'an adventure story',
        exampleTranslation: '一个冒险故事',
        importance: 'high',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(vocabulary) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.extractVocabulary('Some article content with adventure word.')
      const body = JSON.parse(calls[0].body) as {
        thinking?: { type: string }
        reasoning_effort?: string
      }
      expect(body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort
      expect(body.reasoning_effort).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 请求体应包含 thinking: { type: "disabled" }', async () => {
    const article = {
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
    }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateArticle('2026-07-26')
      const body = JSON.parse(calls[0].body) as {
        thinking?: { type: string }
        reasoning_effort?: string
      }
      expect(body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort
      expect(body.reasoning_effort).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  it('generateQuestions 请求体应包含 thinking: { type: "disabled" } 且不包含 reasoning_effort（2026-07-26 改进）', async () => {
    const questions = [
      {
        id: 'q-1',
        type: 'main_idea',
        stem: '题干',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '解析',
        locationClue: '线索',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(questions) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateQuestions('art-1', 'article content')
      const body = JSON.parse(calls[0].body) as {
        thinking?: { type: string }
        reasoning_effort?: string
      }
      // 思考模式 + JSON Output 模式存在内容截断与空 content 问题，
      // 改为禁用思考以保证稳定性（与 generateArticle / extractVocabulary 一致策略）
      expect(body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort（互斥语义）
      expect(body.reasoning_effort).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })


  it('generateArticle 请求体 max_tokens === 3072', async () => {
    const article = {
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
    }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateArticle('2026-07-26')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      expect(body.max_tokens).toBe(3072)
    } finally {
      restoreFetch()
    }
  })

  it('generateQuestions 请求体 max_tokens === 3072（2026-07-26 修复练习题生成失败）', async () => {
    const questions = [
      {
        id: 'q-1',
        type: 'main_idea',
        stem: '题干',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '解析',
        locationClue: '线索',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(questions) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateQuestions('art-1', 'article content')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      // 思考模式禁用后，3072 足以覆盖 5 题完整 JSON（典型 ~1500 token，1.5x 上限 3072）
      expect(body.max_tokens).toBe(3072)
    } finally {
      restoreFetch()
    }
  })

  it('extractVocabulary 请求体 max_tokens === 1536', async () => {
    const vocabulary = [
      {
        word: 'adventure',
        phonetic: '/ədˈventʃər/',
        pos: 'n.',
        definition: '冒险',
        example: 'an adventure story',
        exampleTranslation: '一个冒险故事',
        importance: 'high',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(vocabulary) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.extractVocabulary('Some article content with adventure word.')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      expect(body.max_tokens).toBe(1536)
    } finally {
      restoreFetch()
    }
  })

  it('generateWordBreakdown 请求体 max_tokens === 128', async () => {
    const breakdown = { phonics: ['ap', 'ple'], syllables: 2 }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(breakdown) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateWordBreakdown('apple')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      expect(body.max_tokens).toBe(128)
    } finally {
      restoreFetch()
    }
  })


  it('buildRequestBody 传入 reasoningEffort: "high" 时请求体包含 reasoning_effort: "high"', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'hi' }],
      { reasoningEffort: 'high' }
    ) as { reasoning_effort?: string; thinking?: { type: string } }
    expect(body.reasoning_effort).toBe('high')
    // 未传 thinkingDisabled 时不应附加 thinking 字段
    expect(body.thinking).toBeUndefined()
  })

  it('buildRequestBody 传入 reasoningEffort: "max" 时请求体包含 reasoning_effort: "max"', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'hi' }],
      { reasoningEffort: 'max' }
    ) as { reasoning_effort?: string }
    expect(body.reasoning_effort).toBe('max')
  })

  it('buildRequestBody 同时传入 thinkingDisabled: true 与 reasoningEffort: "high" 时仅含 thinking: { type: "disabled" }，不含 reasoning_effort', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'hi' }],
      { thinkingDisabled: true, reasoningEffort: 'high' }
    ) as { reasoning_effort?: string; thinking?: { type: string } }
    // thinking 禁用优先：附加 thinking 字段
    expect(body.thinking).toEqual({ type: 'disabled' })
    // thinking 禁用时忽略 reasoning_effort
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('buildRequestBody 未传 reasoningEffort 时不附加 reasoning_effort 字段', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody([{ role: 'user', content: 'hi' }]) as {
      reasoning_effort?: string
    }
    expect(body.reasoning_effort).toBeUndefined()
  })
})
