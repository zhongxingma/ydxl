// 认证端到端测试（多用户 P0）
// 覆盖：登录成功/失败/锁定/统一防枚举文案、登出吊销、me 探针、修改密码全端下线、
//       authMiddleware 401 语义、禁用用户会话失效
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { authRouter } from '../authRoutes.js'
import { authMiddleware, createUser, deleteUserSessions } from '../auth.js'
import { db } from '../db.js'
import { createRealUser } from './testUsers.js'

// 构建测试应用：认证路由 + 一个受保护的探针路由（模拟业务端点）
function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.get('/api/protected', authMiddleware, (req, res) => res.json({ ok: true, user: req.user }))
  return app
}

const app = createApp()

function clearAuthTables() {
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM users').run()
}

describe('认证 API', () => {
  beforeEach(() => {
    clearAuthTables()
  })

  describe('POST /api/auth/login', () => {
    it('正确用户名密码登录成功，返回 token 与用户信息（不含 passwordHash）', async () => {
      const { password } = createRealUser({ username: 'alice', displayName: '爱丽丝' })
      const res = await request(app).post('/api/auth/login').send({ username: 'alice', password })
      expect(res.status).toBe(200)
      expect(typeof res.body.token).toBe('string')
      expect(res.body.token.length).toBe(64)
      expect(res.body.user.username).toBe('alice')
      expect(res.body.user.displayName).toBe('爱丽丝')
      expect(res.body.user.role).toBe('student')
      expect(res.body.user.passwordHash).toBeUndefined()
    })

    it('密码错误返回 401 统一文案', async () => {
      createRealUser({ username: 'bob' })
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'wrong-password' })
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('用户名不存在返回相同 401 文案（防用户名枚举）', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'no-such-user', password: 'whatever-123' })
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
      expect(res.body.error.message).toBe('用户名或密码错误')
    })

    it('缺少用户名或密码返回 400', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'alice' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_INPUT')
    })

    it('连续失败 5 次后账号锁定，正确密码也返回 403 ACCOUNT_LOCKED', async () => {
      const { password } = createRealUser({ username: 'carol' })
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ username: 'carol', password: 'wrong-password' })
        expect(res.status).toBe(401)
      }
      const res = await request(app).post('/api/auth/login').send({ username: 'carol', password })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED')
    })

    it('登录成功后失败计数清零（再失败不会立即锁定）', async () => {
      const { password } = createRealUser({ username: 'dave' })
      for (let i = 0; i < 4; i++) {
        await request(app).post('/api/auth/login').send({ username: 'dave', password: 'wrong-1' })
      }
      await request(app).post('/api/auth/login').send({ username: 'dave', password })
      // 成功登录清零计数：再失败 1 次不应锁定
      await request(app).post('/api/auth/login').send({ username: 'dave', password: 'wrong-1' })
      const res = await request(app).post('/api/auth/login').send({ username: 'dave', password })
      expect(res.status).toBe(200)
    })
  })

  describe('受保护端点与登出', () => {
    it('无 token 访问受保护端点返回 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/protected')
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('无效 token 返回 401', async () => {
      const res = await request(app).get('/api/protected').set('x-user-token', 'invalid-token')
      expect(res.status).toBe(401)
    })

    it('有效 token 可访问并挂载 req.user', async () => {
      const { token, user } = createRealUser({ username: 'erin' })
      const res = await request(app).get('/api/protected').set('x-user-token', token)
      expect(res.status).toBe(200)
      expect(res.body.user.username).toBe('erin')
      expect(res.body.user.id).toBe(user.id)
    })

    it('登出后原 token 立即失效', async () => {
      const { token } = createRealUser({ username: 'frank' })
      const logout = await request(app).post('/api/auth/logout').set('x-user-token', token)
      expect(logout.status).toBe(204)
      const res = await request(app).get('/api/protected').set('x-user-token', token)
      expect(res.status).toBe(401)
    })

    it('GET /api/auth/me 返回当前用户', async () => {
      const { token, user } = createRealUser({ username: 'grace', displayName: '格蕾丝' })
      const res = await request(app).get('/api/auth/me').set('x-user-token', token)
      expect(res.status).toBe(200)
      expect(res.body.user.id).toBe(user.id)
      expect(res.body.user.displayName).toBe('格蕾丝')
    })
  })

  describe('POST /api/auth/change-password', () => {
    it('修改密码成功并吊销全部会话（全端下线），新密码可登录', async () => {
      const { token, user, password } = createRealUser({ username: 'henry' })
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('x-user-token', token)
        .send({ oldPassword: password, newPassword: 'new-pass-456' })
      expect(res.status).toBe(204)
      // 旧会话已吊销
      const probe = await request(app).get('/api/protected').set('x-user-token', token)
      expect(probe.status).toBe(401)
      // 旧密码失效、新密码可登录
      const oldLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: 'henry', password })
      expect(oldLogin.status).toBe(401)
      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: 'henry', password: 'new-pass-456' })
      expect(newLogin.status).toBe(200)
      expect(newLogin.body.user.id).toBe(user.id)
    })

    it('原密码错误返回 401', async () => {
      const { token } = createRealUser({ username: 'iris' })
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('x-user-token', token)
        .send({ oldPassword: 'wrong-old', newPassword: 'new-pass-456' })
      expect(res.status).toBe(401)
    })

    it('新密码不足 6 位返回 400', async () => {
      const { token, password } = createRealUser({ username: 'jack' })
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('x-user-token', token)
        .send({ oldPassword: password, newPassword: '123' })
      expect(res.status).toBe(400)
    })
  })

  describe('禁用用户', () => {
    it('status=disabled 的用户无法登录，已有会话立即失效', async () => {
      const { token, password } = createRealUser({ username: 'kate' })
      db.prepare(`UPDATE users SET status = 'disabled' WHERE username = 'kate'`).run()
      const login = await request(app).post('/api/auth/login').send({ username: 'kate', password })
      expect(login.status).toBe(401)
      const probe = await request(app).get('/api/protected').set('x-user-token', token)
      expect(probe.status).toBe(401)
    })
  })

  describe('deleteUserSessions', () => {
    it('吊销指定用户全部会话，不影响其他用户', async () => {
      const u1 = createRealUser({ username: 'u1' })
      const u2 = createRealUser({ username: 'u2' })
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get('u1') as {
        id: string
      }
      deleteUserSessions(row.id)
      expect(
        (await request(app).get('/api/protected').set('x-user-token', u1.token)).status,
      ).toBe(401)
      expect(
        (await request(app).get('/api/protected').set('x-user-token', u2.token)).status,
      ).toBe(200)
    })
  })

  describe('createUser', () => {
    it('用户名冲突抛出 UNIQUE 约束错误（并发注册兜底）', () => {
      createUser({ username: 'dup', displayName: 'A', password: 'pass-123' })
      expect(() =>
        createUser({ username: 'dup', displayName: 'B', password: 'pass-456' }),
      ).toThrow()
    })
  })
})
