// 班级学情聚合测试（多用户 P3）
// 覆盖：
// 1. 权限：teacher / admin 200，student 403，未认证 401
// 2. 聚合口径：只统计在用学员、窗口过滤、禁用账号排除、私有表 id 前缀透明
// 3. 汇总：人均阅读、正确率、累计时长、活跃学员
// 4. 参数：days 默认 30、上限收敛 180、非法值回退默认
// 5. 审计：查询行为留痕（action=class_stats.view）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { adminRouter } from '../adminRoutes.js'
import { authMiddleware } from '../auth.js'
import { authRouter } from '../authRoutes.js'
import { queryAuditLogs, AUDIT_ACTIONS } from '../audit.js'
import { db } from '../db.js'
import { createRealUser } from './testUsers.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next()
    return authMiddleware(req, res, next)
  })
  app.use('/api/admin', adminRouter)
  return app
}

const app = createApp()

function clearAll() {
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM users').run()
  db.prepare('DELETE FROM operation_logs').run()
  db.prepare('DELETE FROM stats').run()
  db.prepare('DELETE FROM readingSessions').run()
}

beforeEach(() => {
  clearAll()
})

afterEach(() => {
  clearAll()
})

function localDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 写入一条学员每日统计（私有表 id 前缀 `${userId}:`，与多用户迁移后的存储形态一致）
function seedStats(
  userId: string,
  date: string,
  values: {
    articlesRead?: number
    wordsLearned?: number
    wordsReviewed?: number
    wordsMastered?: number
    streak?: number
  },
): void {
  db.prepare(
    'INSERT INTO stats (id, userId, articlesRead, wordsLearned, wordsReviewed, wordsMastered, streak, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    `${userId}:${date}`,
    userId,
    values.articlesRead ?? 0,
    values.wordsLearned ?? 0,
    values.wordsReviewed ?? 0,
    values.wordsMastered ?? 0,
    values.streak ?? 0,
    Date.now(),
  )
}

