// vocabularyService 文章实体持久化
//
// 文章实体已有词汇时直接返回、AI 生成后写回、旧缓存迁移、增强字段与失败回退。
// 由 vocabularyService.cache.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import { aiProvider } from '@/shared/services/ai'
import { extractAndCacheVocabulary } from '../vocabularyService'
import { CACHE_KEY_PREFIX, updateCalls, installArticleRepoMock, restoreArticleRepoMock, installAIMock, restoreAIMock, clearCache, readRawCache, makeArticle } from './vocabularyServiceTestMocks'

describe('vocabularyService 文章实体持久化', () => {
  // 每个用例前后安装/恢复 articleRepository mock（验证文章实体持久化）
  beforeEach(() => {
    installArticleRepoMock()
  })
  afterEach(() => {
    restoreArticleRepoMock()
  })

  // 6. 文章实体已含 vocabulary → 直接返回，不调 AI、不写库
  it('文章实体已含 vocabulary → 直接返回，不调 AI 也不重复写回', async () => {
    const articleId = 'test-vocab-entity'
    clearCache(articleId)
    const persistedItems = [
      {
        word: 'persisted',
        phonetic: '/pəˈsɪstɪd/',
        pos: 'adj.',
        definition: '已持久化的',
        example: 'persisted vocabulary',
        importance: 'medium' as const,
        exampleSentence: 'The vocabulary is persisted.',
        exampleSentenceTranslation: '词汇已持久化保存。',
        emojiHint: ['💾'],
      },
    ]
    const article = makeArticle(articleId)
    article.vocabulary = persistedItems

    // AI 被调用则抛错（实体已含词汇时不应调用）
    aiProvider.extractVocabulary = async () => {
      throw new Error('实体已含 vocabulary 时不应调用 AI extractVocabulary')
    }

    try {
      const result = await extractAndCacheVocabulary(article)

      // 验证返回的是文章实体持久化的词汇
      expect(result).toHaveLength(1)
      expect(result[0].word).toBe('persisted')
      expect(result[0].exampleSentence).toBe('The vocabulary is persisted.')
      expect(result[0].exampleSentenceTranslation).toBe('词汇已持久化保存。')
      // 验证未重复写回文章实体
      expect(updateCalls.length).toBe(0)
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 7. AI 生成后写回文章实体（vocabulary 字段持久化全部显示内容）
  it('AI 生成后写回文章实体（vocabulary 字段含全部显示内容）', async () => {
    const articleId = 'test-vocab-persist'
    clearCache(articleId)
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'journey',
        phonetic: '/ˈdʒɜːni/',
        pos: 'n.',
        definition: '旅程',
        example: 'a long journey',
        importance: 'high',
        exampleTranslation: '一段漫长的旅程',
      },
    ]
    installAIMock({
      baseItems,
      exampleSentence: 'The journey took three days.',
      exampleSentenceTranslation: '这段旅程花了三天。',
      emojiHint: ['🚶', '🗺️'],
    })

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证写回文章实体一次，且携带全部显示内容
      expect(updateCalls.length).toBe(1)
      expect(updateCalls[0].id).toBe(articleId)
      const persisted = updateCalls[0].vocabulary as Array<{
        word: string
        exampleTranslation?: string
        exampleSentence?: string
        exampleSentenceTranslation?: string
        emojiHint?: string[]
      }>
      expect(persisted).toHaveLength(1)
      expect(persisted[0].word).toBe('journey')
      expect(persisted[0].exampleTranslation).toBe('一段漫长的旅程')
      expect(persisted[0].exampleSentence).toBe('The journey took three days.')
      expect(persisted[0].exampleSentenceTranslation).toBe('这段旅程花了三天。')
      expect(persisted[0].emojiHint).toEqual(['🚶', '🗺️'])
      // 返回值与持久化内容一致
      expect(result[0].word).toBe(persisted[0].word)
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 8. localStorage 旧缓存命中 → 迁移写回文章实体（旧数据升级）
  it('localStorage 旧缓存命中 → 迁移写回文章实体', async () => {
    const articleId = 'test-vocab-migrate'
    clearCache(articleId)
    const cachedItems = [
      {
        word: 'legacy',
        phonetic: '/ˈleɡəsi/',
        pos: 'n.',
        definition: '遗产；旧数据',
        example: 'legacy cache data',
        importance: 'low' as const,
        exampleSentence: 'Legacy data is migrated.',
        emojiHint: ['📦'],
      },
    ]
    localStorage.setItem(CACHE_KEY_PREFIX + articleId, JSON.stringify(cachedItems))

    // AI 被调用则抛错（缓存命中时不应调用）
    aiProvider.extractVocabulary = async () => {
      throw new Error('缓存命中时不应调用 AI extractVocabulary')
    }

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))

      // 验证返回缓存数据
      expect(result).toHaveLength(1)
      expect(result[0].word).toBe('legacy')
      // 验证旧数据被迁移写回文章实体
      expect(updateCalls.length).toBe(1)
      expect(updateCalls[0].id).toBe(articleId)
      expect((updateCalls[0].vocabulary as Array<{ word: string }>)[0].word).toBe('legacy')
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 9. 文章实体含基础版 vocabulary（保存文章时由高亮生词转换，缺增强字段）
  //    → 不直接返回，继续走 AI 提取增强流程并覆盖写回
  it('文章实体含基础版 vocabulary（缺增强字段）→ 走 AI 增强并覆盖写回', async () => {
    const articleId = 'test-vocab-basic-entity'
    clearCache(articleId)
    // 基础版：不含 exampleSentence / emojiHint 字段（buildVocabularyFromHighlighted 产物）
    const basicItems = [
      {
        word: 'brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        importance: 'high' as const,
      },
    ]
    const article = makeArticle(articleId)
    article.vocabulary = basicItems

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
    installAIMock({
      baseItems,
      exampleSentence: 'The brave soldier fought.',
      exampleSentenceTranslation: '这位勇敢的士兵战斗了。',
      emojiHint: ['💪'],
    })

    try {
      const result = await extractAndCacheVocabulary(article)

      // 验证返回的是 AI 增强后的数据（含增强字段）
      expect(result).toHaveLength(1)
      expect(result[0].exampleTranslation).toBe('一个勇敢的男孩')
      expect(result[0].exampleSentence).toBe('The brave soldier fought.')
      expect(result[0].exampleSentenceTranslation).toBe('这位勇敢的士兵战斗了。')
      expect(result[0].emojiHint).toEqual(['💪'])
      // 验证增强后覆盖写回文章实体
      expect(updateCalls.length).toBe(1)
      expect(updateCalls[0].id).toBe(articleId)
      const persisted = updateCalls[0].vocabulary as Array<{
        word: string
        exampleSentence?: string
        exampleSentenceTranslation?: string
        emojiHint?: string[]
      }>
      expect(persisted[0].exampleSentence).toBe('The brave soldier fought.')
      expect(persisted[0].exampleSentenceTranslation).toBe('这位勇敢的士兵战斗了。')
      expect(persisted[0].emojiHint).toEqual(['💪'])
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 10. 文章实体含基础版 vocabulary 且 AI 提取失败 → 回退返回基础版（不返回空数组）
  it('基础版 vocabulary + AI 提取失败 → 回退返回基础版数据', async () => {
    const articleId = 'test-vocab-basic-fallback'
    clearCache(articleId)
    const basicItems = [
      {
        word: 'brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        importance: 'high' as const,
      },
    ]
    const article = makeArticle(articleId)
    article.vocabulary = basicItems

    // AI 提取抛错（模拟断网/AI 服务不可用）
    aiProvider.extractVocabulary = async () => {
      throw new Error('AI 服务不可用')
    }

    try {
      const result = await extractAndCacheVocabulary(article)

      // 验证回退返回基础版数据（与重点短语的可用性一致，页面仍有数据可显示）
      expect(result).toHaveLength(1)
      expect(result[0].word).toBe('brave')
      expect(result[0].example).toBe('a brave boy')
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })

  // 10.5. 例句为空时跳过翻译（避免无效 AI 调用）
  it('例句为空时跳过翻译生成（exampleSentenceTranslation 为空字符串）', async () => {
    const articleId = 'test-vocab-empty-sentence'
    clearCache(articleId)
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'mute',
        phonetic: '/mjuːt/',
        pos: 'adj.',
        definition: '沉默的',
        example: 'a mute response',
        importance: 'low',
      },
    ]
    // generateExampleSentence 返回空字符串（AI 降级）
    installAIMock({
      baseItems,
      exampleSentence: '',
      emojiHint: [],
    })

    try {
      const result = await extractAndCacheVocabulary(makeArticle(articleId))
      expect(result).toHaveLength(1)
      expect(result[0].exampleSentence).toBe('')
      // 例句为空时不触发翻译，exampleSentenceTranslation 应为空字符串
      expect(result[0].exampleSentenceTranslation).toBe('')

      // 验证缓存写入
      const raw = readRawCache(articleId) as Array<{
        exampleSentence?: string
        exampleSentenceTranslation?: string
      }>
      expect(raw).not.toBeNull()
      expect(raw[0].exampleSentence).toBe('')
      expect(raw[0].exampleSentenceTranslation).toBe('')
    } finally {
      restoreAIMock()
      clearCache(articleId)
    }
  })
})
