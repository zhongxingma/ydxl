// vocabularyService 异常与降级分支单元测试
//
// 覆盖场景：
// 1. 词汇缓存 JSON 损坏时回退重新生成
// 2. 缓存写入失败 / 文章实体写回失败时仍返回结果
// 3. 例句 / emoji / 翻译生成失败时字段降级为空
// 4. AI 返回结构异常时回退文章基础词汇；无基础词汇时返回空数组
//
// Mock 策略：复用 vocabularyServiceTestMocks 的仓储与 AI mock，
// 逐用例覆写单个方法模拟失败。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Article, ArticleVocabulary } from '@/shared/types'
import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import { aiProvider } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import {
  CACHE_KEY_PREFIX,
  installArticleRepoMock,
  restoreArticleRepoMock,
  installAIMock,
  restoreAIMock,
  clearCache,
  makeArticle,
} from './vocabularyServiceTestMocks'
import { extractAndCacheVocabulary } from '../vocabularyService'

const baseItems: AIVocabularyItem[] = [
  {
    word: 'brave',
    phonetic: '/breɪv/',
    pos: 'adj.',
    definition: '勇敢的',
    example: 'a brave boy',
    importance: 'high',
  },
]

function makeBaseVocabulary(): ArticleVocabulary[] {
  return [
    {
      word: 'brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      importance: 'high',
    },
  ]
}

function makeArticleWithVocabulary(id: string): Article {
  return { ...makeArticle(id), vocabulary: makeBaseVocabulary() }
}

describe('vocabularyService 异常与降级', () => {
  const articleId = 'test-vocab-errors'

  beforeEach(() => {
    installArticleRepoMock()
    clearCache(articleId)
  })

  afterEach(() => {
    restoreArticleRepoMock()
    restoreAIMock()
    vi.restoreAllMocks()
    clearCache(articleId)
  })

  it('缓存 JSON 损坏时回退 AI 提取', async () => {
    localStorage.setItem(CACHE_KEY_PREFIX + articleId, '{broken json')
    installAIMock({ baseItems, exampleSentence: 'A brave soldier.', emojiHint: ['💪'] })

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result).toHaveLength(1)
    expect(result[0].word).toBe('brave')
  })

  it('缓存写入失败时仍返回增强结果', async () => {
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith(CACHE_KEY_PREFIX)) throw new Error('quota exceeded')
      return originalSetItem.call(this, key, value)
    })
    installAIMock({ baseItems, exampleSentence: 'A brave soldier.', emojiHint: ['💪'] })

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result[0].exampleSentence).toBe('A brave soldier.')
  })

  it('文章实体写回失败时仍返回增强结果', async () => {
    installAIMock({ baseItems, exampleSentence: 'A brave soldier.', emojiHint: ['💪'] })
    articleRepository.update = async () => {
      throw new Error('server down')
    }

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result).toHaveLength(1)
    expect(result[0].exampleSentence).toBe('A brave soldier.')
  })

  it('例句与 emoji 生成失败时降级为空字段', async () => {
    installAIMock({ baseItems })
    aiProvider.generateExampleSentence = async () => {
      throw new Error('sentence failed')
    }
    aiProvider.generateEmojiHint = async () => {
      throw new Error('emoji failed')
    }

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result[0].exampleSentence).toBe('')
    expect(result[0].exampleSentenceTranslation).toBe('')
    expect(result[0].emojiHint).toEqual([])
  })

  it('例句翻译失败时仅该字段为空', async () => {
    installAIMock({ baseItems, exampleSentence: 'A brave soldier.', emojiHint: ['💪'] })
    aiProvider.generateTranslation = async () => {
      throw new Error('translate failed')
    }

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result[0].exampleSentence).toBe('A brave soldier.')
    expect(result[0].exampleSentenceTranslation).toBe('')
  })

  it('AI 返回非数组时回退文章基础词汇', async () => {
    installAIMock({ baseItems: [] })
    aiProvider.extractVocabulary = async () => 'not-an-array' as never

    const result = await extractAndCacheVocabulary(makeArticleWithVocabulary(articleId))

    expect(result).toEqual(makeBaseVocabulary())
  })

  it('AI 返回非数组且无基础词汇时返回空数组', async () => {
    installAIMock({ baseItems: [] })
    aiProvider.extractVocabulary = async () => undefined as never

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result).toEqual([])
  })

  it('AI 提取失败且无基础词汇时返回空数组', async () => {
    installAIMock({ baseItems: [] })
    aiProvider.extractVocabulary = async () => {
      throw new Error('AI down')
    }

    const result = await extractAndCacheVocabulary(makeArticle(articleId))

    expect(result).toEqual([])
  })
})
