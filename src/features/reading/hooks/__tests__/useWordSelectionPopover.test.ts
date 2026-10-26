// 选词浮层 hook
//
// 覆盖高亮词气泡、单选词查词（含标点清理）、多词批量、空 / 超长 / 无选区跳过、
// 选区去重、查词竞态与关闭失效、浮层内外 mouseup / 点击 / Escape、拖拽抑制与触控延迟。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Article, HighlightedWord } from '@/shared/types'
import type { WordLookup } from '../../types'
import { lookupWord } from '../../services/wordLookup'
import { useWordSelectionPopover } from '../useWordSelectionPopover'

vi.mock('../../services/wordLookup', () => ({
  lookupWord: vi.fn(),
}))

const lookupMock = vi.mocked(lookupWord)

const now = 1_700_000_000_000

const article: Article = {
  id: '2026-10-26',
  updated_at: now,
  title: 'A Day at School',
  content: 'Tom goes to school every day.',
  translation: '汤姆每天去上学。',
  genre: 'narrative',
  wordCount: 6,
  createdAt: now,
}

const appleLookup: WordLookup = {
  word: 'apple',
  phonetic: '/ˈæpl/',
  pos: 'n.',
  definition: '苹果',
}

const bananaLookup: WordLookup = {
  word: 'banana',
  phonetic: '/bəˈnɑːnə/',
  pos: 'n.',
  definition: '香蕉',
}

const highlighted: HighlightedWord = {
  word: 'school',
  phonetic: '/skuːl/',
  pos: 'n.',
  definition: '学校',
  example: 'I go to school.',
}

interface SelectionOptions {
  rangeCount?: number
  throws?: boolean
  rect?: DOMRect
}

function installSelection(text: string, options: SelectionOptions = {}) {
  const removeAllRanges = vi.fn()
  const rect =
    options.rect ??
    ({ top: 200, left: 100, width: 80, height: 20, bottom: 220, right: 180 } as DOMRect)
  const getBoundingClientRect = vi.fn(() => {
    if (options.throws) throw new Error('range error')
    return rect
  })
  const selection = {
    toString: () => text,
    rangeCount: options.rangeCount ?? 1,
    getRangeAt: () => ({ getBoundingClientRect }),
    removeAllRanges,
  }
  vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
  return { removeAllRanges, getBoundingClientRect }
}

function mouseUpEvent(target: EventTarget = document.body): React.MouseEvent<HTMLDivElement> {
  return { target } as unknown as React.MouseEvent<HTMLDivElement>
}

function renderPopover() {
  return renderHook(() => useWordSelectionPopover(article))
}

