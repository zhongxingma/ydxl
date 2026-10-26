// MasteredPage 已掌握单词页单元测试
//
// 覆盖场景：
// 1. 首次加载骨架与总数概览的显隐
// 2. 空状态引导
// 3. 列表网格与底部哨兵三种文案（加载更多 / 滚动加载 / 没有更多）
// 4. 搜索输入与排序切换回调
//
// Mock 策略：mock useMasteredWords 控制列表状态，mock 卡片组件聚焦页面编排。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Word } from '@/shared/types'
import type { MasteredSortBy } from '../../types'
import { useMasteredWords } from '../../hooks/useMasteredWords'
import MasteredPage from '../MasteredPage'

interface HookResult {
  items: Word[]
  total: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  searchInput: string
  setSearchInput: (value: string) => void
  sortBy: MasteredSortBy
  setSortBy: (value: MasteredSortBy) => void
  sentinelRef: { current: HTMLDivElement | null }
}

vi.mock('../../hooks/useMasteredWords', () => ({
  useMasteredWords: vi.fn(),
}))

vi.mock('../../components/MasteredWordCard', () => ({
  default: ({ word }: { word: Word }) => (
    <div data-testid="mastered-card">{word.word}</div>
  ),
}))

const hookMock = vi.mocked(useMasteredWords)

function makeWord(id: string): Word {
  const now = Date.now()
  return {
    id,
    updated_at: now,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 5,
    nextReview: now,
    lastReview: now,
    reviewCount: 1,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
  }
}

function setupHook(overrides: Partial<HookResult> = {}): HookResult {
  const result: HookResult = {
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    searchInput: '',
    setSearchInput: vi.fn(),
    sortBy: 'masteredAt-desc',
    setSortBy: vi.fn(),
    sentinelRef: { current: null },
    ...overrides,
  }
  hookMock.mockReturnValue(result as never)
  return result
}

describe('MasteredPage 已掌握页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('首次加载且无数据时展示加载文案，不展示总数', () => {
    setupHook({ loading: true, items: [], total: 0 })

    render(<MasteredPage />)

    expect(screen.getByText('加载中…')).toBeInTheDocument()
    expect(screen.queryByText(/共 \d+ 个/)).not.toBeInTheDocument()
  })

  it('无已掌握单词时展示空状态引导', () => {
    setupHook({ total: 0, items: [] })

    render(<MasteredPage />)

    expect(screen.getByText('还没有已掌握的单词，继续加油 💪')).toBeInTheDocument()
    expect(
      screen.getByText('通过复习让单词达到掌握即可在此查看')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('mastered-card')).not.toBeInTheDocument()
  })

  it('有数据时展示总数、卡片网格与「没有更多了」', () => {
    setupHook({
      items: [makeWord('apple'), makeWord('banana')],
      total: 2,
      hasMore: false,
    })

    render(<MasteredPage />)

    expect(screen.getByText('共 2 个')).toBeInTheDocument()
    expect(screen.getAllByTestId('mastered-card')).toHaveLength(2)
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('没有更多了')).toBeInTheDocument()
  })

  it('hasMore 为 true 时展示滚动加载提示', () => {
    setupHook({ items: [makeWord('apple')], total: 30, hasMore: true })

    render(<MasteredPage />)

    const sentinel = screen.getByText('滚动加载更多')
    expect(sentinel).toHaveAttribute('aria-hidden', 'true')
  })

  it('加载更多时展示加载文案并解除 aria-hidden', () => {
    setupHook({
      items: [makeWord('apple')],
      total: 30,
      hasMore: true,
      loadingMore: true,
    })

    render(<MasteredPage />)

    const sentinel = screen.getByText('加载更多…')
    expect(sentinel).not.toHaveAttribute('aria-hidden')
  })

  it('搜索输入与排序切换分别调用对应回调', () => {
    const result = setupHook({ items: [makeWord('apple')], total: 1 })

    render(<MasteredPage />)

    fireEvent.change(screen.getByLabelText('搜索单词'), {
      target: { value: 'app' },
    })
    expect(result.setSearchInput).toHaveBeenCalledWith('app')

    fireEvent.change(screen.getByLabelText('排序方式'), {
      target: { value: 'alphabet' },
    })
    expect(result.setSortBy).toHaveBeenCalledWith('alphabet')
  })
})
