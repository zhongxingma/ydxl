// DashboardPage 导航与回调测试
//
// 冒烟测试只验证首屏渲染，本文件补齐交互接线：
// 1. 快捷操作打开添加 / 批量导入 Modal，关闭时触发页面刷新
// 2. 今日待办「去阅读」「去复习」跳转对应路由
// 3. 今日需复习「查看全部」跳转复习页
// 4. 相关推荐点击携带 articleId 跳转阅读页
// 5. 概览加载失败时记录 warn 而不崩溃
//
// Mock 策略：服务层与子区块组件全部 mock，仅验证 DashboardPage 的回调与路由跳转。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Word } from '@/shared/types'

const mocks = vi.hoisted(() => ({
  getStatsOverview: vi.fn(),
  getReadingAbilityTrend: vi.fn(),
  getStatsByDateRange: vi.fn(),
  getTodayReviewQueueInfo: vi.fn(),
  getReadHistory: vi.fn(),
  getRecentlyReadArticles: vi.fn(),
  getRecommendedArticles: vi.fn(),
  getTodayReadCount: vi.fn(),
  refreshFromServer: vi.fn(),
}))

vi.mock('@/features/stats', () => ({
  statsService: {
    getStatsOverview: mocks.getStatsOverview,
    getReadingAbilityTrend: mocks.getReadingAbilityTrend,
    getStatsByDateRange: mocks.getStatsByDateRange,
  },
  getDateNDaysAgo: () => '2026-10-20',
}))

vi.mock('@/features/review', () => ({
  reviewService: { getTodayReviewQueueInfo: mocks.getTodayReviewQueueInfo },
  isOverdue: () => false,
}))

vi.mock('@/shared/services', () => ({
  getSettings: () => ({ dailyGoalArticles: 2, dailyGoalWords: 10 }),
  statsRepository: { refreshFromServer: mocks.refreshFromServer },
  reviewRepository: { refreshFromServer: mocks.refreshFromServer },
  readingSessionRepository: { refreshFromServer: mocks.refreshFromServer },
}))

vi.mock('@/features/reading/services/articleService', () => ({
  articleService: {
    getReadHistory: mocks.getReadHistory,
    getRecentlyReadArticles: mocks.getRecentlyReadArticles,
    getTodayReadCount: mocks.getTodayReadCount,
  },
}))

vi.mock('@/features/reading/services/recommendationService', () => ({
  getRecommendedArticles: mocks.getRecommendedArticles,
}))

// 两个 Modal 以「打开即显示关闭按钮」的替身暴露 onClose 回调
vi.mock('@/features/reading/components/AddArticleModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button type="button" onClick={onClose}>
        关闭添加文章
      </button>
    ) : null,
}))

vi.mock('@/features/reading/components/ImportArticlesModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button type="button" onClick={onClose}>
        关闭批量导入
      </button>
    ) : null,
}))

vi.mock('../components/DashboardQuickActions', () => ({
  default: ({
    onAddArticle,
    onImportArticles,
  }: {
    onAddArticle: () => void
    onImportArticles: () => void
  }) => (
    <div>
      <button type="button" onClick={onAddArticle}>
        打开添加文章
      </button>
      <button type="button" onClick={onImportArticles}>
        打开批量导入
      </button>
    </div>
  ),
}))

vi.mock('../components/DashboardTodayTodo', () => ({
  default: ({
    onStartReading,
    onStartReview,
  }: {
    onStartReading: () => void
    onStartReview: () => void
  }) => (
    <div>
      <button type="button" onClick={onStartReading}>
        去阅读
      </button>
      <button type="button" onClick={onStartReview}>
        去复习
      </button>
    </div>
  ),
}))

vi.mock('../components/DashboardReviewWords', () => ({
  default: ({ onViewAll }: { onViewAll: () => void }) => (
    <button type="button" onClick={onViewAll}>
      查看全部复习词
    </button>
  ),
}))

vi.mock('../components/RelatedArticlesSection', () => ({
  default: ({ onArticleClick }: { onArticleClick: (id: string) => void }) => (
    <button type="button" onClick={() => onArticleClick('article 1')}>
      推荐文章
    </button>
  ),
}))

import DashboardPage from '../DashboardPage'

// 阅读页探针：输出当前 search 便于断言 articleId 参数
function ReadingProbe() {
  const location = useLocation()
  return <div>reading-page:{location.search}</div>
}

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'apple',
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple.',
    mastery: 0,
    nextReview: Date.now() - 60_000,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/reading" element={<ReadingProbe />} />
        <Route path="/review" element={<div>review-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DashboardPage 导航与回调', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshFromServer.mockResolvedValue(undefined)
    mocks.getStatsOverview.mockResolvedValue({
      currentStreak: 7,
      todayArticlesRead: 1,
      todayWordsReviewed: 4,
      totalWordsMastered: 120,
    })
    mocks.getTodayReviewQueueInfo.mockResolvedValue({ words: [makeWord()], total: 1 })
    mocks.getReadingAbilityTrend.mockResolvedValue([])
    mocks.getStatsByDateRange.mockResolvedValue([])
    mocks.getReadHistory.mockResolvedValue([])
    mocks.getRecentlyReadArticles.mockResolvedValue([])
    mocks.getRecommendedArticles.mockResolvedValue([])
    mocks.getTodayReadCount.mockResolvedValue(1)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('打开并关闭添加文章 Modal → 触发页面刷新', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload, href: '', search: '' })
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: '打开添加文章' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭添加文章' }))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '关闭添加文章' })).not.toBeInTheDocument()
  })

  it('打开并关闭批量导入 Modal → 触发页面刷新', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload, href: '', search: '' })
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: '打开批量导入' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭批量导入' }))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '关闭批量导入' })).not.toBeInTheDocument()
  })

  it('今日待办「去阅读」→ 跳转阅读页', async () => {
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: '去阅读' }))

    expect(await screen.findByText(/reading-page/)).toBeInTheDocument()
  })

  it('今日待办「去复习」→ 跳转复习页', async () => {
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: '去复习' }))

    expect(await screen.findByText('review-page')).toBeInTheDocument()
  })

  it('今日需复习「查看全部」→ 跳转复习页', async () => {
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: '查看全部复习词' }))

    expect(await screen.findByText('review-page')).toBeInTheDocument()
  })

  it('相关推荐点击 → 携带编码后的 articleId 跳转阅读页', async () => {
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: '推荐文章' }))

    expect(await screen.findByText('reading-page:?articleId=article%201')).toBeInTheDocument()
  })

  it('概览加载失败 → 记录 warn 且页面不崩溃', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getStatsOverview.mockRejectedValue(new Error('stats down'))
    renderDashboard()

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[DashboardPage] 加载概览数据失败', expect.any(Error))
    })
    // 加载失败后仍停留在骨架屏，不渲染主内容
    expect(screen.queryByText('今日待办')).not.toBeInTheDocument()
  })
})
