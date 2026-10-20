// 班级学情聚合（多用户 P3）
// 设计依据 docs/MULTI_USER_DESIGN.md 3.1：stats:class 权限点（teacher / admin）通过
// 只读聚合端点 GET /api/admin/class-stats 实现，不复用通用表路由
//（通用路由始终只返回 req.user 自己的数据）
//
// 口径约定：
// - 学员范围：users 表中 role='student' 且 status='active' 的账号（禁用账号不计入班级）
// - 指标来源：私有表 stats（按天一行，id 存储为 `${userId}:${YYYY-MM-DD}`）
// - 时间窗口：最近 N 个完整日历日（含今日），按本地时区日期字符串过滤
// - 隐私边界：只输出聚合数值与「显示名 + 统计值」，不含笔记、生词内容、登录信息
import { db } from './db.js'

// 统计窗口默认天数（与前端学习统计「近 30 天」口径一致）
export const DEFAULT_CLASS_STATS_DAYS = 30
// 窗口上限：防止一次查询跨度过大导致全表扫描
export const MAX_CLASS_STATS_DAYS = 180

export interface ClassStudentRow {
  userId: string
  username: string
  displayName: string
  articlesRead: number
  wordsLearned: number
  wordsReviewed: number
  wordsMastered: number
  // 窗口内有 stats 记录的天数
  activeDays: number
  // 窗口内最新一条 stats 的连续打卡天数
  streak: number
  // 窗口内最近一次有学习记录的日期 YYYY-MM-DD，无记录为 null
  lastActiveDate: string | null
  // 窗口内阅读平均正确率（0-1，无阅读会话为 0）
  correctRate: number
}

export interface ClassStatsSummary {
  // 学员总数（role=student 且 status=active）
  studentCount: number
  // 窗口内有学习记录的学员数
  activeStudentCount: number
  totalArticlesRead: number
  totalWordsLearned: number
  totalWordsReviewed: number
  // 人均窗口内阅读篇数（保留 2 位小数）
  avgArticlesRead: number
  // 人均窗口内阅读正确率（0-1，无阅读会话时为 0）
  avgCorrectRate: number
  // 全窗口累计阅读时长（秒）
  totalReadingDurationSec: number
  // 全窗口阅读会话数
  totalSessions: number
}

export interface ClassStatsResult {
  days: number
  // 窗口起止日期（本地时区 YYYY-MM-DD，含两端）
  from: string
  to: string
  summary: ClassStatsSummary
  students: ClassStudentRow[]
}

// 本地时区日期字符串（与 stats.id 的 YYYY-MM-DD 口径一致）
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface StatsAggRow {
  userId: string
  articlesRead: number | null
  wordsLearned: number | null
  wordsReviewed: number | null
  wordsMastered: number | null
  activeDays: number
  // 窗口内最大 id（`${userId}:${YYYY-MM-DD}`），用于回查最后一天的 streak
  latestId: string
}

interface SessionAggRow {
  userId: string
  sessions: number
  correctSum: number | null
  durationSum: number | null
}

// 数值兜底：历史数据缺失/NaN 时按 0 处理，避免聚合污染
function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

/**
 * 聚合班级学情（只读）。
 * @param options.days 窗口天数（含今日），默认 30，越界时收敛到 [1, MAX_CLASS_STATS_DAYS]
 */
