// 学习统计服务
// 负责记录每日学习指标、维护连续打卡、查询日期范围数据与统计概览
// 数据访问通过 CachedRemoteRepository（服务器为主，Dexie 离线缓存）
import {
  articleRepository,
  readingSessionRepository,
  reviewRepository,
  statsRepository,
  wordRepository,
} from '@/shared/services'
import type { ReadingSession, Stats } from '@/shared/types'
import type { ReadingAbilityTrendPoint, StatsOverview } from '../types'
import { getPreviousDay, getTodayStr } from '../utils/date'
import type { AchievementContext } from './achievementService'

// 创建初始 stats 记录（不写入数据库）
function createInitialStats(date: string): Stats {
  return {
    id: date,
    articlesRead: 0,
    wordsLearned: 0,
    wordsReviewed: 0,
    wordsMastered: 0,
    streak: 0,
    updated_at: 0,
  }
}

// 确保 stats 记录存在：若不存在则创建初始记录并写入数据库
async function ensureStats(date: string): Promise<Stats> {
  const existing = await statsRepository.getById(date)
  if (existing) return existing
  await statsRepository.add(createInitialStats(date))
  return (await statsRepository.getById(date)) as Stats
}

/**
 * 记录阅读一篇文章
 * articlesRead += 1，同时维护连续打卡天数
 *
 * @param date 日期字符串 YYYY-MM-DD，默认今天
 * @returns 无返回值
 * @throws 当 statsRepository.update 或 updateStreak 失败时抛出
 */
export async function recordArticleRead(date?: string): Promise<void> {
  const targetDate = date ?? getTodayStr()
  const stats = await ensureStats(targetDate)
  await statsRepository.update(targetDate, { articlesRead: stats.articlesRead + 1 })
  await updateStreak(targetDate)
}

/**
 * 记录学习一个新单词
 * wordsLearned += 1
 *
 * @param date 日期字符串 YYYY-MM-DD，默认今天
 * @returns 无返回值
 * @throws 当 statsRepository.update 失败时抛出
 */
export async function recordWordLearned(date?: string): Promise<void> {
  const targetDate = date ?? getTodayStr()
  const stats = await ensureStats(targetDate)
  await statsRepository.update(targetDate, { wordsLearned: stats.wordsLearned + 1 })
}

/**
 * 记录复习一个单词
 * wordsReviewed += 1
 *
 * @param date 日期字符串 YYYY-MM-DD，默认今天
 * @returns 无返回值
 * @throws 当 statsRepository.update 失败时抛出
 */
export async function recordWordReviewed(date?: string): Promise<void> {
  const targetDate = date ?? getTodayStr()
  const stats = await ensureStats(targetDate)
  await statsRepository.update(targetDate, { wordsReviewed: stats.wordsReviewed + 1 })
}

/**
 * 记录掌握一个单词
 * wordsMastered += 1
 *
 * @param date 日期字符串 YYYY-MM-DD，默认今天
 * @returns 无返回值
 * @throws 当 statsRepository.update 失败时抛出
 */
export async function recordWordMastered(date?: string): Promise<void> {
  const targetDate = date ?? getTodayStr()
  const stats = await ensureStats(targetDate)
  await statsRepository.update(targetDate, { wordsMastered: stats.wordsMastered + 1 })
}

/**
 * 更新连续打卡天数
 * - 查询昨天 stats 是否存在且 streak > 0（即昨天有打卡）
 * - 若昨天打卡，今天 streak = 昨天 streak + 1
 * - 若昨天未打卡，今天 streak = 1
 * - 写入今天 stats 的 streak 字段
 *
 * @param date 日期字符串 YYYY-MM-DD
 * @returns 无返回值
 * @throws 当 statsRepository.getById/add/update 失败时抛出
 */
export async function updateStreak(date: string): Promise<void> {
  const yesterdayStr = getPreviousDay(date)
  const yesterdayStats = await statsRepository.getById(yesterdayStr)
  const todayStreak = yesterdayStats && yesterdayStats.streak > 0 ? yesterdayStats.streak + 1 : 1

  const todayStats = await statsRepository.getById(date)
  if (todayStats) {
    await statsRepository.update(date, { streak: todayStreak })
  } else {
    await statsRepository.add({
      ...createInitialStats(date),
      streak: todayStreak,
    })
  }
}

