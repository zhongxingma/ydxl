// articleReadService 阅读状态与查询服务单元测试
//
// 覆盖场景：
// 1. markAsRead / recordReadingStart 成功与失败兜底
// 2. getReadHistory 过滤、排序（readAt → startedAt → createdAt）与分页
// 3. getRecentlyReadArticles 精简字段、排序与查询失败降级
// 4. getTodayReadCount 当日统计与失败降级
// 5. getArticleById 404 / 未命中 / 非 404 异常
// 6. ensureArticlePhrases 已有短语、提取写回、写回失败与提取失败
//
// Mock 策略：mock articleRepository 与 aiProvider，聚焦服务层分支。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Article } from '@/shared/types'

vi.mock('@/shared/services', () => ({
  articleRepository: {
    update: vi.fn(),
    getAllLocalFirst: vi.fn(),
    getByIdLocalFirst: vi.fn(),
  },
}))

vi.mock('@/shared/services/ai', () => ({
  aiProvider: {
    extractArticlePhrases: vi.fn(),
  },
}))

import {
  markAsRead,
  recordReadingStart,
  getReadHistory,
  getRecentlyReadArticles,
  getTodayReadCount,
  getArticleById,
  ensureArticlePhrases,
} from '../articleReadService'
import { ArticleNotFoundError } from '../articleErrors'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

const updateMock = vi.mocked(articleRepository.update)
const getAllMock = vi.mocked(articleRepository.getAllLocalFirst)
const getByIdMock = vi.mocked(articleRepository.getByIdLocalFirst)
const extractPhrasesMock = vi.mocked(aiProvider.extractArticlePhrases)

function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    updated_at: Date.now(),
    title: `Title ${id}`,
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 100,
    createdAt: 1000,
    ...overrides,
  }
}

