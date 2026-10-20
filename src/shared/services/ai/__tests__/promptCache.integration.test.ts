// AI Prompt Cache 集成测试
//
// 端到端验证 callChatCached 的缓存命中、inflight 去重、Token 统计等机制
// 覆盖以下场景：
// 1. 连续两次同 word 调用 → 第二次从缓存返回（fetch 次数为 1）
// 2. 不同 scenario 同 word → 不同 cacheKey，分别发请求
// 3. 缓存命中后 tokenStats 的 cacheHitRate === 1
// 4. localStorage 清空后重新调用 → 正常发请求并重建缓存
// 5. generateArticle 不缓存（两次调用 fetch 次数为 2）
// 6. 并发 3 次同 word → inflight 去重（fetch 次数为 1）

import { AIError } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import {
  installFetchMock,
  installFetchMockSequence,
  restoreFetch,
} from '@/test/setup'
import { clearCache } from '../responseCache'
import { getStats, resetStats } from '../tokenStats'

// 测试前清空缓存与统计
beforeEach(() => {
  clearCache()
  resetStats()
})

afterEach(() => {
  clearCache()
  resetStats()
})

describe('AI Prompt Cache 集成测试', () => {
  // 场景 1：连续两次同 word 调用 → 第二次从缓存返回
  it('场景 1：连续两次 generateWordBreakdown 同 word，第二次从缓存返回', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({ phonics: ['ap', 'ple'], syllables: 2 }),
            },
          },
        ],
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      const r1 = await provider.generateWordBreakdown('apple')
      const r2 = await provider.generateWordBreakdown('apple')
      expect(r1.phonics).toEqual(['ap', 'ple'])
      expect(r2.phonics).toEqual(['ap', 'ple'])
      // 第二次应命中缓存，fetch 次数仍为 1
      expect(calls.length).toBe(1)
    } finally {
      restoreFetch()
    }
  })

  // 场景 2：不同 scenario 同 word → 不同 cacheKey，分别发请求
  it('场景 2：generateEmojiHint + enrichSingleWord 同 word，分别发请求', async () => {
    // 序列 mock：第 1 次返回 emoji 数组，第 2 次返回 wordInfo（不同 scenario 触发新请求）
    const calls = installFetchMockSequence([
      {
        json: { choices: [{ message: { content: JSON.stringify(['🍎']) } }] },
      },
      {
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  word: 'apple',
                  phonetic: '/ˈæpl/',
                  pos: 'n.',
                  definition: '苹果',
                  example: 'I like apple.',
                  exampleTranslation: '我喜欢苹果。',
                  phrases: [],
                }),
              },
            },
          ],
        },
      },
    ])
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // emojiHint 第 1 次：发请求
      await provider.generateEmojiHint('apple', '苹果')
      // emojiHint 第 2 次：命中缓存，不发请求
      await provider.generateEmojiHint('apple', '苹果')
      // enrichSingleWord：不同 scenario → 不同 cacheKey → 发新请求
      await provider.enrichSingleWord('apple')
      // 共 2 次 fetch（emojiHint 1 次 + enrichSingleWord 1 次）
      expect(calls.length).toBe(2)
    } finally {
      restoreFetch()
    }
  })

  // 场景 3：缓存命中后 tokenStats 的 cacheHitRate === 1
  it('场景 3：缓存命中后 tokenStats 的 cacheHitRate 为 1', async () => {
    // mock 返回带 usage 字段的响应，便于统计
    const calls = installFetchMock({
      json: {
        choices: [
          { message: { content: JSON.stringify({ phonics: ['a'], syllables: 1 }) } },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 第一次：未命中，发请求
      await provider.generateWordBreakdown('apple')
      // 第二次：命中缓存
      await provider.generateWordBreakdown('apple')
      // 第三次：再次命中缓存
      await provider.generateWordBreakdown('apple')

      const stats = getStats()
      const wordBreakdownStats = stats.byScenario['wordBreakdown']
      expect(wordBreakdownStats).toBeDefined()
      expect(wordBreakdownStats.totalCalls).toBe(3)
      expect(wordBreakdownStats.cacheHits).toBe(2)
      expect(wordBreakdownStats.cacheHitRate).toBeCloseTo(2 / 3, 5)
      // fetch 次数应为 1
      expect(calls.length).toBe(1)
    } finally {
      restoreFetch()
    }
  })

  // 场景 4：localStorage 清空后重新调用 → 正常发请求并重建缓存
  it('场景 4：localStorage 清空后重新调用，正常发请求并重建缓存', async () => {
    const calls = installFetchMock({
      json: {
        choices: [
          { message: { content: JSON.stringify({ phonics: ['a'], syllables: 1 }) } },
        ],
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 第一次：写入缓存
      await provider.generateWordBreakdown('apple')
      expect(calls.length).toBe(1)
      // 第二次：命中缓存
      await provider.generateWordBreakdown('apple')
      expect(calls.length).toBe(1)
      // 清空缓存
      clearCache()
      // 第三次：缓存已清空，应重新发请求
      await provider.generateWordBreakdown('apple')
      expect(calls.length).toBe(2)
      // 第四次：再次命中缓存
      await provider.generateWordBreakdown('apple')
      expect(calls.length).toBe(2)
    } finally {
      restoreFetch()
    }
  })

  // 场景 5：generateArticle 不缓存（两次调用 fetch 次数为 2）
  it('场景 5：generateArticle 两次调用应发两次 fetch（不缓存）', async () => {
    const article = {
      title: 'Test',
      content: 'Test content.',
      translation: '测试',
      genre: 'narrative',
      wordCount: 2,
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
      await provider.generateArticle('2024-01-01')
      await provider.generateArticle('2024-01-01')
      // 文章生成不缓存，应发两次 fetch
      expect(calls.length).toBe(2)
    } finally {
      restoreFetch()
    }
  })

  // 场景 6：并发 3 次同 word → inflight 去重（fetch 次数为 1）
  it('场景 6：并发 3 次 enrichSingleWord 同 word，仅发 1 次 fetch', async () => {
    const wordInfo = {
      word: 'apple',
      phonetic: '/ˈæpl/',
      pos: 'n.',
      definition: '苹果',
      example: 'I like apple.',
      exampleTranslation: '我喜欢苹果。',
      phrases: [],
    }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(wordInfo) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 并发 3 次同 word
      const [r1, r2, r3] = await Promise.all([
        provider.enrichSingleWord('apple'),
        provider.enrichSingleWord('apple'),
        provider.enrichSingleWord('apple'),
      ])
      // 都应成功返回
      expect(r1.word).toBe('apple')
      expect(r2.word).toBe('apple')
      expect(r3.word).toBe('apple')
      // inflight 去重：应只发一次 fetch
      expect(calls.length).toBe(1)
    } finally {
      restoreFetch()
    }
  })

  // 场景 7：缓存命中不影响错误重试逻辑
  it('场景 7：缓存未命中时 5xx 重试机制仍正常工作', async () => {
    const { installFetchMockSequence } = await import('@/test/setup')
    const { installImmediateSetTimeout } = await import('@/test/setup')
    const calls = installFetchMockSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error' },
      { ok: false, status: 500, statusText: 'Internal Server Error' },
      { ok: false, status: 500, statusText: 'Internal Server Error' },
    ])
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 第一次调用：3 次 fetch 全部 500，应抛出 AIError
      await expect(provider.generateWordBreakdown('apple')).rejects.toThrow(AIError)
      expect(calls.length).toBe(3)
      // 缓存不应被写入（失败响应不缓存）
      // 第二次调用同 word：应再次发请求（不命中缓存）
      await expect(provider.generateWordBreakdown('apple')).rejects.toThrow(AIError)
      // 又 3 次 fetch
      expect(calls.length).toBe(6)
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })
})
