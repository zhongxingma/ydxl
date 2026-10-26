// ReviewPage 复习页视图路由测试
//
// ReviewPage 仅负责三视图路由与共享 overlay，本文件 mock useReviewPage 状态机
// 与子视图组件，验证：
// 1. list 视图：有待复习量时显示进度条，无待复习量时隐藏
// 2. review 视图：currentWord + currentStep 齐备时渲染会话视图
// 3. review 视图：currentStep 缺失时回退为空（不渲染会话视图）
// 4. complete 视图：渲染完成评价视图
// 5. 子视图回调（刷新列表 / 返回列表 / 评分）正确接线
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Word } from '@/shared/types'

interface ReviewPageState {
  view: 'list' | 'review' | 'complete'
  queueInfo: { total: number }
  status: 'loading' | 'ready' | 'error'
  errorMsg: string
  celebrating: boolean
  celebrationText: string
  unlockedAchievements: unknown[]
  setUnlockedAchievements: (value: unknown[]) => void
  sessionReviewedCount: number
  currentWord: Word | null
  currentStep: string | null
  unlockedSteps: string[]
  completedSteps: string[]
  reviewQueue: Word[]
  goToStep: (step: string) => void
  initialTotal: number
  reviewProgress: number
  isReviewComplete: boolean
  stageLabel: string
  loadList: () => Promise<void>
  handleWordClick: (word: Word) => void
  handleComplete: () => void
  handleBackToList: () => void
  handleRating: (rating: string) => void
  handleCelebrationComplete: () => void
}

const callbacks = vi.hoisted(() => ({
  loadList: vi.fn(async () => {}),
  setUnlockedAchievements: vi.fn(),
  handleWordClick: vi.fn(),
  handleComplete: vi.fn(),
  handleBackToList: vi.fn(),
  handleRating: vi.fn(),
  handleCelebrationComplete: vi.fn(),
  goToStep: vi.fn(),
}))

const mocks = vi.hoisted(() => ({
  state: {} as ReviewPageState,
}))

vi.mock('../../hooks/useReviewPage', () => ({
  useReviewPage: () => mocks.state,
}))

vi.mock('../../components/ReviewListView', () => ({
  default: ({
    onReload,
    onWordClick,
    errorMsg,
  }: {
    onReload: () => void
    onWordClick: (word: Word) => void
    errorMsg: string
  }) => (
    <div>
      <span>list-view:{errorMsg}</span>
      <button type="button" onClick={onReload}>
        刷新列表
      </button>
      <button type="button" onClick={() => onWordClick({ id: 'apple' } as Word)}>
        点击单词
      </button>
    </div>
  ),
}))

vi.mock('../../components/ReviewSessionView', () => ({
  default: ({
    onBackToList,
    onComplete,
  }: {
    onBackToList: () => void
    onComplete: () => void
  }) => (
    <div>
      <span>session-view</span>
      <button type="button" onClick={onBackToList}>
        返回列表
      </button>
      <button type="button" onClick={onComplete}>
        完成复习
      </button>
    </div>
  ),
}))

vi.mock('../../components/ReviewCompleteView', () => ({
  default: ({
    onRating,
    onBackToList,
  }: {
    onRating: (rating: string) => void
    onBackToList: () => void
  }) => (
    <div>
      <span>complete-view</span>
      <button type="button" onClick={() => onRating('mastered')}>
        已掌握
      </button>
      <button type="button" onClick={onBackToList}>
        完成返回
      </button>
    </div>
  ),
}))

vi.mock('../../components/ReviewProgressHeader', () => ({
  default: ({
    sessionReviewedCount,
    initialTotal,
  }: {
    sessionReviewedCount: number
    initialTotal: number
  }) => <div>progress:{sessionReviewedCount}/{initialTotal}</div>,
}))

vi.mock('@/shared/components/Celebration', () => ({
  default: ({ visible, text }: { visible: boolean; text: string }) =>
    visible ? <div>celebration:{text}</div> : null,
}))

