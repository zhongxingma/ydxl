// useReadingLifecycle 阅读页生命周期副作用单元测试
//
// 覆盖场景：
// 1. 首次挂载：有 articleId 时加载指定文章，否则弹出难度选择；卸载时重置挂载标志、
//    中断请求并重置阅读 store
// 2. 进入成绩单视图时标记文章已读，同一文章不重复标记
// 3. articles 缓存事件：视图 / 加载状态 / 文章 / URL 一致性判断与增量更新
// 4. 缓存重读失败记录警告；卸载后丢弃结果
// 5. toast 3 秒自动消失与定时器清理
// 6. 难度选择确认 / 取消的弹窗、记忆与导航行为
//
// Mock 策略：mock articleService；路由导航与状态更新均使用 mock 函数
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    { initialProps: options }
  )
  return { options, result, rerender, unmount }
}

function emitArticles() {
  act(() => {
    cacheEvents.emit('articles')
  })
}

describe('useReadingLifecycle 阅读页生命周期', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    markAsReadMock.mockResolvedValue(true)
    getArticleByIdMock.mockResolvedValue(null as unknown as Article)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('有 articleId 时加载指定文章；卸载时中断请求并重置 store', () => {
    const { options, unmount } = setup({ articleId: 'a1' })
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, 'abort')
    options.abortControllerRef.current = controller
    options.mountedRef.current = true

    expect(options.loadArticleById).toHaveBeenCalledWith('a1')
    expect(options.setShowDifficultyModal).not.toHaveBeenCalled()

    unmount()

    expect(options.mountedRef.current).toBe(false)
    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(options.resetStore).toHaveBeenCalledTimes(1)
  })

  it('无 articleId 时弹出难度选择且不加载文章', () => {
    const { options } = setup()

    expect(options.setShowDifficultyModal).toHaveBeenCalledWith(true)
    expect(options.loadArticleById).not.toHaveBeenCalled()
  })

  it('进入成绩单视图时标记已读，同一文章不重复标记', () => {
    const article = makeArticle()
    const { options, rerender } = setup({ articleId: 'a1', article, view: 'result' })

    expect(markAsReadMock).toHaveBeenCalledWith('a1')
    expect(options.markedReadRef.current).toBe('a1')

    rerender({ ...options, view: 'result' })
    expect(markAsReadMock).toHaveBeenCalledTimes(1)
  })

  it('已标记过的文章或非成绩单视图不触发标记', () => {
    const article = makeArticle()
    const { options, rerender } = setup({ article: article, view: 'reading' })
    expect(markAsReadMock).not.toHaveBeenCalled()

    options.markedReadRef.current = 'a1'
    rerender({ ...options, view: 'result' })
    expect(markAsReadMock).not.toHaveBeenCalled()
  })

  it('articles 缓存事件在阅读视图重读文章并在更新时写入', async () => {
    const article = makeArticle({ updated_at: 100 })
    const fresh = makeArticle({ updated_at: 200, translation: '新译文' })
    getArticleByIdMock.mockResolvedValue(fresh)

    const { options } = setup({ articleId: 'a1', article, status: 'success', view: 'reading' })
    emitArticles()

    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(options.setArticle).toHaveBeenCalledWith(fresh))
  })

  it('articles 缓存事件在非阅读视图或加载中时跳过', async () => {
    const article = makeArticle()

    setup({ articleId: 'a1', article, view: 'result', status: 'success' })
    emitArticles()
    await act(async () => {})

    setup({ articleId: 'a1', article, view: 'reading', status: 'loading' })
    emitArticles()
    await act(async () => {})

    expect(getArticleByIdMock).not.toHaveBeenCalled()
  })

  it('无文章时 articles 缓存事件直接跳过', async () => {
    setup({ articleId: 'a1', article: null })

    emitArticles()
    await act(async () => {})

    expect(getArticleByIdMock).not.toHaveBeenCalled()
  })

  it('重读结果为空或文章已切换时不写入', async () => {
    const article = makeArticle({ updated_at: 100 })

    // 远程返回 null
    getArticleByIdMock.mockResolvedValueOnce(null as unknown as Article)
    const noFresh = setup({ articleId: 'a1', article })
    emitArticles()
    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(noFresh.options.setArticle).not.toHaveBeenCalled()
    noFresh.unmount()

    // 远程返回其他文章
    getArticleByIdMock.mockResolvedValueOnce(makeArticle({ id: 'other', updated_at: 300 }))
    const switched = setup({ articleId: 'a1', article })
    emitArticles()
    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(switched.options.setArticle).not.toHaveBeenCalled()
  })

  it('URL articleId 与远程返回不一致时不写入', async () => {
    const article = makeArticle({ updated_at: 100 })
    getArticleByIdMock.mockResolvedValueOnce(makeArticle({ id: 'a1', updated_at: 300 }))

    const { options } = setup({ articleId: 'a2', article })
    emitArticles()

    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(1))
    await act(async () => {})

    expect(options.setArticle).not.toHaveBeenCalled()
  })

  it('远程 updated_at 不更新时不覆盖本地文章', async () => {
    const article = makeArticle({ updated_at: 100 })
    getArticleByIdMock.mockResolvedValue(makeArticle({ updated_at: 100 }))

    const { options } = setup({ articleId: 'a1', article })
    emitArticles()

    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(1))
    await act(async () => {})

    expect(options.setArticle).not.toHaveBeenCalled()
  })

  it('缓存重读失败时记录警告', async () => {
    const article = makeArticle()
    getArticleByIdMock.mockRejectedValue(new Error('offline'))

    setup({ articleId: 'a1', article })
    emitArticles()

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[ReadingPage] articles 事件重读失败',
        expect.any(Error)
      )
    )
  })

  it('组件卸载后丢弃缓存重读结果', async () => {
    const article = makeArticle()
    let resolveFresh: (value: Article) => void = () => {}
    getArticleByIdMock.mockReturnValue(
      new Promise<Article>((resolve) => {
        resolveFresh = resolve
      })
    )

    const { options, unmount } = setup({ articleId: 'a1', article })
    emitArticles()
    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledTimes(1))

    unmount()
    await act(async () => {
      resolveFresh(makeArticle({ updated_at: 999 }))
    })

    expect(options.setArticle).not.toHaveBeenCalled()
  })

  it('toast 3 秒后自动清除，toast 变化会重置定时器', () => {
    vi.useFakeTimers()
    const { options, rerender } = setup({ toast: '第一条' })

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(options.setToast).not.toHaveBeenCalled()

    rerender({ ...options, toast: '第二条' })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(options.setToast).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(options.setToast).toHaveBeenCalledTimes(1)
    expect(options.setToast).toHaveBeenCalledWith(null)
  })

  it('toast 为空时不设定时器', () => {
    vi.useFakeTimers()
    const { options } = setup({ toast: null })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(options.setToast).not.toHaveBeenCalled()
  })

  it('难度选择确认：记忆选项、关闭弹窗并加载文章', () => {
    const { result, options } = setup()

    act(() => {
      result.current.handleDifficultySelect('hard', 'science')
    })

    expect(options.selectedDifficultyRef.current).toBe('hard')
    expect(options.selectedTopicRef.current).toBe('science')
    expect(options.setShowDifficultyModal).toHaveBeenCalledWith(false)
    expect(options.loadToday).toHaveBeenCalledWith('hard', 'science')
  })

  it('难度选择取消：无文章时返回首页，有文章仅关闭弹窗', () => {
    const empty = setup({ article: null })
    act(() => {
      empty.result.current.handleDifficultyCancel()
    })
    expect(empty.options.setShowDifficultyModal).toHaveBeenCalledWith(false)
    expect(empty.options.navigate).toHaveBeenCalledWith('/')

    const withArticle = setup({ article: makeArticle() })
    act(() => {
      withArticle.result.current.handleDifficultyCancel()
    })
    expect(withArticle.options.setShowDifficultyModal).toHaveBeenCalledWith(false)
    expect(withArticle.options.navigate).not.toHaveBeenCalled()
  })
})
