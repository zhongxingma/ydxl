// 审计日志测试
// 覆盖：
// 1. logOperation 写入五要素 + detail 脱敏（敏感键剔除，日志中 grep 不到密码/token）
// 2. 审计接入点：认证（登录成功/失败/登出）、用户管理（创建/禁用/改角色/重置密码）、
//    权限拒绝 403、表写操作（words create/delete/bulk）、logs.query 自身留痕
// 3. 查询 API：权限（teacher 通过 / student 403）、过滤（userId/action）、分页
// 4. CSV 导出：响应头与内容
// 5. 保留策略 runAuditRetention：过期归档 CSV + 清理 + 幂等
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adminRouter } from '../adminRoutes.js'
import { authMiddleware } from '../auth.js'
import { authRouter } from '../authRoutes.js'
import { createTableRouter, createWordsBulkRouter } from '../routes.js'
import { logOperation, queryAuditLogs, runAuditRetention, AUDIT_ACTIONS } from '../audit.js'
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
  // words 表路由（bulk 必须在通用路由之前，与 index.ts 挂载顺序一致）
  app.use('/api/words/bulk', createWordsBulkRouter())
  app.use('/api/words', createTableRouter('words'))
  return app
}

const app = createApp()

function clearAll() {
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM users').run()
  db.prepare('DELETE FROM operation_logs').run()
  db.prepare('DELETE FROM words').run()
}

beforeEach(() => {
  clearAll()
})

afterEach(() => {
  clearAll()
})

describe('logOperation 写入与脱敏', () => {
  it('写入五要素齐全：userId/username/action/resource/resourceId/result/ip/createdAt', () => {
    logOperation({
      userId: 'u-1',
      username: 'alice',
      action: AUDIT_ACTIONS.userCreate,
      resource: 'users',
      resourceId: 'u-2',
      detail: { role: 'student' },
      ip: '127.0.0.1',
    })
    const { items } = queryAuditLogs({})
    expect(items.length).toBe(1)
    const row = items[0]!
    expect(row.userId).toBe('u-1')
    expect(row.username).toBe('alice')
    expect(row.action).toBe('user.create')
    expect(row.resource).toBe('users')
    expect(row.resourceId).toBe('u-2')
    expect(row.result).toBe('success')
    expect(row.ip).toBe('127.0.0.1')
    expect(typeof row.createdAt).toBe('number')
    expect(JSON.parse(row.detail!)).toEqual({ role: 'student' })
  })

  it('detail 脱敏：敏感键整键剔除（日志中查不到密码与令牌）', () => {
    logOperation({
      userId: 'u-1',
      action: 'test.sanitize',
      detail: {
        password: 'plain-secret',
        newPassword: 'another-secret',
        accessToken: 'tok-123',
        apiKey: 'sk-xxx',
        userNote: '私人笔记',
        safeField: 'ok',
      },
    })
    const { items } = queryAuditLogs({})
    const detail = items[0]!.detail ?? ''
    expect(detail).not.toContain('plain-secret')
    expect(detail).not.toContain('another-secret')
    expect(detail).not.toContain('tok-123')
    expect(detail).not.toContain('sk-xxx')
    expect(detail).not.toContain('私人笔记')
    expect(detail).toContain('ok')
  })

  it('result 缺省 success，显式 denied/failed 正常写入', () => {
    logOperation({ action: 'a.denied', result: 'denied' })
    logOperation({ action: 'a.failed', result: 'failed' })
    const { items } = queryAuditLogs({})
    const byAction = new Map(items.map((r) => [r.action, r.result]))
    expect(byAction.get('a.denied')).toBe('denied')
    expect(byAction.get('a.failed')).toBe('failed')
  })

  it('logOperation 内部失败不抛出（吞异常不阻塞业务）', () => {
    // 传入非法 detail（不可序列化的循环引用）不应抛出
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => logOperation({ action: 'test.circular', detail: circular })).not.toThrow()
  })
})

