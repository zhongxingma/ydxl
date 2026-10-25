// 已掌握单词列表 hook
//
// 覆盖初次加载、失败降级、搜索防抖、排序切换、缓存失效重载与无限滚动加载更多。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { getMasteredWords } from '../../services/masteredService'
import { useMasteredWords } from '../useMasteredWords'

vi.mock('@/shared/hooks/useCacheInvalidated', () => ({
  useCacheInvalidated: vi.fn(),
}))

vi.mock('../../services/masteredService', () => ({
  getMasteredWords: vi.fn(),
}))

const getMasteredWordsMock = vi.mocked(getMasteredWords)
const cacheHookMock = vi.mocked(useCacheInvalidated)

function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 5,
    nextReview: now,
    lastReview: 0,
    reviewCount: 1,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

function makePage(items: Word[], total: number, offset = 0) {
  return { items, total, limit: 20, offset }
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = (): IntersectionObserverEntry[] => []

  trigger(): void {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

let hook: ReturnType<typeof useMasteredWords>

function Harness(): React.ReactElement {
  hook = useMasteredWords()
  return <div ref={hook.sentinelRef} data-testid="sentinel" />
}

async function renderHookAndWait(): Promise<void> {
  render(<Harness />)
  await waitFor(() => expect(hook.loading).toBe(false))
}

function latestObserver(): MockIntersectionObserver {
  return MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]
}

describe('useMasteredWords 已掌握列表', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    getMasteredWordsMock.mockResolvedValue(makePage([], 0))
    cacheHookMock.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('初次加载：按第一页参数请求并写入列表', async () => {
    const word = makeWord('a')
    getMasteredWordsMock.mockResolvedValue(makePage([word], 30))
    await renderHookAndWait()

    expect(getMasteredWordsMock).toHaveBeenCalledTimes(1)
    expect(getMasteredWordsMock).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      keyword: '',
      sortBy: 'masteredAt-desc',
    })
    expect(hook.items).toEqual([word])
    expect(hook.total).toBe(30)
    expect(hook.hasMore).toBe(true)
    expect(hook.loading).toBe(false)
    expect(hook.loadingMore).toBe(false)
  })

  it('初次加载失败：告警并清空列表', async () => {
    getMasteredWordsMock.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await renderHookAndWait()

    expect(warnSpy).toHaveBeenCalledWith(
      '[MasteredPage] 加载已掌握单词列表失败',
      expect.any(Error),
    )
    expect(hook.items).toEqual([])
    expect(hook.total).toBe(0)
    expect(hook.hasMore).toBe(false)
  })

  it('搜索输入防抖 300ms 后按关键字重新加载', async () => {
    await renderHookAndWait()
    expect(getMasteredWordsMock).toHaveBeenCalledTimes(1)

    act(() => hook.setSearchInput('app'))

    await waitFor(() => expect(getMasteredWordsMock).toHaveBeenCalledTimes(2), {
      timeout: 1500,
    })
    expect(getMasteredWordsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'app', offset: 0 }),
    )
    expect(hook.searchInput).toBe('app')
  })

  it('切换排序方式立即按新参数重新加载', async () => {
    await renderHookAndWait()

    act(() => hook.setSortBy('alphabet'))

    await waitFor(() => expect(getMasteredWordsMock).toHaveBeenCalledTimes(2))
    expect(getMasteredWordsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: 'alphabet' }),
    )
    expect(hook.sortBy).toBe('alphabet')
  })

  it('缓存失效事件触发第一页重载', async () => {
    await renderHookAndWait()
    expect(getMasteredWordsMock).toHaveBeenCalledTimes(1)
    expect(cacheHookMock).toHaveBeenCalledWith('words', expect.any(Function))

    const onInvalidate = cacheHookMock.mock.calls[0][1]
    await act(async () => {
      onInvalidate()
    })

    await waitFor(() => expect(getMasteredWordsMock).toHaveBeenCalledTimes(2))
  })

  it('无限滚动：加载更多时按 id 去重并更新分页状态', async () => {
    const first = makeWord('a')
    getMasteredWordsMock.mockResolvedValueOnce(makePage([first], 30, 0))
    await renderHookAndWait()
    expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0)

    getMasteredWordsMock.mockResolvedValueOnce(makePage([first, makeWord('b')], 30, 1))
    act(() => {
      latestObserver().trigger()
    })

    await waitFor(() => expect(hook.items).toHaveLength(2))
    expect(hook.items.map((w) => w.id)).toEqual(['a', 'b'])
    expect(getMasteredWordsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 1 }),
    )
    expect(hook.loadingMore).toBe(false)
    expect(hook.hasMore).toBe(true)
  })

  it('加载更多失败：告警并保留已加载列表', async () => {
    getMasteredWordsMock.mockResolvedValueOnce(makePage([makeWord('a')], 30, 0))
    await renderHookAndWait()
    getMasteredWordsMock.mockRejectedValueOnce(new Error('network'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    act(() => {
      latestObserver().trigger()
    })

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[MasteredPage] 加载更多失败', expect.any(Error)),
    )
    expect(hook.items.map((w) => w.id)).toEqual(['a'])
    expect(hook.loadingMore).toBe(false)
  })

  it('已加载完全部数据后触发无限滚动不再请求', async () => {
    getMasteredWordsMock.mockResolvedValueOnce(makePage([makeWord('a')], 1, 0))
    await renderHookAndWait()
    expect(hook.hasMore).toBe(false)

    act(() => {
      latestObserver().trigger()
    })

    expect(getMasteredWordsMock).toHaveBeenCalledTimes(1)
  })
})