/**
 * 查询日期范围内的 stats 记录（含两端）
 * 利用 id（YYYY-MM-DD）的字典序与时间顺序一致特性做区间过滤
 * 使用 Dexie 索引 whereBetween 替代 getAll().filter()，避免全表扫描
 * 数据从服务器获取（CachedRemoteRepository），离线时回退本地缓存
 *
 * @param startDate 起始日期 YYYY-MM-DD（含）
 * @param endDate 结束日期 YYYY-MM-DD（含）
 * @returns 区间内的 Stats 数组
 * @throws 当 statsRepository.whereBetween 查询失败时抛出
 */
export async function getStatsByDateRange(startDate: string, endDate: string): Promise<Stats[]> {
  return statsRepository.whereBetween('id', startDate, endDate)
}

/**
 * 记录一次完整的阅读会话
 * 1. 创建 ReadingSession 实体并写入 readingSessionRepository
 *    - id 格式 `${articleId}-${timestamp}`，保证同篇文章多次阅读各自有独立记录
 * 2. 同时调用 recordArticleRead 累加今日 articlesRead 与打卡 streak
 *
 * @param articleId 文章主键 YYYY-MM-DD
 * @param durationSec 阅读用时（秒）
 * @param wordCount 文章字数
 * @param correctRate 答题正确率 0-1
 * @returns 无返回值；写入失败时仅记录日志不抛错
 */
export async function recordReadingSession(
  articleId: string,
  durationSec: number,
  wordCount: number,
  correctRate: number
): Promise<void> {
  const now = Date.now()
  // 规范化 correctRate 至 0-1 区间，避免外部传入越界
  const normalizedRate =
    Number.isFinite(correctRate) ? Math.min(1, Math.max(0, correctRate)) : 0

  const session: ReadingSession = {
    id: `${articleId}-${now}`,
    articleId,
    durationSec: Math.max(0, Math.floor(durationSec)),
    wordCount: Math.max(0, Math.floor(wordCount)),
    correctRate: normalizedRate,
    reviewedAt: now,
    updated_at: now,
  }

  try {
    await readingSessionRepository.add(session)
  } catch (err) {
    // 写入失败不阻塞，仅记录日志
    console.warn('[statsService] 阅读会话记录写入失败', err)
  }

  // 同步累加 articlesRead 与维护 streak
  try {
    await recordArticleRead()
  } catch (err) {
    console.warn('[statsService] recordArticleRead 调用失败', err)
  }
}

/**
 * 查询最近 N 天内的阅读会话记录（按时间倒序）
 * 用于绘制"阅读能力增长曲线"图表
 * 使用 Dexie 索引 whereAbove('reviewedAt') 替代 getAll().filter()，避免全表扫描
 *
 * @param days 天数，默认 30
 * @returns 阅读会话数组，按 reviewedAt 升序（用于绘制增长曲线）
 */
export async function getRecentReadingSessions(days = 30): Promise<ReadingSession[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const sessions = await readingSessionRepository.whereAbove('reviewedAt', cutoff)
  return sessions.sort((a, b) => a.reviewedAt - b.reviewedAt)
}

// 历史数据缺失字段的兜底默认值
// 选用 200：对应 medium 难度文章的典型字数下限，避免历史 ReadingSession.wordCount 缺失时聚合 NaN
const DEFAULT_WORD_COUNT_FALLBACK = 200