describe('认证事件审计', () => {
  it('登录成功与失败均留痕', async () => {
    const { password } = createRealUser({ username: 'alice' })
    await request(app).post('/api/auth/login').send({ username: 'alice', password: 'wrong!' })
    await request(app).post('/api/auth/login').send({ username: 'alice', password })
    await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'whatever-1' })

    const rows = queryAuditLogs({}).items
    const failed = rows.filter((r) => r.action === AUDIT_ACTIONS.authLoginFailed)
    const success = rows.filter((r) => r.action === AUDIT_ACTIONS.authLoginSuccess)
    expect(failed.length).toBe(2)
    expect(success.length).toBe(1)
    // 失败日志记录尝试的用户名（防枚举不影响审计追溯）
    expect(failed.some((r) => r.username === 'ghost')).toBe(true)
    expect(success[0]!.username).toBe('alice')
  })

  it('登出留痕', async () => {
    const { token } = createRealUser({ username: 'alice' })
    await request(app).post('/api/auth/logout').set('x-user-token', token)
    const rows = queryAuditLogs({ action: AUDIT_ACTIONS.authLogout }).items
    expect(rows.length).toBe(1)
    expect(rows[0]!.username).toBe('alice')
  })

  it('自助修改密码留痕', async () => {
    const { token } = createRealUser({ username: 'alice' })
    await request(app)
      .post('/api/auth/change-password')
      .set('x-user-token', token)
      .send({ oldPassword: 'test-pass-123', newPassword: 'new-pass-999' })
    const rows = queryAuditLogs({ action: AUDIT_ACTIONS.authChangePassword }).items
    expect(rows.length).toBe(1)
  })
})

describe('用户管理与权限拒绝审计', () => {
  it('管理操作留痕：创建/禁用/改角色/重置密码', async () => {
    const { token, user: admin } = createRealUser({ role: 'admin' })
    const create = await request(app)
      .post('/api/admin/users')
      .set('x-user-token', token)
      .send({ username: 'stu1', displayName: '学生一', password: 'stu-pass-1' })
    const stuId = create.body.user.id

    await request(app)
      .put(`/api/admin/users/${stuId}/status`)
      .set('x-user-token', token)
      .send({ status: 'disabled' })
    await request(app)
      .put(`/api/admin/users/${stuId}/role`)
      .set('x-user-token', token)
      .send({ role: 'teacher' })
    await request(app)
      .post(`/api/admin/users/${stuId}/reset-password`)
      .set('x-user-token', token)
      .send({ newPassword: 'reset-pass-1' })

    const rows = queryAuditLogs({}).items.filter(
      (r) => r.resource === 'users' && r.userId === admin.id,
    )
    // 同毫秒内日志顺序不保证（UUID 主键），按集合断言
    const actions = new Set(rows.map((r) => r.action))
    expect(actions).toEqual(
      new Set([
        AUDIT_ACTIONS.userCreate,
        AUDIT_ACTIONS.userDisable,
        AUDIT_ACTIONS.userChangeRole,
        AUDIT_ACTIONS.userResetPassword,
      ]),
    )
    // 管理操作均指向目标用户
    for (const row of rows) expect(row.resourceId).toBe(stuId)
    // 审计不记录密码内容
    const resetRow = JSON.stringify(rows.find((r) => r.action === AUDIT_ACTIONS.userResetPassword))
    expect(resetRow).not.toContain('reset-pass-1')
    // 改角色记录 from/to
    const roleRow = JSON.parse(
      rows.find((r) => r.action === AUDIT_ACTIONS.userChangeRole)!.detail ?? '{}',
    )
    expect(roleRow.from).toBe('student')
    expect(roleRow.to).toBe('teacher')
  })

  it('student 访问管理端点 403 时留 permission.denied 拒绝痕迹', async () => {
    const { token } = createRealUser({ role: 'student' })
    await request(app).get('/api/admin/users').set('x-user-token', token)
    const rows = queryAuditLogs({ action: AUDIT_ACTIONS.permissionDenied }).items
    expect(rows.length).toBe(1)
    expect(rows[0]!.result).toBe('denied')
    expect(JSON.parse(rows[0]!.detail ?? '{}').permission).toBe('users:manage')
  })
})

