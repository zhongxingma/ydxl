// 会话管理测试：我的设备 / 移除单个设备 / 全端下线
// 覆盖：
// - GET /api/auth/sessions：仅返回本人会话、当前设备标记、不泄露完整令牌
// - DELETE /api/auth/sessions/:id：吊销指定设备、越权（他人 rowid）拒绝
// - DELETE /api/auth/sessions：全端下线（含当前设备自身）
// - 审计留痕：auth.revoke_session / auth.logout_all
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { authRouter } from '../authRoutes.js'
import { createSession } from '../auth.js'
import { db } from '../db.js'
import { createRealUser } from './testUsers.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  return app
}

const app = createApp()

function clearAuthTables() {
  db.prepare('DELETE FROM operation_logs').run()
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM users').run()
}

// 为已有用户直接签发第二个会话（模拟另一台设备登录），返回令牌
function extraToken(userId: string): string {
  return createSession(userId, '203.0.113.7', 'Mozilla/5.0 (TestDevice)')
}

describe('会话管理 API', () => {
  beforeEach(() => {
    clearAuthTables()
  })

  describe('GET /api/auth/sessions', () => {
    it('未认证返回 401', async () => {
      const res = await request(app).get('/api/auth/sessions')
      expect(res.status).toBe(401)
    })

    it('仅返回本人会话，当前设备标记 current=true，且不泄露完整令牌', async () => {
      const a = createRealUser({ username: 'dev-a' })
      const other = createRealUser({ username: 'dev-b' })
      const token2 = extraToken(a.user.id)
      // 保证干扰项存在
      expect(other.token).not.toBe(a.token)

      const res = await request(app).get('/api/auth/sessions').set('x-user-token', a.token)
      expect(res.status).toBe(200)
      const items = res.body.items as Array<Record<string, unknown>>
      expect(items).toHaveLength(2)

      // 两行均含脱敏指纹（前 8 + 尾 4），绝不返回完整令牌
      for (const row of items) {
        expect(typeof row.tokenFingerprint).toBe('string')
        expect(row.tokenFingerprint).toContain('…')
        expect(row.tokenFingerprint).not.toContain(a.token)
        expect(row.tokenFingerprint).not.toContain(token2)
        expect(row.sessionId).toBeTypeOf('number')
        expect(row.ip).toBeDefined()
        expect(row.userAgent).toBeDefined()
      }
      // 当前设备标记：恰好一行为 true，且指纹与当前令牌首尾一致
      const current = items.find((r) => r.current === true)!
      expect(current.tokenFingerprint).toBe(`${a.token.slice(0, 8)}…${a.token.slice(-4)}`)
      expect(items.filter((r) => r.current).length).toBe(1)
      // 他人会话不出现（按 userId 过滤）
      expect(items.every((r) => r.current !== other.token)).toBe(true)
    })

    it('过期会话不返回（惰性清理生效）', async () => {
      const a = createRealUser({ username: 'dev-c' })
      // 造一条已过期会话
      db.prepare(
        'INSERT INTO sessions (token, userId, createdAt, expiresAt, ip, userAgent) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('expired-token-000000', a.user.id, Date.now() - 10 * 24 * 3600 * 1000, Date.now() - 9 * 24 * 3600 * 1000, '10.0.0.1', 'old')

      const res = await request(app).get('/api/auth/sessions').set('x-user-token', a.token)
      expect(res.status).toBe(200)
      const items = res.body.items as Array<Record<string, unknown>>
      expect(items).toHaveLength(1)
      // 过期行已被惰性删除
      const gone = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE token = ?').get('expired-token-000000') as { c: number }
      expect(gone.c).toBe(0)
    })
  })

  describe('DELETE /api/auth/sessions/:id（移除单个设备）', () => {
    it('吊销指定设备：该令牌立即失效，其他设备不受影响', async () => {
      const a = createRealUser({ username: 'rm-a' })
      const token2 = extraToken(a.user.id)

      const list = await request(app).get('/api/auth/sessions').set('x-user-token', a.token)
      const items = list.body.items as Array<{ sessionId: number; current: boolean }>
      const target = items.find((r) => !r.current)!

      const res = await request(app)
        .delete(`/api/auth/sessions/${target.sessionId}`)
        .set('x-user-token', a.token)
      expect(res.status).toBe(204)
      // 被移除会话的令牌立即 401（此处 token2 对应目标行，按指纹验证后删除）
      const gone = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE token = ?').get(token2) as { c: number }
      expect(gone.c).toBe(0)
      // 当前设备仍可访问
      const me = await request(app).get('/api/auth/me').set('x-user-token', a.token)
      expect(me.status).toBe(200)
    })

    it('无效 id（非数字 / 非正数）返回 400', async () => {
      const a = createRealUser({ username: 'rm-b' })
      for (const bad of ['abc', '-1', '0']) {
        const res = await request(app)
          .delete(`/api/auth/sessions/${bad}`)
          .set('x-user-token', a.token)
        expect(res.status).toBe(400)
      }
    })

    it('不存在的 id 返回 404', async () => {
      const a = createRealUser({ username: 'rm-c' })
      const res = await request(app)
        .delete('/api/auth/sessions/999999')
        .set('x-user-token', a.token)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('越权：他人会话的 rowid 不可被删除', async () => {
      const a = createRealUser({ username: 'rm-d' })
      const b = createRealUser({ username: 'rm-e' })
      // b 的会话 rowid 由 a 尝试删除
      const bRow = db.prepare('SELECT rowid AS rid FROM sessions WHERE token = ?').get(b.token) as { rid: number }
      const res = await request(app)
        .delete(`/api/auth/sessions/${bRow.rid}`)
        .set('x-user-token', a.token)
      expect(res.status).toBe(404)
      // b 的会话完好
      const still = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE token = ?').get(b.token) as { c: number }
      expect(still.c).toBe(1)
    })
  })

  describe('DELETE /api/auth/sessions（全端下线）', () => {
    it('吊销本人全部会话（含当前设备），其他用户不受影响', async () => {
      const a = createRealUser({ username: 'all-a' })
      extraToken(a.user.id)
      const b = createRealUser({ username: 'all-b' })

      const res = await request(app).delete('/api/auth/sessions').set('x-user-token', a.token)
      expect(res.status).toBe(204)
      // a 的会话（含当前）全部失效
      const aRows = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE userId = ?').get(a.user.id) as { c: number }
      expect(aRows.c).toBe(0)
      // b 不受影响
      const meB = await request(app).get('/api/auth/me').set('x-user-token', b.token)
      expect(meB.status).toBe(200)
    })
  })

  describe('审计留痕', () => {
    function lastAudit(action: string) {
      return db
        .prepare('SELECT * FROM operation_logs WHERE action = ? ORDER BY createdAt DESC, id ASC LIMIT 1')
        .get(action) as Record<string, unknown> | undefined
    }

    it('移除设备记录 auth.revoke_session（含操作者与资源 id）', async () => {
      const a = createRealUser({ username: 'audit-rm' })
      extraToken(a.user.id)
      const list = await request(app).get('/api/auth/sessions').set('x-user-token', a.token)
      const items = list.body.items as Array<{ sessionId: number; current: boolean }>
      const target = items.find((r) => !r.current)!
      const res = await request(app)
        .delete(`/api/auth/sessions/${target.sessionId}`)
        .set('x-user-token', a.token)
      expect(res.status).toBe(204)

      const row = lastAudit('auth.revoke_session')
      expect(row).toBeDefined()
      expect(row!.userId).toBe(a.user.id)
      expect(row!.username).toBe('audit-rm')
      expect(row!.resource).toBe('session')
      expect(row!.resourceId).toBe(String(target.sessionId))
      expect(row!.result).toBe('success')
    })

    it('全端下线记录 auth.logout_all', async () => {
      const a = createRealUser({ username: 'audit-all' })
      const res = await request(app).delete('/api/auth/sessions').set('x-user-token', a.token)
      expect(res.status).toBe(204)
      const row = lastAudit('auth.logout_all')
      expect(row).toBeDefined()
      expect(row!.userId).toBe(a.user.id)
      expect(row!.result).toBe('success')
    })
  })
})
