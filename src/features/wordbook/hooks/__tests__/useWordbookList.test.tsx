// useWordbookList 生词本列表 hook 单元测试
//
// 覆盖场景：
// 1. 初次加载：首屏 loading、列表 / 总数 / 统计 / hasMore
// 2. 首次加载失败与统计失败：记录警告并落空数据
// 3. 搜索防抖：300ms 后才以新关键字重新查询
// 4. 排序 / 仅看收藏切换：立即重置并重新查询
// 5. 无限滚动：进入视口加载下一页、按 id 去重、hasMore 结束
// 6. 无更多数据时不重复加载；加载更多失败仅记录警告
// 7. 订阅 words 缓存失效事件：重载列表与统计
// 8. 环境不支持 IntersectionObserver 时降级为不自动加载
//
// Mock 策略：mock 生词服务查询；IntersectionObserver 使用可控 stub
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, act, waitFor } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { cacheEvents } from '@/shared/services/cacheEvents'
import { getWordbook, getWordbookStats } from '../../services/wordbookService'
import { useWordbookList, type UseWordbookListResult } from '../useWordbookList'

vi.mock('../../services/wordbookService', () => ({
  getWordbook: vi.fn(),
  getWordbookStats: vi.fn(),
}))

const getWordbookMock = vi.mocked(getWordbook)
const getWordbookStatsMock = vi.mocked(getWordbookStats)

function makeWord(id: string): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: `/ˈ${id}/`,
    pos: 'n.',
    definition: id,
    example: `${id} example`,
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
  }
}

function page(items: Word[], total: number) {
  return { items, total, limit: 20, offset: 0 }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// 可控 IntersectionObserver：记录回调与实例方法调用
let ioCallback: IntersectionObserverCallback | null = null
const observeMock = vi.fn()
const disconnectMock = vi.fn()

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    ioCallback = callback
  }
  observe = observeMock
  unobserve = vi.fn()
  disconnect = disconnectMock
  takeRecords = () => []
  root = null
  rootMargin = ''
  thresholds = []
}

function triggerIntersect() {
  act(() => {
    ioCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  })
}