// 将时间戳（毫秒）转换为本地时区 YYYY-MM-DD
// 直接使用 new Date(ts) 的本地时区方法，避免 UTC 偏移导致日期分组错位
function timestampToLocalDateStr(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 规范化正确率：必须为有限数且在 [0,1] 区间，否则返回 0
// 防御历史数据 correctRate 缺失/NaN/越界导致聚合结果污染
function normalizeCorrectRate(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

// 规范化字数：必须为正有限数，否则返回默认兜底值
// 防御历史数据 wordCount 缺失/NaN/≤0 导致聚合结果污染
function normalizeWordCount(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WORD_COUNT_FALLBACK
  }
  return Math.floor(value)
}

// 规范化时长：必须为非负有限数，否则返回 0
// 防御历史数据 durationSec 缺失/NaN/<0 导致聚合结果污染
function normalizeDurationSec(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

/**
 * 查询最近 N 天的阅读能力增长曲线数据点
 *
 * 数据源：readingSessions 表（reviewedAt 索引字段范围查询，避免全表扫描）
 *
 * 时间窗口（修复 off-by-one）：
 * - 锚点为本地时区「今日 00:00」，向前回溯 N-1 天
 * - 共 N 个完整日历日（今日 + 前 N-1 天）
 * - 修复了原先 cutoff = Date.now() - N*86400000 导致首日数据不完整的问题
 * - 使用 whereAboveOrEqual（>=）替代 whereAbove（>），包含 cutoff 边界值
 *
 * 字段兜底（修复缺失字段聚合 NaN）：
 * - correctRate 缺失/非有限/越界 → 0
 * - wordCount 缺失/非有限/≤0 → DEFAULT_WORD_COUNT_FALLBACK(200)
 * - durationSec 缺失/非有限/<0 → 0
 *
 * 聚合维度：按 reviewedAt 对应的本地日期 YYYY-MM-DD 分组
 * - score：当日平均 correctRate（0-1）
 * - wordCount：当日 wordCount 累加
 * - durationSec：当日 durationSec 累加（修复原先未累计阅读时长的问题）
 * - count：当日会话数
 *
 * @param days 天数（含今日），默认 30；最小 1
 * @returns ReadingAbilityTrendPoint 数组，按 date 升序排列
 * @throws 当 readingSessionRepository.whereAboveOrEqual 查询失败时抛出
 */
export async function getReadingAbilityTrend(
  days = 30,
): Promise<ReadingAbilityTrendPoint[]> {
  // 边界保护：days < 1 时按 1 处理（仅今日）
  const safeDays = Math.max(1, Math.floor(days))

  // 计算今日 00:00（本地时区）时间戳
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
  // 向前回溯 N-1 天，使窗口恰好为 N 个完整日历日
  const cutoff = startOfToday - (safeDays - 1) * 24 * 60 * 60 * 1000

  // 使用 >= 比较以包含 cutoff 边界值（修复 whereAbove 严格大于的边界丢失）
  const sessions = await readingSessionRepository.whereAboveOrEqual('reviewedAt', cutoff)

  // 按本地日期分组聚合
  const dayMap = new Map<
    string,
    { correctSum: number; wordSum: number; durationSum: number; count: number }
  >()
  for (const s of sessions) {
    const dateStr = timestampToLocalDateStr(s.reviewedAt)
    const prev = dayMap.get(dateStr) ?? { correctSum: 0, wordSum: 0, durationSum: 0, count: 0 }
    prev.correctSum += normalizeCorrectRate(s.correctRate)
    prev.wordSum += normalizeWordCount(s.wordCount)
    prev.durationSum += normalizeDurationSec(s.durationSec)
    prev.count += 1
    dayMap.set(dateStr, prev)
  }

  // 按日期升序输出
  return Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, agg]) => ({
      date,
      score: agg.count > 0 ? Number((agg.correctSum / agg.count).toFixed(3)) : 0,
      wordCount: agg.wordSum,
      durationSec: agg.durationSum,
      count: agg.count,
    }))
}

/**
 * 返回今天 stats，不存在则返回初始值
 *
 * @returns 今天的 Stats 记录；不存在时返回全 0 初始值（不写入数据库）
 * @throws 当 statsRepository.getById 失败时抛出
 */
export async function getTodayStats(): Promise<Stats> {
  const today = getTodayStr()
  const stats = await statsRepository.getById(today)
  return stats ?? createInitialStats(today)
}