vi.mock('@/features/stats', () => ({
  AchievementUnlockToast: ({
    achievements,
    onClose,
  }: {
    achievements: unknown[]
    onClose: () => void
  }) =>
    achievements.length > 0 ? (
      <button type="button" onClick={onClose}>
        关闭成就提示
      </button>
    ) : null,
}))

import ReviewPage from '../ReviewPage'

function makeWord(): Word {
  return {
    id: 'apple',
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple.',
    mastery: 0,
    nextReview: 0,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: 0,
    updated_at: 0,
  }
}

function makeState(overrides: Partial<ReviewPageState> = {}): ReviewPageState {
  return {
    view: 'list',
    queueInfo: { total: 3 },
    status: 'ready',
    errorMsg: '',
    celebrating: false,
    celebrationText: '',
    unlockedAchievements: [],
    setUnlockedAchievements: callbacks.setUnlockedAchievements,
    sessionReviewedCount: 0,
    currentWord: null,
    currentStep: null,
    unlockedSteps: [],
    completedSteps: [],
    reviewQueue: [],
    goToStep: callbacks.goToStep,
    initialTotal: 3,
    reviewProgress: 0,
    isReviewComplete: false,
    stageLabel: '识记',
    loadList: callbacks.loadList,
    handleWordClick: callbacks.handleWordClick,
    handleComplete: callbacks.handleComplete,
    handleBackToList: callbacks.handleBackToList,
    handleRating: callbacks.handleRating,
    handleCelebrationComplete: callbacks.handleCelebrationComplete,
    ...overrides,
  }
}

describe('ReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state = makeState()
  })

  it('list 视图：渲染列表与进度条，点击刷新调用 loadList', () => {
    render(<ReviewPage />)

    expect(screen.getByText('progress:0/3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    expect(callbacks.loadList).toHaveBeenCalledTimes(1)
  })

  it('list 视图：无待复习量时隐藏进度条，点击单词触发 handleWordClick', () => {
    mocks.state = makeState({ initialTotal: 0, queueInfo: { total: 0 } })
    render(<ReviewPage />)

    expect(screen.queryByText(/progress:/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '点击单词' }))
    expect(callbacks.handleWordClick).toHaveBeenCalledWith({ id: 'apple' })
  })

  it('review 视图：currentWord 与 currentStep 齐备时渲染会话视图并接线回调', () => {
    mocks.state = makeState({
      view: 'review',
      currentWord: makeWord(),
      currentStep: 'learn',
      reviewQueue: [makeWord()],
    })
    render(<ReviewPage />)

    expect(screen.getByText('session-view')).toBeInTheDocument()
    expect(screen.queryByText(/list-view/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }))
    expect(callbacks.handleBackToList).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '完成复习' }))
    expect(callbacks.handleComplete).toHaveBeenCalledTimes(1)
  })

  it('review 视图：currentStep 缺失时不渲染会话视图', () => {
    mocks.state = makeState({
      view: 'review',
      currentWord: makeWord(),
      currentStep: null,
    })
    render(<ReviewPage />)

    expect(screen.queryByText('session-view')).not.toBeInTheDocument()
  })

  it('complete 视图：渲染完成评价视图并传递评分回调', () => {
    mocks.state = makeState({ view: 'complete', currentWord: makeWord() })
    render(<ReviewPage />)

    expect(screen.getByText('complete-view')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '已掌握' }))
    expect(callbacks.handleRating).toHaveBeenCalledWith('mastered')
    fireEvent.click(screen.getByRole('button', { name: '完成返回' }))
    expect(callbacks.handleBackToList).toHaveBeenCalledTimes(1)
  })

  it('庆祝覆盖层与成就 Toast 接线：显示文本并关闭时清空成就', () => {
    mocks.state = makeState({
      celebrating: true,
      celebrationText: '太棒了',
      unlockedAchievements: [{ id: 'first' }],
    })
    render(<ReviewPage />)

    expect(screen.getByText('celebration:太棒了')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭成就提示' }))
    expect(callbacks.setUnlockedAchievements).toHaveBeenCalledWith([])
  })
})
