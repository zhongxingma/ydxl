// vocabularyService 缓存持久化
//
// extractAndCacheVocabulary 写入的缓存字段、缓存命中与离线回退。
// 由 vocabularyService.cache.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import { aiProvider } from '@/shared/services/ai'
import { extractAndCacheVocabulary } from '../vocabularyService'
import { CACHE_KEY_PREFIX, installArticleRepoMock, restoreArticleRepoMock, installAIMock, restoreAIMock, clearCache, readRawCache, makeArticle } from './vocabularyServiceTestMocks'

describe('vocabularyService 缓存持久化', () => {
  // 每个用例前后安装/恢复 articleRepository mock（验证文章实体持久化）
  beforeEach(() => {
    installArticleRepoMock()
  })
  afterEach(() => {
    restoreArticleRepoMock()
  })

  // 1. 缓存包含 exampleTranslation 字段
  // 验证 AI 提取词汇时返回的 exampleTranslation 被完整写入 localStorage
  it('缓存包含 exampleTranslation 字段（AI 提取词汇的例句翻译）', async () => {
    const articleId = 'test-vocab-translation'
    clearCache(articleId)
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        importance: 'high',
        exampleTranslation: '一个勇敢的男孩',
      },
    ]
    installAIMock({ baseItems, exampleSentence: 'The brave soldier fought.', emojiHint: ['💪'] })

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证返回值包含 exampleTranslation
      expect(result[0].exampleTranslation).toBe('一个勇敢的男孩')
      // 验证 localStorage 缓存包含 exampleTranslation
      const raw = readRawCache(articleId) as Array<{ exampleTranslation?: string }>
      expect(raw).not.toBeNull()
      expect(raw[0].exampleTranslation).toBe('一个勇敢的男孩')
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 2. 缓存包含 exampleSentence 与 exampleSentenceTranslation 字段（增强阶段生成）
  it('缓存包含 exampleSentence 与 exampleSentenceTranslation（增强阶段生成的真题例句与翻译）', async () => {
    const articleId = 'test-vocab-sentence'
    clearCache(articleId)
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'ocean',
        phonetic: '/ˈəʊʃn/',
        pos: 'n.',
        definition: '海洋',
        example: 'the Pacific Ocean',
        importance: 'high',
      },
    ]
    installAIMock({
      baseItems,
      exampleSentence: 'The ocean stretches to the horizon.',
      exampleSentenceTranslation: '海洋一直延伸到地平线。',
      emojiHint: ['🌊'],
    })

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证返回值包含 exampleSentence 与 exampleSentenceTranslation
      expect(result[0].exampleSentence).toBe('The ocean stretches to the horizon.')
      expect(result[0].exampleSentenceTranslation).toBe('海洋一直延伸到地平线。')
      // 验证 localStorage 缓存包含这两个字段
      const raw = readRawCache(articleId) as Array<{
        exampleSentence?: string
        exampleSentenceTranslation?: string
      }>
      expect(raw).not.toBeNull()
      expect(raw[0].exampleSentence).toBe('The ocean stretches to the horizon.')
      expect(raw[0].exampleSentenceTranslation).toBe('海洋一直延伸到地平线。')
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 3. 缓存包含 emojiHint 字段（增强阶段生成）
  it('缓存包含 emojiHint 字段（增强阶段生成的 emoji 助记）', async () => {
    const articleId = 'test-vocab-emoji'
    clearCache(articleId)
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'happy',
        phonetic: '/ˈhæpi/',
        pos: 'adj.',
        definition: '快乐的',
        example: 'a happy day',
        importance: 'medium',
      },
    ]
    installAIMock({
      baseItems,
      exampleSentence: 'She felt happy on her birthday.',
      emojiHint: ['😊', '🎉'],
    })

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证返回值包含 emojiHint 数组
      expect(result[0].emojiHint).toEqual(['😊', '🎉'])
      // 验证 localStorage 缓存包含 emojiHint
      const raw = readRawCache(articleId) as Array<{ emojiHint?: string[] }>
      expect(raw).not.toBeNull()
      expect(raw[0].emojiHint).toEqual(['😊', '🎉'])
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 4. 缓存命中时直接返回，不调用 AI（离线可读）
  // 验证断网场景：已有缓存时直接返回缓存数据，不触发 AI 调用
  it('缓存命中时直接返回，不调用 AI（离线可读）', async () => {
    const articleId = 'test-vocab-offline'
    clearCache(articleId)

    // 预置缓存：直接写入 localStorage
    const cachedItems = [
      {
        word: 'cached',
        phonetic: '/kæʃt/',
        pos: 'adj.',
        definition: '已缓存的',
        example: 'cached data',
        importance: 'low' as const,
        exampleTranslation: '已缓存的数据',
        exampleSentence: 'This data is cached.',
        emojiHint: ['💾'],
      },
    ]
    localStorage.setItem(CACHE_KEY_PREFIX + articleId, JSON.stringify(cachedItems))

    // 安装 AI mock，若被调用则抛错（缓存命中时不应调用 AI）
    installAIMock({
      baseItems: [],
      exampleSentence: '',
      emojiHint: [],
    })
    // 重写 extractVocabulary 为抛错版本（确保不被调用）
    aiProvider.extractVocabulary = async () => {
      throw new Error('缓存命中时不应调用 AI extractVocabulary')
    }

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证返回的是缓存数据（包含所有字段）
      expect(result).toHaveLength(1)
      expect(result[0].word).toBe('cached')
      expect(result[0].exampleTranslation).toBe('已缓存的数据')
      expect(result[0].exampleSentence).toBe('This data is cached.')
      expect(result[0].emojiHint).toEqual(['💾'])
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 5. 缓存包含所有新字段的完整持久化
  // 验证 exampleTranslation + exampleSentence + exampleSentenceTranslation + emojiHint 同时存在
  it('缓存包含所有新字段（exampleTranslation + exampleSentence + exampleSentenceTranslation + emojiHint）', async () => {
    const articleId = 'test-vocab-all-fields'
    clearCache(articleId)
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'adventure',
        phonetic: '/ədˈventʃə(r)/',
        pos: 'n.',
        definition: '冒险',
        example: 'an adventure story',
        importance: 'high',
        exampleTranslation: '一个冒险故事',
      },
    ]
    installAIMock({
      baseItems,
      exampleSentence: 'The adventure began at dawn.',
      exampleSentenceTranslation: '冒险在黎明时分开始。',
      emojiHint: ['🗺️', '⛰️', '🧭'],
    })

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证返回值包含所有新字段
      expect(result[0].exampleTranslation).toBe('一个冒险故事')
      expect(result[0].exampleSentence).toBe('The adventure began at dawn.')
      expect(result[0].exampleSentenceTranslation).toBe('冒险在黎明时分开始。')
      expect(result[0].emojiHint).toEqual(['🗺️', '⛰️', '🧭'])

      // 验证 localStorage 缓存包含所有新字段
      const raw = readRawCache(articleId) as Array<{
        exampleTranslation?: string
        exampleSentence?: string
        exampleSentenceTranslation?: string
        emojiHint?: string[]
      }>
      expect(raw).not.toBeNull()
      expect(raw[0].exampleTranslation).toBe('一个冒险故事')
      expect(raw[0].exampleSentence).toBe('The adventure began at dawn.')
      expect(raw[0].exampleSentenceTranslation).toBe('冒险在黎明时分开始。')
      expect(raw[0].emojiHint).toEqual(['🗺️', '⛰️', '🧭'])
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })
})