describe('useWordSelectionPopover 选词浮层', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lookupMock.mockResolvedValue(appleLookup)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('初始状态：无浮层且提供容器与浮层引用', () => {
    const { result } = renderPopover()

    expect(result.current.popover).toBeNull()
    expect(result.current.containerRef).toBeDefined()
    expect(result.current.popoverRef).toBeDefined()
  })

  it('点击高亮词：弹出气泡并按视口坐标定位', () => {
    const { result } = renderPopover()
    const rect = { top: 200, left: 100, width: 100, height: 20 } as DOMRect

    act(() => {
      result.current.handleHighlightedWordClick(highlighted, rect)
    })

    expect(result.current.popover).toEqual({
      kind: 'highlight',
      position: { top: 192, left: 150 },
      word: highlighted,
      added: false,
    })
  })

  it('单选词查词：清理尾随标点、展示加载态并写入结果', async () => {
    const { result } = renderPopover()
    const { removeAllRanges } = installSelection('apple.')
    let resolveLookup!: (value: WordLookup | null) => void
    lookupMock.mockReturnValue(
      new Promise<WordLookup | null>((resolve) => {
        resolveLookup = resolve
      }),
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.handleMouseUp(mouseUpEvent())
    })

    expect(lookupMock).toHaveBeenCalledWith('apple')
    expect(result.current.popover).toMatchObject({
      kind: 'lookup',
      lookup: null,
      loading: true,
      added: false,
    })
    expect(removeAllRanges).toHaveBeenCalled()

    await act(async () => {
      resolveLookup(appleLookup)
      await pending
    })

    expect(result.current.popover).toMatchObject({
      kind: 'lookup',
      lookup: appleLookup,
      loading: false,
    })
  })

  it('多词选区：进入批量收藏浮层且不查词', async () => {
    const { result } = renderPopover()
    installSelection('apple banana')

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })

    expect(lookupMock).not.toHaveBeenCalled()
    expect(result.current.popover).toEqual({
      kind: 'batch',
      position: { top: 192, left: 140 },
      words: ['apple', 'banana'],
      processing: false,
      result: null,
    })
  })

  it('空选区与超长选区均不触发查词', async () => {
    const { result } = renderPopover()

    installSelection('   ')
    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })
    expect(result.current.popover).toBeNull()

    installSelection('a'.repeat(201))
    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })
    expect(result.current.popover).toBeNull()
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('getSelection 返回 null 时安全返回', async () => {
    const { result } = renderPopover()
    vi.spyOn(window, 'getSelection').mockReturnValue(null)

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })

    expect(lookupMock).not.toHaveBeenCalled()
    expect(result.current.popover).toBeNull()
  })

  it('同一选区文本重复触发只查词一次', async () => {
    const { result } = renderPopover()
    installSelection('apple')

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })
    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })

    expect(lookupMock).toHaveBeenCalledTimes(1)
  })

  it('无选区范围（rangeCount=0）时不展示浮层', async () => {
    const { result } = renderPopover()
    installSelection('apple', { rangeCount: 0 })

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })

    expect(lookupMock).not.toHaveBeenCalled()
    expect(result.current.popover).toBeNull()
  })

  it('获取选区坐标抛错时安全返回', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderPopover()
    installSelection('apple', { throws: true })

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[useWordLookup] 获取选区坐标失败',
      expect.any(Error),
    )
    expect(lookupMock).not.toHaveBeenCalled()
    expect(result.current.popover).toBeNull()
  })

  it('查词失败：告警并展示空结果', async () => {
    lookupMock.mockRejectedValue(new Error('lookup down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderPopover()
    installSelection('apple')

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })

    expect(warnSpy).toHaveBeenCalledWith('[useWordLookup] 查词失败', expect.any(Error))
    expect(result.current.popover).toEqual({
      kind: 'lookup',
      position: { top: 192, left: 140 },
      lookup: null,
      loading: false,
      added: false,
    })
  })

  it('竞态：旧查词结果晚到时不覆盖新结果', async () => {
    const { result } = renderPopover()
    let resolveFirst!: (value: WordLookup | null) => void
    lookupMock.mockReturnValueOnce(
      new Promise<WordLookup | null>((resolve) => {
        resolveFirst = resolve
      }),
    )
    installSelection('apple')

    let firstPending!: Promise<void>
    act(() => {
      firstPending = result.current.handleMouseUp(mouseUpEvent())
    })

    installSelection('banana')
    lookupMock.mockResolvedValueOnce(bananaLookup)
    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent())
    })
    expect(result.current.popover).toMatchObject({ lookup: bananaLookup })

    await act(async () => {
      resolveFirst(appleLookup)
      await firstPending
    })
    expect(result.current.popover).toMatchObject({ lookup: bananaLookup })
  })

  it('关闭浮层使在途查词结果失效', async () => {
    const { result } = renderPopover()
    let resolveLookup!: (value: WordLookup | null) => void
    lookupMock.mockReturnValue(
      new Promise<WordLookup | null>((resolve) => {
        resolveLookup = resolve
      }),
    )
    installSelection('apple')

    let pending!: Promise<void>
    act(() => {
      pending = result.current.handleMouseUp(mouseUpEvent())
    })
    expect(result.current.popover).not.toBeNull()

    act(() => {
      result.current.closePopover()
    })
    expect(result.current.popover).toBeNull()

    await act(async () => {
      resolveLookup(appleLookup)
      await pending
    })
    expect(result.current.popover).toBeNull()
  })

  it('浮层内 mouseup 不触发查词', async () => {
    const { result } = renderPopover()
    const popoverEl = document.createElement('div')
    const child = document.createElement('span')
    popoverEl.appendChild(child)
    ;(result.current.popoverRef as { current: HTMLDivElement | null }).current = popoverEl
    installSelection('apple')

    await act(async () => {
      await result.current.handleMouseUp(mouseUpEvent(child))
    })

    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('点击浮层外关闭浮层，点击浮层内保持', () => {
    const { result } = renderPopover()
    act(() => {
      result.current.handleHighlightedWordClick(highlighted, {
        top: 100,
        left: 100,
        width: 20,
        height: 20,
      } as DOMRect)
    })
    const popoverEl = document.createElement('div')
    const child = document.createElement('span')
    popoverEl.appendChild(child)
    ;(result.current.popoverRef as { current: HTMLDivElement | null }).current = popoverEl

    act(() => {
      child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(result.current.popover).not.toBeNull()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(result.current.popover).toBeNull()
  })

  it('Escape 关闭浮层', () => {
    const { result } = renderPopover()
    act(() => {
      result.current.handleHighlightedWordClick(highlighted, {
        top: 100,
        left: 100,
        width: 20,
        height: 20,
      } as DOMRect)
    })

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(result.current.popover).toBeNull()
  })

  it('拖拽期间 selectionchange 不查词，抬起后恢复', async () => {
    renderPopover()
    installSelection('apple')

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(lookupMock).not.toHaveBeenCalled()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(lookupMock).toHaveBeenCalledWith('apple')
  })

  it('触控结束延迟 300ms 后查词', async () => {
    vi.useFakeTimers()
    const { result } = renderPopover()
    installSelection('apple')

    const pending = result.current.handleTouchEnd(
      { target: document.body } as unknown as React.TouchEvent<HTMLDivElement>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await act(async () => {
      await pending
    })

    expect(lookupMock).toHaveBeenCalledWith('apple')
  })

  it('浮层内触控结束不查词', async () => {
    vi.useFakeTimers()
    const { result } = renderPopover()
    const popoverEl = document.createElement('div')
    const child = document.createElement('span')
    popoverEl.appendChild(child)
    ;(result.current.popoverRef as { current: HTMLDivElement | null }).current = popoverEl
    installSelection('apple')

    await act(async () => {
      await result.current.handleTouchEnd(
        { target: child } as unknown as React.TouchEvent<HTMLDivElement>,
      )
    })

    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('切换文章时清除浮层', () => {
    const { result, rerender } = renderHook(
      ({ currentArticle }) => useWordSelectionPopover(currentArticle),
      { initialProps: { currentArticle: article } },
    )

    act(() => {
      result.current.handleHighlightedWordClick(highlighted, {
        top: 100,
        left: 100,
        width: 20,
        height: 20,
      } as DOMRect)
    })
    expect(result.current.popover).not.toBeNull()

    rerender({ currentArticle: { ...article, id: '2026-10-27' } })

    expect(result.current.popover).toBeNull()
  })
})
