// articleGenerationService 每日文章生成与兜底降级单元测试
//
// 覆盖场景：
// 1. 本地未读文章命中直接返回，不调用 AI
// 2. AI 生成成功：保存实体并写入 contentHash
// 3. 去重索引与全量查询均失败时跳过去重，仍生成文章
// 4. forceNew / 同 id 已读时使用复合 id，避免覆盖旧文
// 5. AI 失败降级兜底素材库（fresh / reuse / exhausted）
// 6. 兜底文章写入失败仍返回且告警
// 7. 连续 3 次重复生成回退最新历史文章
// 8. 最近主题查询失败时跳过主题注入
//
// Mock 策略：mock articleRepository 与 aiProvider；兜底素材库使用真实数据。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Article } from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'

vi.mock('@/shared/services', () => ({
  articleRepository: {
    whereEquals: vi.fn(),
    getAllLocalFirst: vi.fn(),
    getByIdLocalFirst: vi.fn(),
    add: vi.fn(),
  },
}))

vi.mock('@/shared/services/ai', () => ({
  aiProvider: { generateArticle: vi.fn() },
}))

vi.mock('../vocabularyService', () => ({
  buildVocabularyFromHighlighted: vi.fn(() => []),
}))

import {
  getDailyArticle,
  generateArticle,
  normalizeTitleForDedupe,
  getRecentTopics,
  saveArticle,
} from '../articleGenerationService'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import {
  getAllFallbackArticles,
  pickRandomFallbackArticle,
} from '../../data/fallback-articles'
import { computeContentHash } from '@/shared/utils/contentHash'

const whereEqualsMock = vi.mocked(articleRepository.whereEquals)
const getAllLocalFirstMock = vi.mocked(articleRepository.getAllLocalFirst)
const getByIdLocalFirstMock = vi.mocked(articleRepository.getByIdLocalFirst)
const addMock = vi.mocked(articleRepository.add)
const generateArticleMock = vi.mocked(aiProvider.generateArticle)

function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    updated_at: 1,
    title: `Title ${id}`,
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 10,
    createdAt: 1,
    ...overrides,
  }
}

function makeAIResult(overrides: Partial<ArticleGenerationResult> = {}): ArticleGenerationResult {
  return {
    title: 'A New Day',
    content: 'Hello world content for a new day.',
    translation: '新的一天',
    genre: 'narrative',
    wordCount: 7,
    topic: 'campus',
    difficulty: 'easy',
    lexileRange: { min: 600, max: 700 },
    highlightedWords: [],
    ...overrides,
  }
}

