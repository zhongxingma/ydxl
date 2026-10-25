// AI Provider 缓存与去重
//
// callChatCached 的二级缓存命中与 inflight 请求去重。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'

describe('AI Provider 缓存与去重', () => {
  it('generateWordBreakdown 第二次调用同 word 不发 fetch（缓存命中）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [{ message: { content: JSON.stringify({ phonics: ['ap', 'ple'], syllables: 2 }) } }],
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 第一次调用：发起 fetch
      const result1 = await provider.generateWordBreakdown('apple')
      expect(result1.phonics).toEqual(['ap', 'ple'])
      expect(calls.length).toBe(1)
      // 第二次调用同 word：应命中缓存，不发起 fetch
      const result2 = await provider.generateWordBreakdown('apple')
      expect(result2.phonics).toEqual(['ap', 'ple'])
      expect(calls.length).toBe(1) // 仍为 1
    } finally {
      restoreFetch()
    }
  })

  it('generateEmojiHint 并发两次同 word 只发一次 fetch（inflight 去重）', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(['🍎']) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 并发两次调用同 word+definition
      const [result1, result2] = await Promise.all([
        provider.generateEmojiHint('apple', '苹果'),
        provider.generateEmojiHint('apple', '苹果'),
      ])
      expect(result1).toEqual(['🍎'])
      expect(result2).toEqual(['🍎'])
      // inflight 去重：应只发一次 fetch
      expect(calls.length).toBe(1)
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 两次调用应发两次 fetch（不缓存）', async () => {
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

  it('不同 word 的 generateWordBreakdown 应分别发 fetch（不同 cacheKey）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [{ message: { content: JSON.stringify({ phonics: ['a'], syllables: 1 }) } }],
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateWordBreakdown('apple')
      await provider.generateWordBreakdown('banana')
      // 不同 word 不同 cacheKey，应发两次 fetch
      expect(calls.length).toBe(2)
    } finally {
      restoreFetch()
    }
  })
})