function seedSession(userId: string, correctRate: number, durationSec: number, reviewedAt = Date.now()): void {
  db.prepare(
    'INSERT INTO readingSessions (id, userId, durationSec, correctRate, reviewedAt, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`${userId}:s-${Math.random().toString(36).slice(2)}`, userId, durationSec, correctRate, reviewedAt, Date.now())
}

describe('GET /api/admin/class-stats 权限', () => {
  it('teacher 可访问', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    const res = await request(app).get('/api/admin/class-stats').set('x-user-token', token)
    expect(res.status).toBe(200)
    expect(res.body.days).toBe(30)
  })

  it('admin 可访问', async () => {
    const { token } = createRealUser({ role: 'admin' })
    const res = await request(app).get('/api/admin/class-stats').set('x-user-token', token)
    expect(res.status).toBe(200)
  })

  it('student 返回 403 FORBIDDEN', async () => {
    const { token } = createRealUser({ role: 'student' })
    const res = await request(app).get('/api/admin/class-stats').set('x-user-token', token)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('未认证返回 401', async () => {
    const res = await request(app).get('/api/admin/class-stats')
    expect(res.status).toBe(401)
  })
})

describe('聚合口径', () => {
  it('按窗口聚合学员数据，并排除教师与禁用账号', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    const alice = createRealUser({ role: 'student', displayName: 'Alice' })
    const bob = createRealUser({ role: 'student', displayName: 'Bob' })
    const carol = createRealUser({ role: 'student', displayName: 'Carol' })
    // Carol 禁用：不计入班级
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(carol.user.id)
    // 教师账号也不是学员
    createRealUser({ role: 'teacher', displayName: 'Teacher' })

    seedStats(alice.user.id, localDate(), { articlesRead: 2, wordsLearned: 5, streak: 3 })
    seedStats(alice.user.id, localDate(-1), { articlesRead: 1, wordsLearned: 2, streak: 2 })
    seedStats(bob.user.id, localDate(), { articlesRead: 4, wordsReviewed: 7, streak: 1 })
    // 窗口外（40 天前）：不计入 30 天窗口
    seedStats(bob.user.id, localDate(-40), { articlesRead: 99, wordsLearned: 99 })
    // 禁用账号的数据不计入
    seedStats(carol.user.id, localDate(), { articlesRead: 50 })

    const res = await request(app).get('/api/admin/class-stats').set('x-user-token', token)
    expect(res.status).toBe(200)
    expect(res.body.summary.studentCount).toBe(2)
    expect(res.body.summary.activeStudentCount).toBe(2)
    expect(res.body.summary.totalArticlesRead).toBe(7)
    expect(res.body.summary.totalWordsLearned).toBe(7)
    expect(res.body.summary.totalWordsReviewed).toBe(7)

    const names = (res.body.students as Array<{ displayName: string }>).map((s) => s.displayName)
    expect(names).toEqual(['Alice', 'Bob'])

    const aliceRow = (res.body.students as Array<Record<string, unknown>>).find(
      (s) => s.displayName === 'Alice',
    )!
    expect(aliceRow.articlesRead).toBe(3)
    expect(aliceRow.wordsLearned).toBe(7)
    expect(aliceRow.activeDays).toBe(2)
    // streak 取窗口内最新一天的值
    expect(aliceRow.streak).toBe(3)
    expect(aliceRow.lastActiveDate).toBe(localDate())
  })

  it('汇总人均指标与阅读会话正确率', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    const alice = createRealUser({ role: 'student', displayName: 'Alice' })
    const bob = createRealUser({ role: 'student', displayName: 'Bob' })

    seedStats(alice.user.id, localDate(), { articlesRead: 2 })
    seedStats(bob.user.id, localDate(), { articlesRead: 1 })
    seedSession(alice.user.id, 0.8, 600)
    seedSession(alice.user.id, 0.6, 300)
    seedSession(bob.user.id, 1, 100)

    const res = await request(app).get('/api/admin/class-stats').set('x-user-token', token)
    const { summary } = res.body as {
      summary: {
        avgArticlesRead: number
        avgCorrectRate: number
        totalReadingDurationSec: number
        totalSessions: number
      }
    }
    // (2 + 1) / 2 名学员
    expect(summary.avgArticlesRead).toBe(1.5)
    // (0.8 + 0.6 + 1) / 3 次会话，保留两位小数
    expect(summary.avgCorrectRate).toBe(0.8)
    expect(summary.totalReadingDurationSec).toBe(1000)
    expect(summary.totalSessions).toBe(3)

    const aliceRow = (res.body.students as Array<Record<string, unknown>>).find(
      (s) => s.displayName === 'Alice',
    )!
    expect(aliceRow.correctRate).toBe(0.7)
  })

  it('无学员时返回零值而非报错', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    const res = await request(app).get('/api/admin/class-stats').set('x-user-token', token)
    expect(res.status).toBe(200)
    expect(res.body.students).toEqual([])
    expect(res.body.summary.studentCount).toBe(0)
    expect(res.body.summary.avgArticlesRead).toBe(0)
    expect(res.body.summary.avgCorrectRate).toBe(0)
    expect(res.body.from).toBe(localDate(-29))
    expect(res.body.to).toBe(localDate())
  })

  it('days 参数：生效、上限收敛 180、非法值回退默认 30', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    const seven = await request(app).get('/api/admin/class-stats?days=7').set('x-user-token', token)
    expect(seven.body.days).toBe(7)
    expect(seven.body.from).toBe(localDate(-6))

    const huge = await request(app).get('/api/admin/class-stats?days=9999').set('x-user-token', token)
    expect(huge.body.days).toBe(180)

    const bad = await request(app).get('/api/admin/class-stats?days=abc').set('x-user-token', token)
    expect(bad.body.days).toBe(30)
  })

  it('查询行为留痕：action=class_stats.view 记录查询者与窗口', async () => {
    const { user, token } = createRealUser({ role: 'teacher' })
    await request(app).get('/api/admin/class-stats?days=7').set('x-user-token', token)

    const { items } = queryAuditLogs({ action: AUDIT_ACTIONS.classStatsView })
    expect(items.length).toBe(1)
    expect(items[0]!.userId).toBe(user.id)
    expect(JSON.parse(items[0]!.detail!)).toMatchObject({ days: 7 })
  })
})