describe('表写操作审计', () => {
  it('words create / delete 留痕，GET 不留痕', async () => {
    const { token } = createRealUser({ role: 'student' })
    await request(app)
      .post('/api/words')
      .set('x-user-token', token)
      .send({ id: 'apple', word: 'apple', definition: '苹果' })
    await request(app).get('/api/words').set('x-user-token', token)
    await request(app).delete('/api/words/apple').set('x-user-token', token)

    const actions = queryAuditLogs({}).items.map((r) => r.action)
    expect(actions).toContain('words.create')
    expect(actions).toContain('words.delete')
    expect(actions.filter((a) => a.startsWith('words.')).length).toBe(2)
  })

  it('words bulk_import 留痕并记录 added/skipped 统计', async () => {
    const { token } = createRealUser({ role: 'student' })
    await request(app)
      .post('/api/words/bulk')
      .set('x-user-token', token)
      .send({ items: [{ id: 'apple', word: 'apple' }, { id: 'pear', word: 'pear' }] })
    const rows = queryAuditLogs({ action: AUDIT_ACTIONS.wordsBulkImport }).items
    expect(rows.length).toBe(1)
    const detail = JSON.parse(rows[0]!.detail ?? '{}')
    expect(detail.added).toBe(2)
    expect(detail.skipped).toBe(0)
  })

  it('业务 id 不含用户前缀（透明映射对审计透明）', async () => {
    const { token } = createRealUser({ role: 'student' })
    await request(app)
      .post('/api/words')
      .set('x-user-token', token)
      .send({ id: 'apple', word: 'apple' })
    const rows = queryAuditLogs({ action: 'words.create' }).items
    expect(rows[0]!.resourceId).toBe('apple')
  })
})