export function getClassStats(options: { days?: number } = {}): ClassStatsResult {
  const requested = Number.isFinite(options.days)
    ? Math.floor(options.days as number)
    : DEFAULT_CLASS_STATS_DAYS
  const days = Math.min(MAX_CLASS_STATS_DAYS, Math.max(1, requested))

  const now = new Date()
  const to = toLocalDateStr(now)
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  fromDate.setDate(fromDate.getDate() - (days - 1))
  const from = toLocalDateStr(fromDate)

  const studentRows = db
    .prepare(
      `SELECT id AS userId, username, displayName FROM users
       WHERE role = 'student' AND status = 'active'
       ORDER BY displayName ASC, username ASC`,
    )
    .all() as Array<{ userId: string; username: string; displayName: string }>

  // stats 的 id 为 `${userId}:${YYYY-MM-DD}`：用 substr 截取业务日期做区间过滤，按用户聚合
  // 聚合行先拿到 latestId（窗口内最大 id），再用它回查 streak
  const statsRows = db
    .prepare(
      `SELECT userId,
              SUM(COALESCE(articlesRead, 0))  AS articlesRead,
              SUM(COALESCE(wordsLearned, 0))  AS wordsLearned,
              SUM(COALESCE(wordsReviewed, 0)) AS wordsReviewed,
              SUM(COALESCE(wordsMastered, 0)) AS wordsMastered,
              COUNT(*)                        AS activeDays,
              MAX(id)                         AS latestId
       FROM stats
       WHERE userId IS NOT NULL
         AND substr(id, LENGTH(userId) + 2) BETWEEN ? AND ?
       GROUP BY userId`,
    )
    .all(from, to) as StatsAggRow[]

  const statsMap = new Map(statsRows.map((r) => [r.userId, r]))

  // 阅读会话聚合（正确率、时长）：reviewedAt 为索引字段，按时间窗过滤后按用户分组
  const windowStartMs = fromDate.getTime()
  const sessionRows = db
    .prepare(
      `SELECT userId,
              COUNT(*)                   AS sessions,
              SUM(COALESCE(correctRate, 0)) AS correctSum,
              SUM(COALESCE(durationSec, 0)) AS durationSum
       FROM readingSessions
       WHERE userId IS NOT NULL AND reviewedAt >= ?
       GROUP BY userId`,
    )
    .all(windowStartMs) as SessionAggRow[]
  const sessionMap = new Map(sessionRows.map((r) => [r.userId, r]))

  const streakStmt = db.prepare('SELECT streak FROM stats WHERE id = ?')

  const students: ClassStudentRow[] = studentRows.map((s) => {
    const stats = statsMap.get(s.userId)
    const session = sessionMap.get(s.userId)
    const latestId = stats?.latestId ?? null
    const latestStreak = latestId
      ? (streakStmt.get(latestId) as { streak: number | null } | undefined)
      : undefined
    const sessions = num(session?.sessions)
    // 正确率：优先取阅读会话均值；无会话时回退 0（与「无数据」语义一致）
    const correctRate =
      sessions > 0 ? round2(num(session?.correctSum) / sessions) : 0
    return {
      userId: s.userId,
      username: s.username,
      displayName: s.displayName,
      articlesRead: num(stats?.articlesRead),
      wordsLearned: num(stats?.wordsLearned),
      wordsReviewed: num(stats?.wordsReviewed),
      wordsMastered: num(stats?.wordsMastered),
      activeDays: num(stats?.activeDays),
      streak: num(latestStreak?.streak),
      lastActiveDate: latestId ? latestId.slice(s.userId.length + 1).slice(0, 10) : null,
      correctRate,
    }
  })

  const studentCount = students.length
  const activeStudentCount = students.filter((s) => s.activeDays > 0 || s.lastActiveDate).length
  const totalArticlesRead = students.reduce((sum, s) => sum + s.articlesRead, 0)
  const totalWordsLearned = students.reduce((sum, s) => sum + s.wordsLearned, 0)
  const totalWordsReviewed = students.reduce((sum, s) => sum + s.wordsReviewed, 0)
  const totalSessions = sessionRows.reduce((sum, r) => sum + num(r.sessions), 0)
  const totalReadingDurationSec = sessionRows.reduce((sum, r) => sum + num(r.durationSum), 0)
  const totalCorrect = sessionRows.reduce((sum, r) => sum + num(r.correctSum), 0)

  return {
    days,
    from,
    to,
    summary: {
      studentCount,
      activeStudentCount,
      totalArticlesRead,
      totalWordsLearned,
      totalWordsReviewed,
      avgArticlesRead: studentCount > 0 ? round2(totalArticlesRead / studentCount) : 0,
      avgCorrectRate: totalSessions > 0 ? round2(totalCorrect / totalSessions) : 0,
      totalReadingDurationSec,
      totalSessions,
    },
    students,
  }
}