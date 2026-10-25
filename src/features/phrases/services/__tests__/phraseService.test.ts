// 重点短语汇总服务
//
// 覆盖已读文章短语提取、来源信息附加、日期分组与相对日期标签。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Article } from '@/shared/types'
import { articleService } from '@/features/reading/services/articleService'
import { getPhrasesGroupedByDate } from '../phraseService'

vi.mock('@/features/reading/services/articleService', () => ({
  articleService: {
    getReadHistory: vi.fn(),
  },
}))

const getReadHistoryMock = vi.mocked(articleService.getReadHistory)

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function atDaysAgo(days: number, hour = 12): number {
  const d = startOfToday()
  d.setDate(d.getDate() - days)
  d.setHours(hour)
  return d.getTime()
}

function dateKeyOf(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    title: `文章 ${id}`,
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 200,
    createdAt: atDaysAgo(10),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('phraseService 重点短语汇总', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('按已读文章拉取（limit 500 / offset 0），无数据返回空数组', async () => {
    getReadHistoryMock.mockResolvedValue([])

    await expect(getPhrasesGroupedByDate()).resolves.toEqual([])
    expect(getReadHistoryMock).toHaveBeenCalledWith(500, 0)
  })

  it('跳过无 phrases 或 phrases 为空的历史文章', async () => {
    getReadHistoryMock.mockResolvedValue([
      makeArticle('no-phrases', { readAt: atDaysAgo(0) }),
      makeArticle('empty-phrases', { readAt: atDaysAgo(0), phrases: [] }),
      makeArticle('has-phrases', {
        readAt: atDaysAgo(0),
        phrases: [{ phrase: 'look after', meaning: '照顾' }],
      }),
    ])

    const groups = await getPhrasesGroupedByDate()

    expect(groups).toHaveLength(1)
    expect(groups[0].phrases).toHaveLength(1)
    expect(groups[0].phrases[0].phrase).toBe('look after')
  })

  it('为短语附加来源文章信息并使用 readAt 作为时间', async () => {
    const readAt = atDaysAgo(1)
    getReadHistoryMock.mockResolvedValue([
      makeArticle('art-1', {
        title: '第一篇',
        readAt,
        phrases: [
          { phrase: 'give up', meaning: '放弃', example: 'Never give up.', exampleTranslation: '永不放弃。' },
        ],
      }),
    ])

    const groups = await getPhrasesGroupedByDate()

    expect(groups[0].phrases[0]).toMatchObject({
      phrase: 'give up',
      meaning: '放弃',
      articleId: 'art-1',
      articleTitle: '第一篇',
      readAt,
      example: 'Never give up.',
      exampleTranslation: '永不放弃。',
    })
  })

  it('readAt 缺失时依次回退 startedAt / createdAt', async () => {
    const startedAt = atDaysAgo(2)
    const createdAt = atDaysAgo(5)
    getReadHistoryMock.mockResolvedValue([
      makeArticle('started', {
        readAt: null,
        startedAt,
        phrases: [{ phrase: 'started phrase', meaning: '开始' }],
      }),
      makeArticle('created', {
        readAt: null,
        startedAt: null,
        createdAt,
        phrases: [{ phrase: 'created phrase', meaning: '创建' }],
      }),
    ])

    const groups = await getPhrasesGroupedByDate()

    expect(groups).toHaveLength(2)
    const startedGroup = groups.find((g) => g.date === dateKeyOf(startedAt))
    const createdGroup = groups.find((g) => g.date === dateKeyOf(createdAt))
    expect(startedGroup?.phrases[0].readAt).toBe(startedAt)
    expect(createdGroup?.phrases[0].readAt).toBe(createdAt)
  })

  it('按日期倒序分组，组内保留文章顺序', async () => {
    const today = atDaysAgo(0)
    const yesterday = atDaysAgo(1)
    getReadHistoryMock.mockResolvedValue([
      makeArticle('y1', {
        readAt: yesterday,
        phrases: [{ phrase: 'yesterday first', meaning: '昨天一' }],
      }),
      makeArticle('t1', {
        readAt: today,
        phrases: [{ phrase: 'today first', meaning: '今天一' }],
      }),
      makeArticle('t2', {
        readAt: today,
        phrases: [{ phrase: 'today second', meaning: '今天二' }],
      }),
    ])

    const groups = await getPhrasesGroupedByDate()

    // 日期倒序：今天在前，昨天在后
    expect(groups.map((g) => g.date)).toEqual([dateKeyOf(today), dateKeyOf(yesterday)])
    // 组内保留文章顺序
    expect(groups[0].phrases.map((p) => p.phrase)).toEqual(['today first', 'today second'])
  })

  it('相对日期标签：今天 / 昨天 / 前天 / N 天前 / 具体日期', async () => {
    const articles = [0, 1, 2, 3, 8].map((days) =>
      makeArticle(`d-${days}`, {
        readAt: atDaysAgo(days),
        phrases: [{ phrase: `p-${days}`, meaning: 'm' }],
      }),
    )
    getReadHistoryMock.mockResolvedValue(articles)

    const groups = await getPhrasesGroupedByDate()

    const labelOf = (days: number): string | undefined =>
      groups.find((g) => g.date === dateKeyOf(atDaysAgo(days)))?.dateLabel

    expect(labelOf(0)).toBe('今天')
    expect(labelOf(1)).toBe('昨天')
    expect(labelOf(2)).toBe('前天')
    expect(labelOf(3)).toBe('3 天前')
    expect(labelOf(8)).toBe(dateKeyOf(atDaysAgo(8)))
  })
})