describe('日志查询 API /api/admin/logs', () => {
  it('teacher（logs:view）可查询，查询行为本身留痕', async () => {
    const { token } = createRealUser({ role: 'teacher', username: 'wang' })
    const res = await request(app).get('/api/admin/logs').set('x-user-token', token)
    expect(res.status).toBe(200)
    expect(res.body.items).toBeDefined()
    expect(typeof res.body.total).toBe('number')

    // logs.query 自身留痕（敏感读必记）
    const rows = queryAuditLogs({ action: AUDIT_ACTIONS.logsQuery }).items
    expect(rows.length).toBe(1)
    expect(rows[0]!.username).toBe('wang')
  })

  it('student 查询日志 403（logs:view 未持有）', async () => {
    const { token } = createRealUser({ role: 'student' })
    const res = await request(app).get('/api/admin/logs').set('x-user-token', token)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('action / userId 过滤（HTTP 级）', async () => {
    const { token, user } = createRealUser({ role: 'admin' })
    logOperation({ userId: 'u-other', action: 'auth.login.success' })
    logOperation({ userId: user.id, action: 'words.create' })

    // action 过滤：查询自身留痕（logs.query）不影响 action 匹配结果
    const byAction = await request(app)
      .get('/api/admin/logs?action=words.create')
      .set('x-user-token', token)
    expect(byAction.body.total).toBe(1)
    expect(byAction.body.items[0].action).toBe('words.create')

    // userId + action 组合过滤
    const combined = await request(app)
      .get(`/api/admin/logs?userId=${user.id}&action=words.create`)
      .set('x-user-token', token)
    expect(combined.body.total).toBe(1)
  })

  it('userId 过滤与分页（函数级，规避查询留痕对计数的干扰）', () => {
    const userA = 'u-a'
    const userB = 'u-b'
    logOperation({ userId: userA, action: 'words.create' })
    logOperation({ userId: userA, action: 'words.delete' })
    logOperation({ userId: userB, action: 'words.create' })
    logOperation({ userId: userB, action: 'words.create' })

    const byUser = queryAuditLogs({ userId: userA })
    expect(byUser.total).toBe(2)

    const page1 = queryAuditLogs({ userId: userB, limit: 2, offset: 0 })
    const page2 = queryAuditLogs({ userId: userB, limit: 2, offset: 2 })
    expect(page1.total).toBe(2)
    expect(page1.items.length).toBe(2)
    expect(page2.items.length).toBe(0)
  })
})

describe('CSV 导出 /api/admin/logs/export', () => {
  it('teacher 导出 CSV：响应头与内容正确', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    logOperation({ userId: 'u-1', username: 'alice', action: 'words.create', resourceId: 'apple' })
    const res = await request(app).get('/api/admin/logs/export').set('x-user-token', token)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    const text = res.text.replace(/^\uFEFF/, '')
    const lines = text.trim().split('\n')
    expect(lines[0]).toContain('id,userId,username,action')
    expect(lines.length).toBe(2)
    expect(lines[1]).toContain('words.create')
    expect(lines[1]).toContain('alice')
  })

  it('导出行为留痕（logs.export）', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    await request(app).get('/api/admin/logs/export').set('x-user-token', token)
    const rows = queryAuditLogs({ action: AUDIT_ACTIONS.logsExport }).items
    expect(rows.length).toBe(1)
  })

  it('CSV 转义：detail 含逗号与引号时正确包裹', async () => {
    logOperation({
      action: 'test.csv',
      detail: { msg: '含,逗号' },
    })
    const { items } = queryAuditLogs({})
    // 直接复用导出渲染逻辑验证转义（不经 HTTP）
    const { renderLogsCsv } = await import('../audit.js')
    const csv = renderLogsCsv(items)
    // detail JSON 含逗号 → 整列被双引号包裹；JSON 花括号与引号如实保留
    expect(csv).toContain('"{""msg"":""含,逗号""}"')
  })
})

describe('保留策略 runAuditRetention', () => {
  it('过期日志归档 CSV 并清理；未过期保留；无过期日志时幂等', () => {
    const archiveDir = mkdtempSync(join(tmpdir(), 'ydxl-audit-'))
    try {
      const now = Date.now()
      const old = now - 181 * 24 * 60 * 60 * 1000
      const recent = now - 1 * 24 * 60 * 60 * 60 * 1000
      db.prepare(
        `INSERT INTO operation_logs (id, userId, username, action, resource, resourceId, result, detail, ip, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('log-old', 'u-1', 'alice', 'words.create', 'words', 'apple', 'success', null, '127.0.0.1', old)
      db.prepare(
        `INSERT INTO operation_logs (id, userId, username, action, resource, resourceId, result, detail, ip, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('log-new', 'u-1', 'alice', 'words.delete', 'words', 'apple', 'success', null, '127.0.0.1', recent)

      const result = runAuditRetention({ archiveDir, now })
      expect(result.archived).toBe(1)
      expect(result.deleted).toBe(1)
      expect(result.archiveFile).toContain('audit-logs-')

      // 库中仅剩未过期日志
      const remaining = queryAuditLogs({})
      expect(remaining.total).toBe(1)
      expect(remaining.items[0]!.id).toBe('log-new')

      // 归档 CSV 含过期行数据
      const csv = readFileSync(result.archiveFile!, 'utf-8')
      expect(csv).toContain('words.create')
      expect(csv).toContain('alice')

      // 幂等：再次执行无动作
      const again = runAuditRetention({ archiveDir, now })
      expect(again.archived).toBe(0)
      expect(again.deleted).toBe(0)
    } finally {
      rmSync(archiveDir, { recursive: true, force: true })
    }
  })
})
