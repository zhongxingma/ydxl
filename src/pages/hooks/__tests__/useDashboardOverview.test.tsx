// useDashboardOverview 仪表盘概览数据测试
//
// 覆盖：
// 1. 并行加载聚合数据、待复习 Top5 按 nextReview 升序截断
// 2. 今日阅读为 0 时走 articleService 兜底查询
// 3. 兜底查询失败时 warn 并保持 0
// 4. words 缓存失效事件触发重载
// 5. 组件卸载后丢弃异步结果，不更新状态
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { Word } from '@/shared/types'

const mocks = vi.hoisted(() => ({
  getStatsOverview: vi.fn(),
  getReadingAbilityTrend: vi.fn(),
  getStatsByDateRange: vi.fn(),
  getTodayReviewQueueInfo: vi.fn(),
  getTodayReadCount: vi.fn(),
  isOverdue: vi.fn(),
  invalidatedCallback: null as null | (() => void),
}))

vi.mock('@/features/stats', () => ({
  statsService: {
    getStatsOverview: mocks.getStatsOverview,
    getReadingAbilityTrend: mocks.getReadingAbilityTrend,
    getStatsByDateRange: mocks.getStatsByDateRange,
  },
  getDateNDaysAgo: (n: number) => `2026-10-${String(26 - n).padStart(2, '0')}`,
}))

vi.mock('@/features/review', () => ({
  reviewService: { getTodayReviewQueueInfo: mocks.getTodayReviewQueueInfo },
  isOverdue: mocks.isOverdue,
}))

vi.mock('@/features/reading/services/articleService', () => ({
  articleService: { getTodayReadCount: mocks.getTodayReadCount },
}))

vi.mock('@/shared/hooks/useCacheInvalidated', () => ({
  useCacheInvalidated: (_table: string, callback: () => void) => {
    mocks.invalidatedCallback = callback
  },
}))

import { useDashboardOverview } from '../useDashboardOverview'

function makeWord(id: string, nextReview: number): Word {
  return {
    id,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: 0,
    updated_at: 0,
  }
}

function makeMountedRef(value = true): MutableRefObject<boolean> {
  return { current: value }
}

describe('useDashboardOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invalidatedCallback = null
    mocks.getStatsOverview.mockResolvedValue({
      currentStreak: 5,
      todayArticlesRead: 2,
      todayWordsReviewed: 3,
      totalWordsMastered: 80,
    })
    mocks.getTodayReviewQueueInfo.mockResolvedValue({ words: [], total: 0 })
    mocks.getReadingAbilityTrend.mockResolvedValue([])
    mocks.getStatsByDateRange.mockResolvedValue([])
    mocks.getTodayReadCount.mockResolvedValue(0)
    mocks.isOverdue.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('并行加载聚合数据并按 nextReview 取前 5 个待复习单词', async () => {
    mocks.getTodayReviewQueueInfo.mockResolvedValue({
      words: [
        makeWord('w6', 600),
        makeWord('w2', 200),
        makeWord('w1', 100),
        makeWord('w4', 400),
        makeWord('w3', 300),
        makeWord('w5', 500),
      ],
      total: 6,
    })
    mocks.isOverdue.mockImplementation((w: Word) => w.id === 'w1' || w.id === 'w2')
    mocks.getStatsByDateRange
      .mockResolvedValueOnce([{ wordsMastered: 5 }, { wordsMastered: 3 }])
      .mockResolvedValueOnce([{ wordsMastered: 2 }])

    const { result } = renderHook(() => useDashboardOverview(makeMountedRef()))

    await act(async () => {
      await result.current.loadOverview()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.data).toMatchObject({
      streak: 5,
      todayArticlesRead: 2,
      todayWordsReviewed: 3,
      pendingReview: 6,
      overdueCount: 2,
      totalWordsMastered: 80,
      weekMastered: 8,
      lastWeekMastered: 2,
    })
    // 按 nextReview 升序排序后截取前 5 个
    expect(result.current.todayReviewWords.map((w) => w.id)).toEqual([
      'w1',
      'w2',
      'w3',
      'w4',
      'w5',
    ])
    // 今日阅读不为 0 → 不触发兜底查询
    expect(mocks.getTodayReadCount).not.toHaveBeenCalled()
  })

  it('今日阅读为 0 → 使用兜底查询结果', async () => {
    mocks.getStatsOverview.mockResolvedValue({
      currentStreak: 0,
      todayArticlesRead: 0,
      todayWordsReviewed: 0,
      totalWordsMastered: 0,
    })
    mocks.getTodayReadCount.mockResolvedValue(4)

    const { result } = renderHook(() => useDashboardOverview(makeMountedRef()))

    await act(async () => {
      await result.current.loadOverview()
    })

    expect(result.current.data?.todayArticlesRead).toBe(4)
    expect(mocks.getTodayReadCount).toHaveBeenCalledTimes(1)
  })

  it('兜底查询失败 → warn 并保持今日阅读为 0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getStatsOverview.mockResolvedValue({
      currentStreak: 0,
      todayArticlesRead: 0,
      todayWordsReviewed: 0,
      totalWordsMastered: 0,
    })
    mocks.getTodayReadCount.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useDashboardOverview(makeMountedRef()))

    await act(async () => {
      await result.current.loadOverview()
    })

    expect(result.current.data?.todayArticlesRead).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      '[DashboardPage] getTodayReadCount 兜底查询失败',
      expect.any(Error),
    )
  })

  it('words 缓存失效事件触发概览重载', async () => {
    const { result } = renderHook(() => useDashboardOverview(makeMountedRef()))

    await act(async () => {
      await result.current.loadOverview()
    })
    expect(mocks.getStatsOverview).toHaveBeenCalledTimes(1)

    await act(async () => {
      mocks.invalidatedCallback?.()
    })

    await waitFor(() => {
      expect(mocks.getStatsOverview).toHaveBeenCalledTimes(2)
    })
  })

  it('组件卸载后丢弃异步结果 → 不更新状态', async () => {
    const { result } = renderHook(() => useDashboardOverview(makeMountedRef(false)))

    await act(async () => {
      await result.current.loadOverview()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    expect(result.current.todayReviewWords).toEqual([])
  })
})
