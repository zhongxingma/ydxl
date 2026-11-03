// useReadingLifecycle 资源清理回归测试（长会话 / 反复进出阅读页场景）
//
// 背景：建议补一次长会话/反复进出页面的
// 内存快照回归。jsdom 无真实堆快照，这里用「资源计数」等价验证：反复进出阅读页后
// toast 自动消失定时器、进行中请求的 AbortController、缓存事件订阅均不残留。
//
// 可靠性保证（计数差法）：
// - 定时器只统计 3000ms（toast 自动消失）这一目标延迟的 setTimeout/clearTimeout，
//   按 timer id 配对（创建数 == 清除数、净待执数归 0），不受 React / 测试库
//   其它全局定时器噪声影响；断言基于挂载前后的计数差，不依赖绝对值。
// - AbortController 用实例 spy 断言每次退出恰好 abort 一次，不依赖真实网络。
// - 全部退出后推进假时间，行为级确认无悬空定时器回调。
//
// 覆盖：
// 1. 单次进出：卸载即中断进行中请求、清除 toast 自动消失定时器
// 2. 反复进出 20 次：定时器与请求中断不累积
// 3. 反复进出后缓存订阅不残留：卸载后缓存事件不再触发文章重读
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { Article, Difficulty, Topic } from '@/shared/types'
import { cacheEvents } from '@/shared/services/cacheEvents'
import { articleService } from '../../services/articleService'
import { useReadingLifecycle } from '../useReadingLifecycle'

vi.mock('../../services/articleService', () => ({
  articleService: {
    markAsRead: vi.fn(),
    getArticleById: vi.fn(),
  },
}))

const markAsReadMock = vi.mocked(articleService.markAsRead)
const getArticleByIdMock = vi.mocked(articleService.getArticleById)

// toast 自动消失延迟（useReadingLifecycle 中 setTimeout 的目标延迟）
const TOAST_DELAY = 3000

function makeArticle(overrides: Partial<Article> = {}): Article {
  const now = Date.now()
  return {
    id: 'a1',
    title: 'Title',
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 50,
    createdAt: now,
    updated_at: 100,
    ...overrides,
  }
}

interface SetupOptions {
  articleId?: string | null
  article?: Article | null
  status?: 'loading' | 'success' | 'error'
  view?: 'reading' | 'quiz' | 'grammar_quiz' | 'result'
  toast?: string | null
}

function setup(overrides: SetupOptions = {}) {
  const options = {
    articleId: overrides.articleId === undefined ? null : overrides.articleId,
    article: overrides.article ?? null,
    status: overrides.status ?? ('success' as const),
    view: overrides.view ?? ('reading' as const),
    toast: overrides.toast ?? null,
    setToast: vi.fn(),
    loadArticleById: vi.fn(async () => {}),
    loadToday: vi.fn(async () => {}),
    resetStore: vi.fn(),
    setArticle: vi.fn(),
    setShowDifficultyModal: vi.fn(),
    navigate: vi.fn(),
    mountedRef: { current: true } as MutableRefObject<boolean>,
    markedReadRef: { current: null } as MutableRefObject<string | null>,
    abortControllerRef: {
      current: null,
    } as MutableRefObject<AbortController | null>,
    selectedDifficultyRef: {
      current: undefined,
    } as MutableRefObject<Difficulty | undefined>,
    selectedTopicRef: {
      current: undefined,
    } as MutableRefObject<Topic | undefined>,
  }

  const { result, rerender, unmount } = renderHook(
    (props: typeof options) => useReadingLifecycle(props),
    { initialProps: options },
  )
  return { options, result, rerender, unmount }
}

// ---------- 定时器计数追踪（计数差法） ----------
// 仅追踪 TOAST_DELAY 的 setTimeout：按 timer id 配对创建/清除，
// 其它全局定时器（React 调度、测试库等）不计入，避免噪声
interface TimerTracker {
  pending: Set<unknown>
  created: number
  cleared: number
  clearCalls: number
}

