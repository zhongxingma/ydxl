// RBAC 与用户管理测试（多用户 P1）
// 覆盖：
// 1. 权限矩阵逐点校验（student / teacher / admin 三角色 × 9 个权限点）
// 2. requirePermission 中间件语义：未认证 401、无权限 403 FORBIDDEN
// 3. /api/admin/* 端点：student/teacher 403、admin 全流程（列表/创建/禁用/启用/重置密码/改角色）
// 4. 安全约束：响应不含 passwordHash、不能操作自己、禁用/重置密码/改角色即时吊销会话
// 注意：探针路径权限点中的 ':' 替换为 '-'，避免 Express 将 ':xxx' 解析为路径参数导致跨路由误匹配
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { adminRouter } from '../adminRoutes.js'
import { authMiddleware } from '../auth.js'
import { authRouter } from '../authRoutes.js'
import {
  hasPermission,
  requirePermission,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '../permissions.js'
import { db } from '../db.js'
import { createRealUser, TEST_USER } from './testUsers.js'

// 全部 9 个权限点（与设计文档 3.1 矩阵一致）
const ALL_PERMISSIONS: Permission[] = [
  'reading:use',
  'wordbook:own',
  'stats:own',
  'profile:own',
  'ai:invoke',
  'stats:class',
  'users:manage',
  'logs:view',
  'system:config',
]

const ALL_ROLES: Role[] = ['student', 'teacher', 'admin']

/** 权限点 → 探针路径（':' → '-'，规避 Express 路径参数语法） */
function probePath(permission: Permission): string {
  return `/api/probe/${permission.replace(':', '-')}`
}

// 测试应用：认证层（/auth 豁免，与 index.ts 挂载方式一致）+ 管理路由 + 逐权限点探针
function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next()
    return authMiddleware(req, res, next)
  })
  app.use('/api/admin', adminRouter)
  for (const perm of ALL_PERMISSIONS) {
    app.get(probePath(perm), requirePermission(perm), (req, res) =>
      res.json({ ok: true, role: req.user!.role }),
    )
  }
  return app
}

const app = createApp()

function clearAuthTables() {
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM users').run()
}

/** 会话有效性探针：reading:use 三角色均持有，token 失效与否决定 401/200 */
async function expectTokenValid(token: string, valid: boolean): Promise<void> {
  const res = await request(app).get(probePath('reading:use')).set('x-user-token', token)
  expect(res.status).toBe(valid ? 200 : 401)
}

describe('RBAC 权限矩阵', () => {
  it('权限点全集为 9 个且与设计文档 3.1 一致', () => {
    const union = new Set(ALL_PERMISSIONS)
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const perm of perms) union.add(perm)
    }
    expect(union.size).toBe(9)
  })

  it('student 仅持有 5 个个人功能权限', () => {
    const expected: Permission[] = [
      'reading:use',
      'wordbook:own',
      'stats:own',
      'profile:own',
      'ai:invoke',
    ]
    expect([...ROLE_PERMISSIONS.student]).toEqual(expected)
  })

  it('teacher = student 权限 + stats:class + logs:view，且不含 users:manage/system:config', () => {
    for (const perm of ROLE_PERMISSIONS.student) {
      expect(hasPermission({ ...TEST_USER, role: 'teacher' }, perm)).toBe(true)
    }
    expect(hasPermission({ ...TEST_USER, role: 'teacher' }, 'stats:class')).toBe(true)
    expect(hasPermission({ ...TEST_USER, role: 'teacher' }, 'logs:view')).toBe(true)
    expect(hasPermission({ ...TEST_USER, role: 'teacher' }, 'users:manage')).toBe(false)
    expect(hasPermission({ ...TEST_USER, role: 'teacher' }, 'system:config')).toBe(false)
  })

  it('admin 持有全部 9 个权限点', () => {
    expect(ROLE_PERMISSIONS.admin.length).toBe(9)
    for (const perm of ALL_PERMISSIONS) {
      expect(hasPermission({ ...TEST_USER, role: 'admin' }, perm)).toBe(true)
    }
  })

  it('权限矩阵逐点校验：每个角色 × 每个权限点', () => {
    const expected: Record<Role, Set<Permission>> = {
      student: new Set(ROLE_PERMISSIONS.student),
      teacher: new Set(ROLE_PERMISSIONS.teacher),
      admin: new Set(ROLE_PERMISSIONS.admin),
    }
    for (const role of ALL_ROLES) {
      for (const perm of ALL_PERMISSIONS) {
        expect(hasPermission({ ...TEST_USER, role }, perm)).toBe(expected[role].has(perm))
      }
    }
  })

  it('未知角色一律无权限（fail-closed）', () => {
    const ghost = { ...TEST_USER, role: 'superuser' }
    for (const perm of ALL_PERMISSIONS) {
      expect(hasPermission(ghost, perm)).toBe(false)
    }
  })
})

