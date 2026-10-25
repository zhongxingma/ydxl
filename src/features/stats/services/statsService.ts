// 学习统计服务聚合出口
//
// 按职责拆分：
//   - statsRecordingService.ts：每日指标累加、连续打卡、阅读会话记录
//   - statsQueryService.ts：区间数据、阅读能力趋势、概览与成就上下文
//
// 调用方仍从 './statsService' 导入，聚合对象保持原有方法集合。
import {
  recordArticleRead,
  recordReadingSession,
  recordWordLearned,
  recordWordMastered,
  recordWordReviewed,
  updateStreak,
} from './statsRecordingService'
import {
  buildAchievementContext,
  getReadingAbilityTrend,
  getRecentReadingSessions,
  getStatsByDateRange,
  getStatsOverview,
  getTodayStats,
} from './statsQueryService'

export {
  buildAchievementContext,
  getReadingAbilityTrend,
  getRecentReadingSessions,
  getStatsByDateRange,
  getStatsOverview,
  getTodayStats,
  recordArticleRead,
  recordReadingSession,
  recordWordLearned,
  recordWordMastered,
  recordWordReviewed,
  updateStreak,
}

export const statsService = {
  recordArticleRead,
  recordReadingSession,
  recordWordLearned,
  recordWordReviewed,
  recordWordMastered,
  updateStreak,
  getStatsByDateRange,
  getRecentReadingSessions,
  getReadingAbilityTrend,
  getTodayStats,
  getStatsOverview,
  buildAchievementContext,
}
