// 查词浮层生词本动作 hook
//
// 覆盖高亮词 / 查词结果加入生词本、批量加入、成功后的自动关闭、
// 网络与通用错误提示、重复提交守卫与非目标浮层空操作。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { HighlightedWord, Word } from '@/shared/types'
import { wordbookService } from '@/features/wordbook'
import type { PopoverState } from '../../components/articleUtils'
import { useWordbookActions } from '../useWordbookActions'

vi.mock('@/features/wordbook', () => ({
  wordbookService: {
    addToWordbook: vi.fn(),
    bulkAddToWordbook: vi.fn(),
  },
}))

const addMock = vi.mocked(wordbookService.addToWordbook)
const bulkMock = vi.mocked(wordbookService.bulkAddToWordbook)

const ARTICLE_ID = '2026-10-26'

const highlighted: HighlightedWord = {
  word: 'apple',
  phonetic: '/ˈæpl/',
  pos: 'n.',
  definition: '苹果',
  example: 'I ate an apple.',
}

function makeWord(): Word {
  const now = Date.now()
  return {
    id: 'apple',
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple.',
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

function renderActions(popover: PopoverState | null) {
  const setPopover = vi.fn()
  const closePopover = vi.fn()
  const showToast = vi.fn()
  const utils = renderHook(() =>
    useWordbookActions({
      popover,
      setPopover,
      articleId: ARTICLE_ID,
      closePopover,
      showToast,
    }),
  )
  return { ...utils, setPopover, closePopover, showToast }
}

function highlightPopover(added = false): PopoverState {
  return { kind: 'highlight', position: { top: 10, left: 20 }, word: highlighted, added }
}

function lookupPopover(added = false): PopoverState {
  return {
    kind: 'lookup',
    position: { top: 10, left: 20 },
    lookup: { word: 'apple', phonetic: '/ˈæpl/', pos: 'n.', definition: '苹果' },
    loading: false,
    added,
  }
}

function batchPopover(processing = false): PopoverState {
  return {
    kind: 'batch',
    position: { top: 10, left: 20 },
    words: ['apple', 'banana'],
    processing,
    result: null,
  }
}

describe('useWordbookActions 生词本写入', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addMock.mockResolvedValue(makeWord())
    bulkMock.mockResolvedValue({ added: 2, failed: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('高亮词加入成功：补全标记、提示语与 1.2 秒后关闭', async () => {
    vi.useFakeTimers()
    const { result, setPopover, closePopover, showToast } = renderActions(highlightPopover())

    await act(async () => {
      await result.current.handleAddHighlightedToWordbook()
    })

    expect(addMock).toHaveBeenCalledWith({
      word: 'apple',
      phonetic: '/ˈæpl/',
      pos: 'n.',
      definition: '苹果',
      example: 'I ate an apple.',
      sourceArticleId: ARTICLE_ID,
      enrichIfMissing: true,
    })
    expect(setPopover).toHaveBeenCalledWith({ ...highlightPopover(), added: true })
    expect(showToast).toHaveBeenCalledWith('已加入「apple」到生词本')

    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(closePopover).toHaveBeenCalledTimes(1)
  })

  it('高亮词已加入时重复点击为空操作', async () => {
    const { result } = renderActions(highlightPopover(true))

    await act(async () => {
      await result.current.handleAddHighlightedToWordbook()
    })

    expect(addMock).not.toHaveBeenCalled()
  })

  it('高亮词加入遇到网络错误：提示网络异常', async () => {
    addMock.mockRejectedValue(new Error('Failed to fetch'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, showToast } = renderActions(highlightPopover())

    await act(async () => {
      await result.current.handleAddHighlightedToWordbook()
    })

    expect(showToast).toHaveBeenCalledWith('网络异常，请检查连接')
    expect(warnSpy).toHaveBeenCalledWith(
      '[useWordLookup] 高亮词加入生词本失败',
      expect.any(Error),
    )
  })

  it('高亮词加入遇到其他错误：提示重试', async () => {
    addMock.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, showToast } = renderActions(highlightPopover())

    await act(async () => {
      await result.current.handleAddHighlightedToWordbook()
    })

    expect(showToast).toHaveBeenCalledWith('加入失败，请重试')
  })

  it('查词结果加入成功：传入文章 id 与补全标记', async () => {
    vi.useFakeTimers()
    const { result, setPopover, closePopover, showToast } = renderActions(lookupPopover())

    await act(async () => {
      await result.current.handleAddLookupToWordbook()
    })

    expect(addMock).toHaveBeenCalledWith({
      word: 'apple',
      phonetic: '/ˈæpl/',
      pos: 'n.',
      definition: '苹果',
      sourceArticleId: ARTICLE_ID,
      enrichIfMissing: true,
    })
    expect(setPopover).toHaveBeenCalledWith({ ...lookupPopover(), added: true })
    expect(showToast).toHaveBeenCalledWith('已加入「apple」到生词本')

    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(closePopover).toHaveBeenCalledTimes(1)
  })

  it('查词浮层缺少查词结果时为空操作', async () => {
    const { result } = renderActions({
      kind: 'lookup',
      position: { top: 10, left: 20 },
      lookup: null,
      loading: false,
      added: false,
    })

    await act(async () => {
      await result.current.handleAddLookupToWordbook()
    })

    expect(addMock).not.toHaveBeenCalled()
  })

  it('查词结果加入遇到网络错误：提示网络异常', async () => {
    addMock.mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, showToast } = renderActions(lookupPopover())

    await act(async () => {
      await result.current.handleAddLookupToWordbook()
    })

    expect(showToast).toHaveBeenCalledWith('网络异常，请检查连接')
  })

  it('批量加入成功：先置处理中，完成后写入结果并 1.5 秒关闭', async () => {
    vi.useFakeTimers()
    bulkMock.mockResolvedValue({ added: 1, failed: 1 })
    const { result, setPopover, closePopover, showToast } = renderActions(batchPopover())

    await act(async () => {
      await result.current.handleBatchAdd()
    })

    expect(bulkMock).toHaveBeenCalledWith(['apple', 'banana'])
    expect(setPopover).toHaveBeenNthCalledWith(1, { ...batchPopover(), processing: true })
    expect(setPopover).toHaveBeenNthCalledWith(2, {
      ...batchPopover(),
      processing: false,
      result: { added: 1, failed: 1 },
    })
    expect(showToast).toHaveBeenCalledWith('成功添加 1 个词到生词本')

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(closePopover).toHaveBeenCalledTimes(1)
  })

  it('批量加入失败：恢复可操作状态并提示重试', async () => {
    bulkMock.mockRejectedValue(new Error('bulk failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, setPopover, closePopover, showToast } = renderActions(batchPopover())

    await act(async () => {
      await result.current.handleBatchAdd()
    })

    expect(setPopover).toHaveBeenLastCalledWith({ ...batchPopover(), processing: false })
    expect(showToast).toHaveBeenCalledWith('批量添加失败，请重试')
    expect(closePopover).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[ArticleView] 批量加入生词本失败',
      expect.any(Error),
    )
  })

  it('批量处理中重复点击为空操作', async () => {
    const { result } = renderActions(batchPopover(true))

    await act(async () => {
      await result.current.handleBatchAdd()
    })

    expect(bulkMock).not.toHaveBeenCalled()
  })

  it('浮层类型不匹配时三个动作均为空操作', async () => {
    const { result } = renderActions(lookupPopover())

    await act(async () => {
      await result.current.handleAddHighlightedToWordbook()
      await result.current.handleBatchAdd()
    })

    expect(addMock).not.toHaveBeenCalled()
    expect(bulkMock).not.toHaveBeenCalled()
  })

  it('无浮层时三个动作均为空操作', async () => {
    const { result } = renderActions(null)

    await act(async () => {
      await result.current.handleAddHighlightedToWordbook()
      await result.current.handleAddLookupToWordbook()
      await result.current.handleBatchAdd()
    })

    expect(addMock).not.toHaveBeenCalled()
    expect(bulkMock).not.toHaveBeenCalled()
  })
})
