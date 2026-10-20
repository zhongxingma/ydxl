// 学习统计特性模块的类型定义

export interface StatsSummary {
  totalWords: number
  reviewedToday: number
  streak: number
}

// 周/月切换模式
export type StatsMode = 'week' | 'month'

// 统计概览数据
export interface StatsOverview {
  totalArticles: number
  totalWordsMastered: number
  currentStreak: number
  todayArticlesRead: number
  todayWordsLearned: number
  todayWordsReviewed: number
}

// 阅读能力增长曲线单日数据点
// 由 statsService.getReadingAbilityTrend 聚合 readingSessions 表得到
export interface ReadingAbilityTrendPoint {
  // 日期 YYYY-MM-DD（本地时区）
  date: string
  // 阅读能力分值（0-1）：当日会话答题正确率平均值
  // 历史数据 correctRate 缺失/非有限/越界时按 0 兜底，避免聚合 NaN
  score: number
  // 当日总阅读字数
  // 历史数据 wordCount 缺失/非有限/≤0 时按 200 兜底（对应 medium 难度默认字数）
  wordCount: number
  // 当日总阅读时长（秒，累加 durationSec）
  durationSec: number
  // 当日阅读会话数
  count: number
}
