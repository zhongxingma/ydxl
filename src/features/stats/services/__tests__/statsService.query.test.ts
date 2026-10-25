// statsService 概览与区间查询
//
// getStatsOverview、getStatsByDateRange、getRecentReadingSessions 与 buildAchievementContext。
// 由 statsService.test.ts 按职责拆分而来，用例内容与断言未改动。

import { getStatsByDateRange, getRecentReadingSessions, getStatsOverview, buildAchievementContext } from '../statsService'
import { articleRepository, reviewRepository, wordRepository } from '@/shared/services'
import { mockReviews, mockArticleCount, mockMasteredCount, installMock, restoreMock, makeStats, makeSession, todayStr, yesterdayStr, setMockArticleCount, setMockMasteredCount, setMockReviews } from './statsServiceTestMocks'

describe('statsService 概览与区间查询', () => {
  it('getStatsOverview 空数据 → 返回默认值（全 0）', async () => {
    installMock([])
    try {
      const overview = await getStatsOverview()
      expect(overview.totalArticles).toBe(0)
      expect(overview.totalWordsMastered).toBe(0)
      expect(overview.currentStreak).toBe(0)
      expect(overview.todayArticlesRead).toBe(0)
      expect(overview.todayWordsLearned).toBe(0)
      expect(overview.todayWordsReviewed).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 2. getStatsOverview 有今日 stats → 返回今日字段
  it('getStatsOverview 有今日 stats → 返回今日字段', async () => {
    const today = todayStr()
    const todayStats = makeStats(today, {
      articlesRead: 3,
      wordsLearned: 10,
      wordsReviewed: 20,
      streak: 5,
    })
    setMockArticleCount(8)
    setMockMasteredCount(15)
    installMock([todayStats])
    // 重设被 installMock 重置的计数
    setMockArticleCount(8)
    setMockMasteredCount(15)
    articleRepository.count = async () => mockArticleCount
    wordRepository.countWhereAbove = async () => mockMasteredCount
    try {
      const overview = await getStatsOverview()
      expect(overview.totalArticles).toBe(8)
      expect(overview.totalWordsMastered).toBe(15)
      expect(overview.currentStreak).toBe(5)
      expect(overview.todayArticlesRead).toBe(3)
      expect(overview.todayWordsLearned).toBe(10)
      expect(overview.todayWordsReviewed).toBe(20)
    } finally {
      restoreMock()
    }
  })

  // 3. getStatsOverview 今日 stats 缺失 → 回退昨日 streak
  it('getStatsOverview 今日 stats 缺失 → 回退昨日 streak', async () => {
    const yesterday = yesterdayStr()
    const yesterdayStats = makeStats(yesterday, { streak: 7 })
    installMock([yesterdayStats])
    try {
      const overview = await getStatsOverview()
      expect(overview.currentStreak).toBe(7)
      // 今日字段为 0（今日 stats 不存在）
      expect(overview.todayArticlesRead).toBe(0)
      expect(overview.todayWordsLearned).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 4. getStatsByDateRange 区间查询 → 返回范围内记录
  it('getStatsByDateRange 区间查询 → 返回范围内记录', async () => {
    const stats = [
      makeStats('2024-01-01', { articlesRead: 1 }),
      makeStats('2024-01-02', { articlesRead: 2 }),
      makeStats('2024-01-03', { articlesRead: 3 }),
      makeStats('2024-01-04', { articlesRead: 4 }),
    ]
    installMock(stats)
    try {
      const result = await getStatsByDateRange('2024-01-02', '2024-01-03')
      expect(result.length).toBe(2)
      expect(result.map((s) => s.id)).toEqual(['2024-01-02', '2024-01-03'])
    } finally {
      restoreMock()
    }
  })

  // 5. getStatsByDateRange 空区间 → 返回空数组
  it('getStatsByDateRange 空区间 → 返回空数组', async () => {
    installMock([makeStats('2024-01-01')])
    try {
      const result = await getStatsByDateRange('2024-02-01', '2024-02-28')
      expect(result).toEqual([])
    } finally {
      restoreMock()
    }
  })

  // 6. getRecentReadingSessions 返回升序会话列表
  it('getRecentReadingSessions 返回升序会话列表', async () => {
    const now = Date.now()
    // 倒序插入，验证返回时按 reviewedAt 升序排序
    const sessions = [
      makeSession('s-3', { reviewedAt: now - 100 }),
      makeSession('s-1', { reviewedAt: now - 1000 }),
      makeSession('s-2', { reviewedAt: now - 500 }),
    ]
    installMock([], sessions)
    try {
      const result = await getRecentReadingSessions(30)
      expect(result.length).toBe(3)
      // 验证按 reviewedAt 升序排序
      expect(result[0].id).toBe('s-1')
      expect(result[1].id).toBe('s-2')
      expect(result[2].id).toBe('s-3')
    } finally {
      restoreMock()
    }
  })

  // 7. getRecentReadingSessions 无会话 → 返回空数组
  it('getRecentReadingSessions 无会话 → 返回空数组', async () => {
    installMock([], [])
    try {
      const result = await getRecentReadingSessions(30)
      expect(result).toEqual([])
    } finally {
      restoreMock()
    }
  })

  // 8. buildAchievementContext 空数据 → 全 0
  it('buildAchievementContext 空数据 → 全 0', async () => {
    installMock([], [])
    try {
      const ctx = await buildAchievementContext()
      expect(ctx.todayReadCount).toBe(0)
      expect(ctx.todayReviewCount).toBe(0)
      expect(ctx.todayPerfectCount).toBe(0)
      expect(ctx.streakDays).toBe(0)
      expect(ctx.totalReadCount).toBe(0)
      expect(ctx.totalMasteredWords).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 9. buildAchievementContext 多维度聚合 → 各字段正确
  it('buildAchievementContext 多维度聚合 → 各字段正确', async () => {
    const today = todayStr()
    const todayStats = makeStats(today, { streak: 4 })
    // 今天 00:00 之后创建的会话
    const now = new Date()
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    ).getTime()
    const sessions = [
      makeSession('s-1', { reviewedAt: startOfToday + 1000, correctRate: 0.8 }),
      makeSession('s-2', { reviewedAt: startOfToday + 2000, correctRate: 1 }),
      makeSession('s-3', { reviewedAt: startOfToday + 3000, correctRate: 1 }),
      // 早期会话（应被过滤）
      makeSession('s-old', { reviewedAt: startOfToday - 10000, correctRate: 1 }),
    ]
    setMockReviews([
      { id: 'r-1', wordId: 'w-1', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 500, updated_at: 0 },
      { id: 'r-2', wordId: 'w-2', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 600, updated_at: 0 },
      // 早期复习记录应被过滤
      { id: 'r-old', wordId: 'w-3', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday - 1000, updated_at: 0 },
    ])
    installMock([todayStats], sessions)
    // 重新注入 reviews（installMock 会清空）
    setMockReviews([
      { id: 'r-1', wordId: 'w-1', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 500, updated_at: 0 },
      { id: 'r-2', wordId: 'w-2', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 600, updated_at: 0 },
      { id: 'r-old', wordId: 'w-3', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday - 1000, updated_at: 0 },
    ])
    // 重写 reviewRepository.whereEqualsFiltered 使其读取 mockReviews
    reviewRepository.whereEqualsFiltered = async (
      _field,
      _value,
      filter,
    ) => mockReviews.filter(filter as (r: unknown) => boolean)
    try {
      const ctx = await buildAchievementContext()
      // 今日阅读 3 篇（s-1/s-2/s-3，s-old 被过滤）
      expect(ctx.todayReadCount).toBe(3)
      // 今日全对 2 次（s-2/s-3）
      expect(ctx.todayPerfectCount).toBe(2)
      // 今日复习 2 个（r-1/r-2，r-old 被过滤）
      expect(ctx.todayReviewCount).toBe(2)
      // streak 来自今日 stats
      expect(ctx.streakDays).toBe(4)
      // 总阅读篇数（全部 sessions）
      expect(ctx.totalReadCount).toBe(4)
    } finally {
      restoreMock()
    }
  })
})