describe('articleGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    whereEqualsMock.mockResolvedValue([])
    getAllLocalFirstMock.mockResolvedValue([])
    getByIdLocalFirstMock.mockResolvedValue(undefined)
    addMock.mockImplementation(async (entity) => ({ ...entity, updated_at: 1 }) as Article)
    generateArticleMock.mockResolvedValue(makeAIResult())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('本地未读文章命中时直接返回，不调用 AI', async () => {
    const cached = makeArticle('2026-10-26', { readAt: null })
    getByIdLocalFirstMock.mockResolvedValue(cached)

    const result = await getDailyArticle('2026-10-26')

    expect(result).toBe(cached)
    expect(generateArticleMock).not.toHaveBeenCalled()
  })

  it('AI 生成成功时保存文章并写入 contentHash', async () => {
    const result = await getDailyArticle('2026-10-26')

    expect(result.id).toBe('2026-10-26')
    expect(result.title).toBe('A New Day')
    expect(result.contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(addMock).toHaveBeenCalledTimes(1)
    expect(whereEqualsMock).toHaveBeenCalledWith('contentHash', expect.any(String))
  })

  it('去重索引与全量查询均失败时跳过去重继续生成', async () => {
    whereEqualsMock.mockRejectedValueOnce(new Error('dexie down'))
    getAllLocalFirstMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue([])

    const result = await getDailyArticle('2026-10-26')

    expect(result.title).toBe('A New Day')
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('同 id 已读时使用复合 id 生成新文章', async () => {
    getByIdLocalFirstMock.mockResolvedValue(makeArticle('2026-10-26', { readAt: 123 }))

    const result = await getDailyArticle('2026-10-26')

    expect(result.id).toMatch(/^2026-10-26-\d+$/)
  })

  it('AI 失败时降级兜底素材库并保存', async () => {
    generateArticleMock.mockRejectedValueOnce(new Error('AI down'))

    const result = await getDailyArticle('2026-10-26')

    const fallbackTitles = getAllFallbackArticles().map((f) => f.title)
    expect(fallbackTitles).toContain(result.title)
    expect(result.contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(addMock).toHaveBeenCalled()
  })

  it('兜底篇目全部保存且存在未读时直接复用本地文章', async () => {
    generateArticleMock.mockRejectedValueOnce(new Error('AI down'))
    const fallbacks = getAllFallbackArticles()
    const saved: Article[] = []
    for (const f of fallbacks) {
      saved.push(
        makeArticle(`fb-${f.title}`, {
          title: f.title,
          contentHash: await computeContentHash(f.title, f.content),
          readAt: null,
        }),
      )
    }
    saved[0].readAt = null
    for (let i = 1; i < saved.length; i++) saved[i].readAt = 123
    getAllLocalFirstMock.mockResolvedValue(saved)

    const result = await getDailyArticle('2026-10-26')

    expect(result.title).toBe(saved[0].title)
    expect(addMock).not.toHaveBeenCalled()
  })

  it('兜底篇目全部已读且无历史文章时抛错', async () => {
    generateArticleMock.mockRejectedValueOnce(new Error('AI down'))
    const fallbacks = getAllFallbackArticles()
    const saved: Article[] = []
    for (const f of fallbacks) {
      saved.push(
        makeArticle(`fb-${f.title}`, {
          title: f.title,
          contentHash: await computeContentHash(f.title, f.content),
          readAt: 123,
        }),
      )
    }
    getAllLocalFirstMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce([])

    await expect(getDailyArticle('2026-10-26')).rejects.toThrow('无历史文章可回退')
  })

  it('兜底文章写入失败时仍返回文章并告警', async () => {
    generateArticleMock.mockRejectedValueOnce(new Error('AI down'))
    addMock.mockRejectedValueOnce(new Error('write failed'))

    const result = await getDailyArticle('2026-10-26')

    // 兜底文章来自真实素材库，写入失败时返回未补 contentHash 的实体
    expect(getAllFallbackArticles().map((f) => f.title)).toContain(result.title)
    expect(result.contentHash).toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('兜底文章写入本地失败'),
      expect.any(Error),
    )
  })

  it('连续 3 次重复生成后回退最新历史文章', async () => {
    const existing = makeArticle('old', { title: 'Old Title', contentHash: 'abc' })
    whereEqualsMock.mockResolvedValue([existing])
    getAllLocalFirstMock.mockResolvedValue([existing])

    const result = await generateArticle({ date: '2026-10-26' })

    expect(result).toBe(existing)
    expect(generateArticleMock).toHaveBeenCalledTimes(3)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('连续 3 次生成重复文章'),
    )
  })

  it('最近主题查询失败时跳过主题注入', async () => {
    getAllLocalFirstMock
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue([])

    await generateArticle({ date: '2026-10-26' })

    expect(generateArticleMock).toHaveBeenCalledWith(
      '2026-10-26',
      undefined,
      undefined,
      undefined,
      [],
    )
  })

  it('normalizeTitleForDedupe 小写并去除标点', () => {
    expect(normalizeTitleForDedupe('A Rainy Day!')).toBe('arainyday')
  })

  it('getRecentTopics 按时间倒序取指定数量并过滤空题材', async () => {
    getAllLocalFirstMock.mockResolvedValue([
      makeArticle('a', { createdAt: 1, topic: 'campus' }),
      makeArticle('b', { createdAt: 3, topic: 'science' }),
      makeArticle('c', { createdAt: 2 }),
    ])

    expect(await getRecentTopics(3)).toEqual(['science', 'campus'])
  })

  it('saveArticle 缺少 contentHash 时补算后写入', async () => {
    const article = makeArticle('x')
    const saved = await saveArticle(article)

    expect(saved.contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({ contentHash: saved.contentHash }))
  })

  it('saveArticle 已有 contentHash 时直接写入', async () => {
    const article = makeArticle('x', { contentHash: 'fixedhash' })
    const saved = await saveArticle(article)

    expect(saved.contentHash).toBe('fixedhash')
    expect(addMock).toHaveBeenCalledWith(article)
  })

  it('兜底素材库随机挑选函数可直接返回一篇素材', () => {
    const fallback = pickRandomFallbackArticle()
    expect(getAllFallbackArticles()).toContain(fallback)
  })
})
