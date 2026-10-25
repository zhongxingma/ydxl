// 学习统计写入服务：每日指标累加、连续打卡维护、阅读会话记录
import { readingSessionRepository, statsRepository } from '@/shared/services'
import type { ReadingSession, Stats } from '@/shared/types'
import { getPreviousDay, getTodayStr } from '../utils/date'

// 创建初始 stats 记录（不写入数据库）
export function createInitialStats(date: string): Stats {
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
