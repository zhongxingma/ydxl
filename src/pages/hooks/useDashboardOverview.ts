// 仪表盘概览数据：连续打卡 / 今日阅读与复习 / 逾期 / 掌握总数 / 阅读能力曲线 / 周掌握对比
//
// 数据源：statsService（统计）、reviewService（复习队列）、articleService（今日阅读兜底）
// 缓存联动：订阅 words 缓存事件，后台刷新完成后重载概览（含复习队列）
import { logger } from '../../shared/utils/logger'
import type { MutableRefObject } from 'react'
import { useCallback, useState } from 'react'
import type { Word } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import {
  statsService,
  getDateNDaysAgo,
  type ReadingAbilityTrendPoint,
} from '@/features/stats'
import { reviewService, isOverdue } from '@/features/review'
import { articleService } from '@/features/reading/services/articleService'

// 仪表盘聚合数据
export interface DashboardData {
  // 连续打卡天数
  streak: number
  // 今日已读篇数
  todayArticlesRead: number
  // 今日已复习单词数
  todayWordsReviewed: number
  // 待复习单词总数（截断前）
  pendingReview: number
  // 逾期单词数（nextReview 早于 now - 24h）
  overdueCount: number
  // 已掌握单词总数
  totalWordsMastered: number
  // 最近 30 天阅读能力增长曲线数据点（已按日聚合）
  readingTrend: ReadingAbilityTrendPoint[]
  // 本周（最近 7 天）掌握单词数
  weekMastered: number
  // 上周（7-13 天前）掌握单词数，用于趋势对比
  lastWeekMastered: number
}

export interface UseDashboardOverviewResult {
  data: DashboardData | null
  loading: boolean
  // 今日需复习单词列表（按 nextReview 升序，前 5 个）
  todayReviewWords: Word[]
  loadOverview: () => Promise<void>
}

export function useDashboardOverview(
  mountedRef: MutableRefObject<boolean>,
): UseDashboardOverviewResult {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [todayReviewWords, setTodayReviewWords] = useState<Word[]>([])

  // 异步加载仪表盘概览数据：并行查询统计概览、复习队列、阅读会话、本周与上周 stats
  // SWR 模式：stats/review/readingSession 由调用方先行 refreshFromServer，保证跨终端一致
  const loadOverview = useCallback(async () => {
    const [overview, reviewInfo, readingTrend, weekStats, lastWeekStats] = await Promise.all([
      statsService.getStatsOverview(),
      reviewService.getTodayReviewQueueInfo(),
      statsService.getReadingAbilityTrend(30),
      statsService.getStatsByDateRange(getDateNDaysAgo(6), getDateNDaysAgo(0)),
      statsService.getStatsByDateRange(getDateNDaysAgo(13), getDateNDaysAgo(7)),
    ])
    // 组件已卸载则放弃更新
    if (!mountedRef.current) return
    const weekMastered = weekStats.reduce((sum, s) => sum + s.wordsMastered, 0)
    const lastWeekMastered = lastWeekStats.reduce((sum, s) => sum + s.wordsMastered, 0)
    const overdueCount = reviewInfo.words.filter(isOverdue).length
    // 获取今日需复习的前 5 个单词（用于首页直接展示）
    const reviewWords = reviewInfo.words
      .slice()
      .sort((a, b) => a.nextReview - b.nextReview)
      .slice(0, 5)
    // 兜底：若 stats 服务的 todayArticlesRead 为 0，查询今日 readAt 文章数
    let todayArticlesRead = overview.todayArticlesRead
    if (todayArticlesRead === 0) {
      try {
        todayArticlesRead = await articleService.getTodayReadCount()
      } catch (err) {
        logger.warn('[DashboardPage] getTodayReadCount 兜底查询失败', err)
      }
    }
    if (!mountedRef.current) return
    setData({
      streak: overview.currentStreak,
      todayArticlesRead,
      todayWordsReviewed: overview.todayWordsReviewed,
      pendingReview: reviewInfo.total,
      overdueCount,
      totalWordsMastered: overview.totalWordsMastered,
      readingTrend,
      weekMastered,
      lastWeekMastered,
    })
    setTodayReviewWords(reviewWords)
    setLoading(false)
  }, [mountedRef])

  // 订阅 words 缓存事件：wordRepository 后台刷新完成后重载概览数据（含复习队列）
  useCacheInvalidated('words', () => {
    void loadOverview()
  })

  return { data, loading, todayReviewWords, loadOverview }
}