describe('requirePermission 中间件', () => {
  beforeEach(() => {
    clearAuthTables()
  })

  it('未认证访问返回 401 UNAUTHORIZED', async () => {
    const res = await request(app).get(probePath('users:manage'))
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('student 访问 users:manage 探针返回 403 FORBIDDEN', async () => {
    const { token } = createRealUser({ role: 'student' })
    const res = await request(app).get(probePath('users:manage')).set('x-user-token', token)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('student 访问 stats:class 探针返回 403（班级数据为教师权限）', async () => {
    const { token } = createRealUser({ role: 'student' })
    const res = await request(app).get(probePath('stats:class')).set('x-user-token', token)
    expect(res.status).toBe(403)
  })

  it('teacher 通过 logs:view 探针，被 users:manage 拒绝', async () => {
    const { token } = createRealUser({ role: 'teacher' })
    const ok = await request(app).get(probePath('logs:view')).set('x-user-token', token)
    expect(ok.status).toBe(200)
    expect(ok.body.role).toBe('teacher')
    const denied = await request(app).get(probePath('users:manage')).set('x-user-token', token)
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('FORBIDDEN')
  })

  it('admin 通过全部 9 个权限探针', async () => {
    const { token } = createRealUser({ role: 'admin' })
    for (const perm of ALL_PERMISSIONS) {
      const res = await request(app).get(probePath(perm)).set('x-user-token', token)
      expect(res.status).toBe(200)
      expect(res.body.role).toBe('admin')
    }
  })
})

describe('用户管理 API /api/admin/users', () => {
  beforeEach(() => {
    clearAuthTables()
  })

  it('student 与 teacher 访问管理端点均 403', async () => {
    for (const role of ['student', 'teacher'] as const) {
      const { token } = createRealUser({ role })
      const res = await request(app).get('/api/admin/users').set('x-user-token', token)
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
  })

  it('admin 获取用户列表：含已建用户且不含 passwordHash', async () => {
    const { token, user: adminUser } = createRealUser({ role: 'admin', username: 'boss' })
    createRealUser({ username: 'stu1', displayName: '学生一' })

    const res = await request(app).get('/api/admin/users').set('x-user-token', token)
    expect(res.status).toBe(200)
    const usernames = (res.body.items as Array<{ username: string }>).map((u) => u.username)
    expect(usernames).toContain('boss')
    expect(usernames).toContain('stu1')
    for (const item of res.body.items as Array<Record<string, unknown>>) {
      expect(item.passwordHash).toBeUndefined()
      expect(item.failedLogins).toBe(0)
    }
    const self = (res.body.items as Array<{ id: string }>).find((u) => u.id === adminUser.id)
    expect(self).toBeDefined()
  })

  it('admin 创建用户：默认 student 角色，响应 201 且不含 passwordHash', async () => {
    const { token } = createRealUser({ role: 'admin' })
    const res = await request(app)
      .post('/api/admin/users')
      .set('x-user-token', token)
      .send({ username: 'newstu', displayName: '新学生', password: 'stu-pass-1' })
    expect(res.status).toBe(201)
    expect(res.body.user.username).toBe('newstu')
    expect(res.body.user.role).toBe('student')
    expect(res.body.user.status).toBe('active')
    expect(res.body.user.passwordHash).toBeUndefined()
  })

  it('admin 创建指定 role=teacher 的用户', async () => {
    const { token } = createRealUser({ role: 'admin' })
    const res = await request(app)
      .post('/api/admin/users')
      .set('x-user-token', token)
      .send({ username: 't1', displayName: '王老师', password: 'tea-pass-1', role: 'teacher' })
    expect(res.status).toBe(201)
    expect(res.body.user.role).toBe('teacher')
  })

  it('重复用户名返回 409 USERNAME_TAKEN', async () => {
    const { token } = createRealUser({ role: 'admin' })
    createRealUser({ username: 'dup' })
    const res = await request(app)
      .post('/api/admin/users')
      .set('x-user-token', token)
      .send({ username: 'dup', displayName: '重复者', password: 'any-pass-1' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('USERNAME_TAKEN')
  })

  it('非法请求体返回 400：用户名格式 / 缺显示名 / 密码过短', async () => {
    const { token } = createRealUser({ role: 'admin' })
    const cases = [
      { username: 'x', displayName: '太短', password: 'ok-pass-1' }, // 用户名过短
      { username: 'bad name!', displayName: '非法字符', password: 'ok-pass-1' },
      { username: 'nodisp', password: 'ok-pass-1' }, // 缺显示名
      { username: 'shortpw', displayName: '密码短', password: '123' },
    ]
    for (const body of cases) {
      const res = await request(app)
        .post('/api/admin/users')
        .set('x-user-token', token)
        .send(body)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_INPUT')
    }
  })

  it('禁用用户：状态变更 + 会话即时吊销 + 登录被拒', async () => {
    const { token: adminToken } = createRealUser({ role: 'admin' })
    const { token: stuToken, user: stu } = createRealUser({ username: 'stu2', role: 'student' })

    const res = await request(app)
      .put(`/api/admin/users/${stu.id}/status`)
      .set('x-user-token', adminToken)
      .send({ status: 'disabled' })
    expect(res.status).toBe(200)
    expect(res.body.user.status).toBe('disabled')

    // 被禁用用户的旧会话立即失效
    await expectTokenValid(stuToken, false)

    // 禁用账号即使密码正确也无法登录
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'stu2', password: 'test-pass-123' })
    expect(login.status).toBe(401)
  })

  it('启用用户：清除禁用与锁定状态，可重新登录', async () => {
    const { token: adminToken } = createRealUser({ role: 'admin' })
    const { user: stu, password } = createRealUser({ username: 'stu3', role: 'student' })

    await request(app)
      .put(`/api/admin/users/${stu.id}/status`)
      .set('x-user-token', adminToken)
      .send({ status: 'disabled' })

    const res = await request(app)
      .put(`/api/admin/users/${stu.id}/status`)
      .set('x-user-token', adminToken)
      .send({ status: 'active' })
    expect(res.status).toBe(200)
    expect(res.body.user.status).toBe('active')

    const login = await request(app).post('/api/auth/login').send({ username: 'stu3', password })
    expect(login.status).toBe(200)
  })

  it('禁止管理员修改自己的状态与角色', async () => {
    const { token, user: adminUser } = createRealUser({ role: 'admin' })
    const statusRes = await request(app)
      .put(`/api/admin/users/${adminUser.id}/status`)
      .set('x-user-token', token)
      .send({ status: 'disabled' })
    expect(statusRes.status).toBe(400)

    const roleRes = await request(app)
      .put(`/api/admin/users/${adminUser.id}/role`)
      .set('x-user-token', token)
      .send({ role: 'student' })
    expect(roleRes.status).toBe(400)
  })

  it('重置密码：旧密码失效、新密码可登录、旧会话吊销', async () => {
    const { token: adminToken } = createRealUser({ role: 'admin' })
    const { token: stuToken, user: stu, password: oldPassword } = createRealUser({
      username: 'stu4',
      role: 'student',
    })

    const res = await request(app)
      .post(`/api/admin/users/${stu.id}/reset-password`)
      .set('x-user-token', adminToken)
      .send({ newPassword: 'new-pass-456' })
    expect(res.status).toBe(204)

    // 旧会话已吊销
    await expectTokenValid(stuToken, false)

    // 旧密码失效，新密码可登录
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'stu4', password: oldPassword })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'stu4', password: 'new-pass-456' })
    expect(newLogin.status).toBe(200)
  })

  it('重置密码：密码过短 400、用户不存在 404', async () => {
    const { token: adminToken } = createRealUser({ role: 'admin' })
    const { user: stu } = createRealUser({ username: 'stu5' })

    const short = await request(app)
      .post(`/api/admin/users/${stu.id}/reset-password`)
      .set('x-user-token', adminToken)
      .send({ newPassword: '123' })
    expect(short.status).toBe(400)

    const missing = await request(app)
      .post('/api/admin/users/no-such-id/reset-password')
      .set('x-user-token', adminToken)
      .send({ newPassword: 'new-pass-456' })
    expect(missing.status).toBe(404)
  })

  it('修改角色：角色更新 + 目标用户旧会话吊销（降权即时生效）', async () => {
    const { token: adminToken } = createRealUser({ role: 'admin' })
    const { token: stuToken, user: stu } = createRealUser({ username: 'stu6', role: 'student' })

    const res = await request(app)
      .put(`/api/admin/users/${stu.id}/role`)
      .set('x-user-token', adminToken)
      .send({ role: 'teacher' })
    expect(res.status).toBe(200)
    expect(res.body.user.role).toBe('teacher')

    // 改角色后旧会话吊销，需重新登录获取新角色
    await expectTokenValid(stuToken, false)
  })

  it('修改角色：非法角色 400、用户不存在 404', async () => {
    const { token: adminToken } = createRealUser({ role: 'admin' })
    const { user: stu } = createRealUser({ username: 'stu7' })

    const bad = await request(app)
      .put(`/api/admin/users/${stu.id}/role`)
      .set('x-user-token', adminToken)
      .send({ role: 'root' })
    expect(bad.status).toBe(400)

    const missing = await request(app)
      .put('/api/admin/users/no-such-id/role')
      .set('x-user-token', adminToken)
      .send({ role: 'teacher' })
    expect(missing.status).toBe(404)
  })
})
