// WordCard 生词卡片容器组件单元测试
//
// 覆盖场景：
// 1. 头部 / 详情 / 底部子组件收到 word、掌握与顽固徽章标记、刷新回调
// 2. 选择框切换调用 onSelect，选中态应用高亮边框
// 3. 子组件调用 showToast 展示提示并 3 秒自动消失
// 4. 连续 toast 会重置自动消失计时器
// 5. 长按 500ms 触发 onLongPress；抬起取消不触发
// 6. 卸载时清理 toast 定时器
//
// Mock 策略：mock 三个子组件以隔离 AI / 语音依赖，仅捕获 props 与触发回调；
// 长按手势使用真实 useLongPress 配合 fake timers。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Word } from '@/shared/types'

const captured = vi.hoisted(() => ({
  header: null as unknown,
  details: null as unknown,
  footer: null as unknown,
}))

vi.mock('../WordCardHeader', () => ({
  default: (props: { showToast: (msg: string) => void }) => {
    captured.header = props
    return (
      <button type="button" onClick={() => props.showToast('已收藏')}>
        header-toast
      </button>
    )
  },
}))
vi.mock('../WordCardDetails', () => ({
  default: (props: unknown) => {
    captured.details = props
    return <div data-testid="details" />
  },
}))
vi.mock('../WordCardFooter', () => ({
  default: (props: unknown) => {
    captured.footer = props
    return <div data-testid="footer" />
  },
}))

import WordCard from '../WordCard'

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'apple',
    updated_at: now,
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    ...overrides,
  }
}

function renderCard(
  options: {
    word?: Word
    selected?: boolean
    onSelect?: (id: string) => void
    onLongPress?: (word: Word) => void
  } = {},
) {
  const word = options.word ?? makeWord()
  const onSelect = options.onSelect ?? vi.fn()
  const onLongPress = options.onLongPress ?? vi.fn()
  const onEditNote = vi.fn()
  const onDelete = vi.fn()
  const onRefresh = vi.fn()
  const utils = render(
    <WordCard
      word={word}
      selected={options.selected ?? false}
      onSelect={onSelect}
      onEditNote={onEditNote}
      onDelete={onDelete}
      onLongPress={onLongPress}
      onRefresh={onRefresh}
    />,
  )
  return { ...utils, word, onSelect, onLongPress, onEditNote, onDelete, onRefresh }
}

describe('WordCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('子组件收到 word、掌握与顽固标记及刷新回调', () => {
    const word = makeWord({ mastery: 5, stubbornCount: 3 })
    renderCard({ word })

    const header = captured.header as {
      word: Word
      isMastered: boolean
      isStubborn: boolean
      onRefresh: () => void
      showToast: (msg: string) => void
    }
    expect(header.word).toBe(word)
    expect(header.isMastered).toBe(true)
    expect(header.isStubborn).toBe(true)
    expect(header.onRefresh).toBeTypeOf('function')

    const details = captured.details as { word: Word; onRefresh: () => void }
    expect(details.word).toBe(word)
    expect(details.onRefresh).toBeTypeOf('function')

    const footer = captured.footer as {
      word: Word
      onEditNote: (w: Word) => void
      onDelete: (w: Word) => void
    }
    expect(footer.word).toBe(word)
  })

  it('未达阈值时掌握与顽固标记为 false', () => {
    renderCard({ word: makeWord({ mastery: 4, stubbornCount: 2 }) })

    const header = captured.header as { isMastered: boolean; isStubborn: boolean }
    expect(header.isMastered).toBe(false)
    expect(header.isStubborn).toBe(false)
  })

  it('选择框切换调用 onSelect，选中态应用高亮边框', () => {
    const onSelect = vi.fn()
    const { container } = renderCard({ selected: true, onSelect })

    expect(container.firstElementChild?.className).toContain('border-indigo-400')

    fireEvent.click(screen.getByRole('checkbox'))
    expect(onSelect).toHaveBeenCalledWith('apple')
  })

  it('子组件调用 showToast 展示提示并在 3 秒后自动消失', () => {
    renderCard()

    fireEvent.click(screen.getByText('header-toast'))
    expect(screen.getByText('已收藏')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('已收藏')).not.toBeInTheDocument()
  })

  it('连续 toast 重置自动消失计时器', () => {
    renderCard()
    const header = captured.header as { showToast: (msg: string) => void }

    act(() => {
      header.showToast('第一条')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => {
      header.showToast('第二条')
    })
    // 距第一条 3 秒时，第二条仍在展示（旧计时器已被清理）
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('第二条')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByText('第二条')).not.toBeInTheDocument()
  })

  it('长按 500ms 触发 onLongPress，抬起则取消', () => {
    const onLongPress = vi.fn()
    const { word, container } = renderCard({ onLongPress })
    const root = container.firstElementChild as HTMLElement

    fireEvent.mouseDown(root)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onLongPress).toHaveBeenCalledWith(word)

    onLongPress.mockClear()
    fireEvent.mouseDown(root)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    fireEvent.mouseUp(root)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('卸载时清理 toast 定时器', () => {
    const { unmount } = renderCard()

    fireEvent.click(screen.getByText('header-toast'))
    unmount()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('已收藏')).not.toBeInTheDocument()
  })
})
