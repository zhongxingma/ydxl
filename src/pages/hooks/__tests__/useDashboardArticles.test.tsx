// useDashboardArticles 仪表盘文章列表 hook 单元测试
//
// 覆盖场景：
// 1. loadArticles 并行加载历史 / 最近阅读 / 推荐，并按返回数量计算 hasMore
// 2. 组件卸载后丢弃加载结果
// 3. 历史阅读「查看更多」成功追加与失败降级
// 4. 最近阅读「展开更多」截取新增部分与失败降级
// 5. 订阅 articles 缓存失效事件后重载
//
// Mock 策略：mock 文章读取服务与推荐服务，hook 不自动加载由测试显式触发
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { Article } from '@/shared/types'
import type { RecentlyReadArticle } from '@/features/reading/services/articleService'
import { articleService } from '@/features/reading/services/articleService'
import { getRecommendedArticles } from '@/features/reading/services/recommendationService'
import { cacheEvents } from '@/shared/services/cacheEvents'
import { useDashboardArticles } from '../useDashboardArticles'

vi.mock('@/features/reading/services/articleService', () => ({
  articleService: {
    getReadHistory: vi.fn(),
    getRecentlyReadArticles: vi.fn(),
  },
}))

vi.mock('@/features/reading/services/recommendationService', () => ({
  getRecommendedArticles: vi.fn(),
}))

const getReadHistoryMock = vi.mocked(articleService.getReadHistory)
const getRecentlyReadMock = vi.mocked(articleService.getRecentlyReadArticles)
const getRecommendedMock = vi.mocked(getRecommendedArticles)

function makeArticle(id: string): Article {
  const now = Date.now()
  return {
    id,
    title: `Title ${id}`,
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 50,
    createdAt: now,
    updated_at: now,
    readAt: now,
  }
}

function makeRecentlyRead(id: string): RecentlyReadArticle {
  return { id, title: `Title ${id}`, readAt: Date.now(), wordCount: 50 }
}

function setup(mounted = true) {
  const mountedRef = { current: mounted } as MutableRefObject<boolean>
  const { result } = renderHook(() => useDashboardArticles(mountedRef))
  return { result, mountedRef }
}