/**
 * 获取统计概览
 * - totalArticles：articles 表总记录数（使用 Dexie count，避免全表加载）
 * - totalWordsMastered：words 表 mastery >= 5 的数量（使用索引 countWhereAbove）
 * - currentStreak：今天 stats 的 streak（若今天无 stats 则取昨天的 streak，若昨天也没有则为 0）
 * - todayXxx：今天 stats 对应字段
 * 数据从服务器获取（CachedRemoteRepository），离线时回退本地缓存
 *
 * @returns StatsOverview 包含 totalArticles/totalWordsMastered/currentStreak/todayXxx 等字段
 * @throws 当 articleRepository.count 或 wordRepository.countWhereAbove 等查询失败时抛出
 */
export async function getStatsOverview(): Promise<StatsOverview> {
  const today = getTodayStr()
  const yesterday = getPreviousDay(today)
  const [todayStats, yesterdayStats, totalArticles, totalWordsMastered] = await Promise.all([
    statsRepository.getById(today),
    statsRepository.getById(yesterday),
    articleRepository.count(),
    // mastery 是索引字段，mastery > 4 即 mastery >= 5
    wordRepository.countWhereAbove('mastery', 4),
  ])
  const currentStreak = todayStats?.streak ?? yesterdayStats?.streak ?? 0
  return {
    totalArticles,
    totalWordsMastered,
    currentStreak,
    todayArticlesRead: todayStats?.articlesRead ?? 0,
    todayWordsLearned: todayStats?.wordsLearned ?? 0,
    todayWordsReviewed: todayStats?.wordsReviewed ?? 0,
  }
}

/**
 * 构造成就上下文
 * - 当日阅读篇数：从 readingSessions 表查询今天（00:00 至现在）
 * - 当日复习单词数：从 reviews 表查询今天记录数（step='write' 汇总记录，每次代表完成一个单词复习）
 * - 当日全对次数：从 readingSessions 表查询 correctRate === 1 的次数
 * - 连续打卡天数：复用 todayStats.streak（缺失视为 0）
 * - 总阅读篇数：readingSessions 表总记录数（使用 Dexie count）
 * - 总掌握单词数：words 表 mastery >= 5 的数量（使用索引 countWhereAbove）
 * 使用 Dexie 索引 whereAboveOrEqual/whereEqualsFiltered 替代 getAll().filter()，避免全表扫描
 *
 * @returns AchievementContext 用于 achievementService.checkAndUnlockAchievements
 * @throws 当 readingSessionRepository/reviewRepository/wordRepository 查询失败时抛出
 */
export async function buildAchievementContext(): Promise<AchievementContext> {
  // 计算今天本地 00:00 的时间戳
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const todayStartTs = startOfToday.getTime()

  const todayStats = await getTodayStats()

  // 并行查询各维度数据，使用 Dexie 索引避免全表扫描
  const [todaySessions, todayPerfectSessions, todayReviews, totalReadCount, totalMasteredWords] =
    await Promise.all([
      // 当日阅读篇数：reviewedAt >= 今天 00:00（reviewedAt 是索引字段）
      readingSessionRepository.whereAboveOrEqual('reviewedAt', todayStartTs),
      // 当日全对次数：reviewedAt >= 今天 00:00 且 correctRate === 1
      readingSessionRepository.whereAboveOrEqualFiltered(
        'reviewedAt',
        todayStartTs,
        (s) => s.correctRate === 1,
      ),
      // 当日复习单词数：step='write' 且 reviewedAt >= 今天 00:00（step 是索引字段）
      reviewRepository.whereEqualsFiltered('step', 'write', (r) => r.reviewedAt >= todayStartTs),
      // 总阅读篇数（使用 Dexie count）
      readingSessionRepository.count(),
      // 总掌握单词数（mastery 是索引字段，mastery > 4 即 mastery >= 5）
      wordRepository.countWhereAbove('mastery', 4),
    ])

  return {
    todayReadCount: todaySessions.length,
    todayReviewCount: todayReviews.length,
    todayPerfectCount: todayPerfectSessions.length,
    streakDays: todayStats.streak ?? 0,
    totalReadCount,
    totalMasteredWords,
  }
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
