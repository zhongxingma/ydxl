// DashboardPage 冒烟测试（重构护栏）
//
// 覆盖场景：
// 1. 加载完成后渲染标题、三张数据卡片、今日待办与复习单词
// 2. 历史/推荐为空时展示空状态，底部周掌握面板正常渲染
//
// Mock 策略：服务层全量 mock，MemoryRouter 提供路由上下文；
// 阅读能力曲线使用空数组，避免触发 recharts 懒加载。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

// AddArticleModal 依赖 aiProvider，避免加载真实 AI 模块
vi.mock('@/shared/services/ai', () => ({ aiProvider: {} }))

import DashboardPage from '../DashboardPage'

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
      <DashboardPage />
    </MemoryRouter>,
  )
}

describe('DashboardPage 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshFromServer.mockResolvedValue(undefined)
    mocks.getStatsOverview.mockResolvedValue({
      currentStreak: 7,
      todayArticlesRead: 1,
      todayWordsReviewed: 4,
      totalWordsMastered: 120,
    })
    mocks.getTodayReviewQueueInfo.mockResolvedValue({
      words: [makeWord()],
      total: 1,
    })
    mocks.getReadingAbilityTrend.mockResolvedValue([])
    mocks.getStatsByDateRange
      .mockResolvedValueOnce([{ wordsMastered: 5 }, { wordsMastered: 3 }])
      .mockResolvedValueOnce([{ wordsMastered: 2 }])
    mocks.getReadHistory.mockResolvedValue([])
    mocks.getRecentlyReadArticles.mockResolvedValue([])
    mocks.getRecommendedArticles.mockResolvedValue([])
    mocks.getTodayReadCount.mockResolvedValue(1)
  })

  it('加载完成后渲染概览卡片、今日待办与复习单词', async () => {
    renderDashboard()

    // 等待概览数据加载完成（骨架屏消失）
    expect(await screen.findByText('今日概览')).toBeInTheDocument()
    expect(screen.getByText('连续打卡')).toBeInTheDocument()
    expect(screen.getAllByText('今日阅读').length).toBeGreaterThan(0)
    expect(screen.getAllByText('今日复习').length).toBeGreaterThan(0)
    expect(screen.getByText('今日待办')).toBeInTheDocument()
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('本周掌握单词')).toBeInTheDocument()
  })

  it('历史阅读与推荐为空时展示空状态引导', async () => {
    renderDashboard()

    expect(await screen.findByText('暂无阅读记录，开始你的第一篇阅读吧')).toBeInTheDocument()
    expect(screen.getByText('暂无推荐，去生成新文章')).toBeInTheDocument()
  })
})