describe('articleReadService 阅读状态与查询', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    updateMock.mockResolvedValue(makeArticle('a1'))
    getAllMock.mockResolvedValue([])
    getByIdMock.mockResolvedValue(undefined)
    extractPhrasesMock.mockResolvedValue([])
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('markAsRead 成功写入 readAt 并返回 true', async () => {
    const before = Date.now()

    await expect(markAsRead('a1')).resolves.toBe(true)

    expect(updateMock).toHaveBeenCalledWith('a1', {
      readAt: expect.any(Number),
    })
    expect((updateMock.mock.calls[0][1] as { readAt: number }).readAt).toBeGreaterThanOrEqual(
      before
    )
  })

  it('markAsRead 写入失败时告警并返回 false', async () => {
    updateMock.mockRejectedValue(new Error('HTTP 500'))

    await expect(markAsRead('a1')).resolves.toBe(false)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('markAsRead 失败'),
      expect.any(Error)
    )
  })

  it('recordReadingStart 成功写入 startedAt，失败时返回 false', async () => {
    await expect(recordReadingStart('a1')).resolves.toBe(true)
    expect(updateMock).toHaveBeenCalledWith('a1', {
      startedAt: expect.any(Number),
    })

    updateMock.mockRejectedValue(new Error('network'))
    await expect(recordReadingStart('a1')).resolves.toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('recordReadingStart 失败'),
      expect.any(Error)
    )
  })

  it('getReadHistory 过滤未开始文章并按阅读时间倒序分页', async () => {
    const now = Date.now()
    getAllMock.mockResolvedValue([
      makeArticle('read-old', { readAt: now - 3000 }),
      makeArticle('started', { startedAt: now - 1000 }),
      makeArticle('created-only', { createdAt: now - 2000 }),
      makeArticle('read-new', { readAt: now }),
      makeArticle('started-old', { startedAt: now - 5000 }),
    ])

    const page = await getReadHistory(2, 0)

    expect(page.map((a) => a.id)).toEqual(['read-new', 'started'])
  })

  it('getReadHistory 支持偏移量与默认全部', async () => {
    const now = Date.now()
    getAllMock.mockResolvedValue([
      makeArticle('a', { readAt: now }),
      makeArticle('b', { readAt: now - 10 }),
      makeArticle('c', { readAt: now - 20 }),
    ])

    expect((await getReadHistory(10, 1)).map((a) => a.id)).toEqual(['b', 'c'])
    expect(await getReadHistory()).toHaveLength(3)
  })

  it('getRecentlyReadArticles 仅返回已读并精简字段、按 readAt 倒序', async () => {
    const now = Date.now()
    getAllMock.mockResolvedValue([
      makeArticle('old', { readAt: now - 100, topic: 'campus', difficulty: 'easy' }),
      makeArticle('unread', { startedAt: now }),
      makeArticle('new', { readAt: now }),
    ])

    const recent = await getRecentlyReadArticles(1)

    expect(recent).toEqual([
      {
        id: 'new',
        title: 'Title new',
        readAt: now,
        topic: undefined,
        difficulty: undefined,
        wordCount: 100,
      },
    ])
  })

  it('getRecentlyReadArticles 查询失败时返回空数组', async () => {
    getAllMock.mockRejectedValue(new Error('db down'))

    await expect(getRecentlyReadArticles(5)).resolves.toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getRecentlyReadArticles 查询失败'),
      expect.any(Error)
    )
  })

  it('getTodayReadCount 仅统计当天已读文章', async () => {
    const today = new Date()
    today.setHours(10, 0, 0, 0)
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    getAllMock.mockResolvedValue([
      makeArticle('today-1', { readAt: today.getTime() }),
      makeArticle('today-2', { readAt: today.getTime() + 1000 }),
      makeArticle('yesterday', { readAt: yesterday.getTime() }),
      makeArticle('unread', {}),
    ])

    await expect(getTodayReadCount()).resolves.toBe(2)
  })

  it('getTodayReadCount 查询失败时返回 0', async () => {
    getAllMock.mockRejectedValue(new Error('db down'))

    await expect(getTodayReadCount()).resolves.toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getTodayReadCount 查询失败'),
      expect.any(Error)
    )
  })

  it('getArticleById 成功返回文章', async () => {
    const article = makeArticle('a1')
    getByIdMock.mockResolvedValue(article)

    await expect(getArticleById('a1')).resolves.toBe(article)
  })

  it('getArticleById 未命中时抛 ArticleNotFoundError', async () => {
    getByIdMock.mockResolvedValue(undefined)

    await expect(getArticleById('missing')).rejects.toBeInstanceOf(ArticleNotFoundError)
  })

  it('getArticleById 404 异常转换为 ArticleNotFoundError', async () => {
    getByIdMock.mockRejectedValue(new Error('HTTP 404 Not Found'))

    await expect(getArticleById('missing')).rejects.toBeInstanceOf(ArticleNotFoundError)
  })

  it('getArticleById 非 404 异常向上抛出', async () => {
    getByIdMock.mockRejectedValue(new Error('HTTP 500'))

    await expect(getArticleById('a1')).rejects.toThrow('HTTP 500')
  })

  it('ensureArticlePhrases 已有短语直接返回', async () => {
    const phrases = [{ phrase: 'take care of', meaning: '照顾' }]

    await expect(
      ensureArticlePhrases(makeArticle('a1', { phrases }))
    ).resolves.toBe(phrases)
    expect(extractPhrasesMock).not.toHaveBeenCalled()
  })

  it('ensureArticlePhrases 缺失时提取并写回', async () => {
    const phrases = [{ phrase: 'look after', meaning: '照料' }]
    extractPhrasesMock.mockResolvedValue(phrases)

    await expect(ensureArticlePhrases(makeArticle('a1'))).resolves.toBe(phrases)

    expect(extractPhrasesMock).toHaveBeenCalledWith('content')
    expect(updateMock).toHaveBeenCalledWith('a1', { phrases })
  })

  it('ensureArticlePhrases 写回失败时仍返回提取结果', async () => {
    const phrases = [{ phrase: 'look after', meaning: '照料' }]
    extractPhrasesMock.mockResolvedValue(phrases)
    updateMock.mockRejectedValue(new Error('quota'))

    await expect(ensureArticlePhrases(makeArticle('a1'))).resolves.toBe(phrases)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('短语写回失败'),
      expect.any(Error)
    )
  })

  it('ensureArticlePhrases 提取失败时返回空数组', async () => {
    extractPhrasesMock.mockRejectedValue(new Error('AI down'))

    await expect(ensureArticlePhrases(makeArticle('a1'))).resolves.toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('文章短语提取失败'),
      expect.any(Error)
    )
  })

  it('ensureArticlePhrases 提取结果为空时不写回', async () => {
    extractPhrasesMock.mockResolvedValue([])

    await expect(ensureArticlePhrases(makeArticle('a1'))).resolves.toEqual([])
    expect(updateMock).not.toHaveBeenCalled()
  })
})
