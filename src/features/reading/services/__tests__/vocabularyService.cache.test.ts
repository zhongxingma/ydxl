// vocabularyService 缓存持久化测试（Task 9.4）
//
// 验证 extractAndCacheVocabulary 写入的本地缓存包含所有新字段：
// - exampleTranslation（AI 提取词汇时的例句中文翻译）
// - exampleSentence（增强阶段生成的真题例句）
// - emojiHint（增强阶段生成的 emoji 助记）
//
// 缓存策略：localStorage（key 为 `ydxl-vocab-${articleId}`），JSON 序列化包含全部字段。
// 离线场景：缓存命中时直接返回，不调用 AI（断网仍可查看词汇列表）。
//
// Mock 策略：
// 1. aiProvider.extractVocabulary：返回含 exampleTranslation 的基础词汇
// 2. aiProvider.generateExampleSentence / generateEmojiHint：返回增强字段
// 3. localStorage：使用 jsdom 内置实现，测试后清理 key

import type { Article } from '@/shared/types'
import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import { aiProvider } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import { extractAndCacheVocabulary, buildVocabularyFromHighlighted } from '../vocabularyService'

// localStorage 缓存 key 前缀（与 vocabularyService 保持一致）
const CACHE_KEY_PREFIX = 'ydxl-vocab-'

// ---------- articleRepository mock（记录 update 调用，验证文章实体持久化） ----------

// 记录 update(articleId, patch) 调用
const updateCalls: Array<{ id: string; vocabulary?: unknown }> = []

// 保存原始方法引用，便于恢复
const originalUpdate = articleRepository.update

function installArticleRepoMock(): void {
  updateCalls.length = 0
  articleRepository.update = async (id, patch) => {
    updateCalls.push({ id, vocabulary: (patch as { vocabulary?: unknown }).vocabulary })
    return {} as Article
  }
}

function restoreArticleRepoMock(): void {
  articleRepository.update = originalUpdate
}

// 保存原始方法引用，便于恢复
const originalExtractVocabulary = aiProvider.extractVocabulary
const originalGenerateExampleSentence = aiProvider.generateExampleSentence
const originalGenerateEmojiHint = aiProvider.generateEmojiHint
const originalGenerateTranslation = aiProvider.generateTranslation

// 安装 aiProvider mock
function installAIMock(options: {
  baseItems: AIVocabularyItem[]
  exampleSentence?: string
  emojiHint?: string[]
  exampleSentenceTranslation?: string
}): void {
  aiProvider.extractVocabulary = async () => options.baseItems
  aiProvider.generateExampleSentence = async () => options.exampleSentence ?? ''
  aiProvider.generateEmojiHint = async () => options.emojiHint ?? []
  aiProvider.generateTranslation = async () => options.exampleSentenceTranslation ?? ''
}

// 恢复原始方法
function restoreAIMock(): void {
  aiProvider.extractVocabulary = originalExtractVocabulary
  aiProvider.generateExampleSentence = originalGenerateExampleSentence
  aiProvider.generateEmojiHint = originalGenerateEmojiHint
  aiProvider.generateTranslation = originalGenerateTranslation
}

// 清理指定 articleId 的缓存
function clearCache(articleId: string): void {
  localStorage.removeItem(CACHE_KEY_PREFIX + articleId)
}

// 读取缓存原始 JSON（用于验证字段持久化）
function readRawCache(articleId: string): unknown {
  const raw = localStorage.getItem(CACHE_KEY_PREFIX + articleId)
  return raw ? JSON.parse(raw) : null
}

// 构造合法 Article（仅包含 extractAndCacheVocabulary 用到的字段）
function makeArticle(id: string): Article {
  return {
    id,
    title: '测试文章',
    content: 'This is a test article content.',
    translation: '这是一篇测试文章。',
    genre: 'narrative',
    wordCount: 100,
    createdAt: 1000,
    updated_at: 1000,
  }
}

describe('vocabularyService 缓存持久化（Task 9.4）', () => {
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

describe('buildVocabularyFromHighlighted 高亮生词转换（基础版持久化）', () => {
  // 11. 字段映射完整：word/phonetic/pos/definition/example 逐一保留
  it('高亮生词字段完整映射为基础版 ArticleVocabulary', () => {
    const highlighted = [
      {
        word: 'annual',
        phonetic: '/ˈænjuəl/',
        pos: 'adj.',
        definition: '每年的；年度的',
        example: 'the annual Sports Day',
      },
      {
        word: 'uniform',
        phonetic: '/ˈjuːnɪfɔːm/',
        pos: 'n.',
        definition: '制服',
        example: 'wear your sports uniform',
      },
      {
        word: 'instruction',
        phonetic: '/ɪnˈstrʌkʃn/',
        pos: 'n.',
        definition: '指示；说明',
        example: 'follow the instructions',
      },
    ]
    const result = buildVocabularyFromHighlighted(highlighted)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      word: 'annual',
      phonetic: '/ˈænjuəl/',
      pos: 'adj.',
      definition: '每年的；年度的',
      example: 'the annual Sports Day',
    })
    // 基础版不含增强字段（阅读页打开时由 AI 增强升级）
    expect(result[0].exampleSentence).toBeUndefined()
    expect(result[0].emojiHint).toBeUndefined()
  })

  // 12. importance 推断：第 1 个 high / 第 2-3 个 medium / 其余 low
  it('importance 按位置推断：high / medium / low', () => {
    const make = (word: string) => ({
      word,
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
    })
    const result = buildVocabularyFromHighlighted([
      make('w1'),
      make('w2'),
      make('w3'),
      make('w4'),
      make('w5'),
    ])
    expect(result.map((v) => v.importance)).toEqual([
      'high',
      'medium',
      'medium',
      'low',
      'low',
    ])
  })

  // 13. 空输入防御：undefined / 空数组返回空数组
  it('undefined 或空数组返回空数组', () => {
    expect(buildVocabularyFromHighlighted(undefined)).toEqual([])
    expect(buildVocabularyFromHighlighted([])).toEqual([])
  })
})