describe('useWordbookList 生词本列表', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    ioCallback = null
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getWordbookStatsMock.mockResolvedValue({ total: 0, mastered: 0, pendingReview: 0 })
    getWordbookMock.mockResolvedValue(page([], 0))
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('初次加载：首屏 loading，完成后填充列表、总数、统计与 hasMore', async () => {
    const def = deferred<ReturnType<typeof page>>()
    getWordbookMock.mockReturnValueOnce(def.promise)
    getWordbookStatsMock.mockResolvedValue({ total: 5, mastered: 1, pendingReview: 4 })

    const { result } = renderHook(() => useWordbookList())

    expect(result.current.showInitialLoading).toBe(true)
    expect(result.current.loading).toBe(true)

    await act(async () => {
      def.resolve(page([makeWord('apple'), makeWord('pear')], 5))
    })

    expect(result.current.showInitialLoading).toBe(false)
    expect(result.current.items.map((w) => w.id)).toEqual(['apple', 'pear'])
    expect(result.current.total).toBe(5)
    expect(result.current.hasMore).toBe(true)
    expect(result.current.stats).toEqual({ total: 5, mastered: 1, pendingReview: 4 })
    expect(result.current.isAllMastered).toBe(false)
  })

  it('首次加载失败：记录警告并清空列表状态', async () => {
    getWordbookMock.mockRejectedValue(new Error('db down'))

    const { result } = renderHook(() => useWordbookList())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(warnSpy).toHaveBeenCalledWith(
      '[WordbookPage] 加载生词列表失败',
      expect.any(Error)
    )
    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.hasMore).toBe(false)
  })

  it('统计加载失败：记录警告并保持初始统计', async () => {
    getWordbookStatsMock.mockRejectedValue(new Error('stats down'))

    const { result } = renderHook(() => useWordbookList())

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[WordbookPage] 加载统计数据失败',
        expect.any(Error)
      )
    )

    expect(result.current.stats).toEqual({ total: 0, mastered: 0, pendingReview: 0 })
  })

  it('搜索输入防抖 300ms 后才以新关键字重新查询', async () => {
    vi.useFakeTimers()
    getWordbookMock.mockResolvedValue(page([makeWord('apple')], 1))

    const { result } = renderHook(() => useWordbookList())
    await act(async () => {})

    // 初次挂载：mount effect 与 keyword effect 各触发一次首屏加载
    expect(getWordbookMock).toHaveBeenCalledTimes(2)
    expect(getWordbookMock.mock.calls[0][0]).toMatchObject({ keyword: '' })

    act(() => {
      result.current.setSearchInput('app')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(getWordbookMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getWordbookMock).toHaveBeenCalledTimes(3)
    expect(getWordbookMock.mock.calls[2][0]).toMatchObject({ keyword: 'app' })
  })

  it('排序切换立即重新查询并携带新排序', async () => {
    const { result } = renderHook(() => useWordbookList())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setSortBy('alphabet')
    })

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookMock.mock.calls[2][0]).toMatchObject({ sortBy: 'alphabet' })
    expect(result.current.sortBy).toBe('alphabet')
  })

  it('切换仅看收藏后携带 onlyFavorite 重新查询', async () => {
    const { result } = renderHook(() => useWordbookList())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setOnlyFavorite(true)
    })

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookMock.mock.calls[2][0]).toMatchObject({ onlyFavorite: true })
    expect(result.current.onlyFavorite).toBe(true)
  })

  it('滚动进入视口加载下一页：offset 递增、按 id 去重、hasMore 收敛', async () => {
    let latest: UseWordbookListResult | null = null
    function Harness() {
      latest = useWordbookList()
      return <div ref={latest.sentinelRef} data-testid="sentinel" />
    }

    const first = Array.from({ length: 20 }, (_, i) => makeWord(`w${i}`))
    const second = [
      ...Array.from({ length: 10 }, (_, i) => makeWord(`w${20 + i}`)),
      // 与第一页重复的边界数据，验证去重
      makeWord('w0'),
      makeWord('w1'),
    ]
    getWordbookMock.mockImplementation(async (params) =>
      params?.offset === 20 ? page(second, 30) : page(first, 30)
    )

    render(<Harness />)

    await waitFor(() => expect(latest!.loading).toBe(false))
    expect(observeMock).toHaveBeenCalled()

    triggerIntersect()

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookMock.mock.calls[2][0]).toMatchObject({ offset: 20 })
    await waitFor(() => expect(latest!.loadingMore).toBe(false))

    expect(latest!.items).toHaveLength(30)
    expect(new Set(latest!.items.map((w) => w.id)).size).toBe(30)
    expect(latest!.hasMore).toBe(false)
  })

  it('无更多数据时进入视口不重复加载', async () => {
    let latest: UseWordbookListResult | null = null
    function Harness() {
      latest = useWordbookList()
      return <div ref={latest.sentinelRef} />
    }

    getWordbookMock.mockResolvedValueOnce(page([makeWord('only')], 1))
    render(<Harness />)

    await waitFor(() => expect(latest!.loading).toBe(false))
    expect(latest!.hasMore).toBe(false)
    expect(getWordbookMock).toHaveBeenCalledTimes(2)

    triggerIntersect()
    await act(async () => {})

    expect(getWordbookMock).toHaveBeenCalledTimes(2)
  })

  it('加载更多失败：记录警告并复位 loadingMore', async () => {
    let latest: UseWordbookListResult | null = null
    function Harness() {
      latest = useWordbookList()
      return <div ref={latest.sentinelRef} />
    }

    const first = Array.from({ length: 20 }, (_, i) => makeWord(`w${i}`))
    getWordbookMock.mockImplementation(async (params) => {
      if (params?.offset === 20) throw new Error('page down')
      return page(first, 30)
    })

    render(<Harness />)
    await waitFor(() => expect(latest!.loading).toBe(false))

    triggerIntersect()

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[WordbookPage] 加载更多失败',
        expect.any(Error)
      )
    )
    await waitFor(() => expect(latest!.loadingMore).toBe(false))
    expect(latest!.items).toHaveLength(20)
  })

  it('缓存失效事件触发重载列表与统计', async () => {
    const { result } = renderHook(() => useWordbookList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getWordbookMock).toHaveBeenCalledTimes(2)
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(1)

    act(() => {
      cacheEvents.emit('words')
    })

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(2)
  })

  it('环境不支持 IntersectionObserver 时降级为不自动加载', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)

    const { result } = renderHook(() => useWordbookList())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(observeMock).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })
})