function installTimerTracker(): TimerTracker {
  const tracker: TimerTracker = {
    pending: new Set(),
    created: 0,
    cleared: 0,
    clearCalls: 0,
  }
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
  ) => {
    const id = originalSetTimeout(handler, timeout)
    if (timeout === TOAST_DELAY) {
      tracker.pending.add(id)
      tracker.created++
    }
    return id
  }) as unknown as typeof globalThis.setTimeout)
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation((id?: unknown) => {
    tracker.clearCalls++
    if (tracker.pending.delete(id)) tracker.cleared++
    originalClearTimeout(id as Parameters<typeof globalThis.clearTimeout>[0])
  })
  return tracker
}

describe('useReadingLifecycle 资源清理回归（长会话 / 反复进出阅读页）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markAsReadMock.mockResolvedValue(true)
    getArticleByIdMock.mockResolvedValue(null as unknown as Article)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('单次进出阅读页：卸载即中断进行中请求并清除 toast 自动消失定时器', () => {
    vi.useFakeTimers()
    const timers = installTimerTracker()

    const { options, unmount } = setup({ articleId: 'a1', toast: '阅读提示' })
    // 挂载期间恰好注册 1 个 toast 自动消失定时器
    expect(timers.pending.size).toBe(1)

    // 挂载后存在进行中的 AI 请求（由 AbortController 承载）
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, 'abort')
    options.abortControllerRef.current = controller

    unmount()

    // abort 被调用：进行中请求被中断，不会在卸载后继续消耗资源
    expect(abortSpy).toHaveBeenCalledTimes(1)
    // clearTimeout 被调用：自动消失定时器不残留
    expect(timers.clearCalls).toBeGreaterThan(0)
    expect(timers.cleared).toBe(timers.created)
    expect(timers.pending.size).toBe(0)

    // 推进远超 3 秒：无悬空定时器回调（setToast 不再被调用）
    act(() => {
      vi.advanceTimersByTime(TOAST_DELAY * 4)
    })
    expect(options.setToast).not.toHaveBeenCalled()
  })

  it('反复进出阅读页 20 次：定时器与请求中断不累积', () => {
    vi.useFakeTimers()
    const timers = installTimerTracker()
    const N = 20
    const setToastMocks: ReturnType<typeof vi.fn>[] = []

    for (let i = 0; i < N; i++) {
      const { options, unmount } = setup({ articleId: 'a1', toast: `提示 ${i}` })
      setToastMocks.push(options.setToast)
      // 每次进入仅 1 个待执定时器：反复进出不累积
      expect(timers.pending.size).toBe(1)

      const controller = new AbortController()
      const abortSpy = vi.spyOn(controller, 'abort')
      options.abortControllerRef.current = controller

      unmount()
      // 每次退出恰好中断一次请求、清除全部待执定时器
      expect(abortSpy).toHaveBeenCalledTimes(1)
      expect(timers.pending.size).toBe(0)
    }

    // 20 次进出的定时器全部成对：创建数 == 清除数，净增量 0
    expect(timers.created).toBe(N)
    expect(timers.cleared).toBe(N)

    // 全部退出后推进时间：任何一次进入的定时器都不残留
    act(() => {
      vi.advanceTimersByTime(TOAST_DELAY * 10)
    })
    for (const setToast of setToastMocks) {
      expect(setToast).not.toHaveBeenCalled()
    }
  })

  it('反复进出后缓存订阅不残留：卸载后缓存事件不再触发文章重读', async () => {
    const article = makeArticle()

    const first = setup({ articleId: 'a1', article, status: 'success', view: 'reading' })
    act(() => {
      cacheEvents.emit('articles')
    })
    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(1))
    first.unmount()

    const second = setup({ articleId: 'a1', article, status: 'success', view: 'reading' })
    act(() => {
      cacheEvents.emit('articles')
    })
    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(2))
    second.unmount()

    // 两次退出后订阅全部取消：再 emit 不触发任何重读（监听器不残留）
    act(() => {
      cacheEvents.emit('articles')
    })
    await act(async () => {})
    expect(getArticleByIdMock).toHaveBeenCalledTimes(2)
  })
})
