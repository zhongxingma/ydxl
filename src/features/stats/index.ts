// 学习统计特性模块的统一导出口
export { default as StatsPage } from './pages/StatsPage'
export { statsService } from './services/statsService'
export {
  achievementService,
  checkAndUnlockAchievements,
  getUnlockedAchievements,
  isAchievementUnlocked,
  ACHIEVEMENT_RULES,
} from './services/achievementService'
export type {
  AchievementRule,
  AchievementContext,
} from './services/achievementService'
export { default as AchievementUnlockToast } from './components/AchievementUnlockToast'
export { getTodayStr, getDateRange, getDateNDaysAgo, getPreviousDay, formatShortDate } from './utils/date'
export type { StatsMode, StatsOverview, StatsSummary, ReadingAbilityTrendPoint } from './types'