describe('useDashboardArticles 仪表盘文章列表', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getReadHistoryMock.mockResolvedValue([])
    getRecentlyReadMock.mockResolvedValue([])
    getRecommendedMock.mockResolvedValue([])
  })

  it('loadArticles 并行加载三类数据并在数量达到页大小时标记 hasMore', async () => {
    const history = Array.from({ length: 6 }, (_, i) => makeArticle(`h${i}`))
    const recent = Array.from({ length: 5 }, (_, i) => makeRecentlyRead(`r${i}`))
    const recommended = [makeArticle('rec1')]
    getReadHistoryMock.mockResolvedValue(history)
    getRecentlyReadMock.mockResolvedValue(recent)
    getRecommendedMock.mockResolvedValue(recommended)

    const { result } = setup()
    expect(result.current.historyLoading).toBe(true)

    await act(async () => {
      await result.current.loadArticles()
    })

    expect(getReadHistoryMock).toHaveBeenCalledWith(6, 0)
    expect(getRecentlyReadMock).toHaveBeenCalledWith(5)
    expect(getRecommendedMock).toHaveBeenCalledWith(6)
    expect(result.current.historyArticles).toEqual(history)
    expect(result.current.historyHasMore).toBe(true)
    expect(result.current.historyLoading).toBe(false)
    expect(result.current.recentlyReadArticles).toEqual(recent)
    expect(result.current.recentlyReadHasMore).toBe(true)
    expect(result.current.recentlyReadLoading).toBe(false)
    expect(result.current.recommendedArticles).toEqual(recommended)
    expect(result.current.recommendedLoading).toBe(false)
  })

  it('返回数量不足页大小时 hasMore 为 false', async () => {
    getReadHistoryMock.mockResolvedValue([makeArticle('h1')])
    getRecentlyReadMock.mockResolvedValue([makeRecentlyRead('r1')])

    const { result } = setup()
    await act(async () => {
      await result.current.loadArticles()
    })

    expect(result.current.historyHasMore).toBe(false)
    expect(result.current.recentlyReadHasMore).toBe(false)
  })

  it('组件已卸载时丢弃加载结果', async () => {
    getReadHistoryMock.mockResolvedValue([makeArticle('h1')])
    const { result, mountedRef } = setup()
    mountedRef.current = false

    await act(async () => {
      await result.current.loadArticles()
    })

    expect(result.current.historyArticles).toEqual([])
    expect(result.current.historyLoading).toBe(true)
    expect(result.current.recommendedLoading).toBe(true)
  })

  it('历史阅读查看更多：按已展示数量作为 offset 追加并更新 hasMore', async () => {
    getReadHistoryMock.mockImplementation(async (limit = 0, offset = 0) =>
      offset === 0
        ? [makeArticle('h1'), makeArticle('h2')]
        : Array.from({ length: limit }, (_, i) => makeArticle(`h${offset + i}`))
    )

    const { result } = setup()
    await act(async () => {
      await result.current.loadArticles()
    })

    await act(async () => {
      await result.current.handleLoadMoreHistory()
    })

    expect(getReadHistoryMock).toHaveBeenLastCalledWith(6, 2)
    expect(result.current.historyArticles).toHaveLength(8)
    expect(result.current.historyHasMore).toBe(true)
    expect(result.current.historyLoading).toBe(false)
  })

  it('历史阅读查看更多失败：记录警告并结束分页', async () => {
    getReadHistoryMock
      .mockResolvedValueOnce([makeArticle('h1')])
      .mockRejectedValueOnce(new Error('history down'))

    const { result } = setup()
    await act(async () => {
      await result.current.loadArticles()
    })

    await act(async () => {
      await result.current.handleLoadMoreHistory()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[DashboardPage] 加载更多历史阅读失败',
      expect.any(Error)
    )
    expect(result.current.historyHasMore).toBe(false)
    expect(result.current.historyLoading).toBe(false)
  })

  it('最近阅读展开更多：截取新增部分追加并按累计数量判断 hasMore', async () => {
    const initial = Array.from({ length: 5 }, (_, i) => makeRecentlyRead(`r${i}`))
    const expanded = Array.from({ length: 8 }, (_, i) => makeRecentlyRead(`r${i}`))
    getRecentlyReadMock
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(expanded)

    const { result } = setup()
    await act(async () => {
      await result.current.loadArticles()
    })

    await act(async () => {
      await result.current.handleLoadMoreRecentlyRead()
    })

    expect(getRecentlyReadMock).toHaveBeenLastCalledWith(10)
    expect(result.current.recentlyReadArticles).toHaveLength(8)
    expect(result.current.recentlyReadHasMore).toBe(false)
    expect(result.current.recentlyReadLoading).toBe(false)
  })

  it('最近阅读展开更多失败：记录警告并结束分页', async () => {
    getRecentlyReadMock
      .mockResolvedValueOnce([makeRecentlyRead('r1')])
      .mockRejectedValueOnce(new Error('recent down'))

    const { result } = setup()
    await act(async () => {
      await result.current.loadArticles()
    })

    await act(async () => {
      await result.current.handleLoadMoreRecentlyRead()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[DashboardPage] 加载更多最近阅读失败',
      expect.any(Error)
    )
    expect(result.current.recentlyReadHasMore).toBe(false)
    expect(result.current.recentlyReadLoading).toBe(false)
  })

  it('articles 缓存失效事件触发重载', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.loadArticles()
    })
    expect(getReadHistoryMock).toHaveBeenCalledTimes(1)

    act(() => {
      cacheEvents.emit('articles')
    })

    await waitFor(() => expect(getReadHistoryMock).toHaveBeenCalledTimes(2))
    expect(getRecommendedMock).toHaveBeenCalledTimes(2)
  })
})
