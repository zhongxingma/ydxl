// 用户管理路由：列表 / 创建 / 禁用启用 / 重置密码 / 改角色
//
// 安全要点（docs/MULTI_USER_DESIGN.md 第 3 节）：
// - 只提供「禁用」不提供「删除」（软删除，保留学习数据与审计可追溯）
// - 禁用 / 重置密码 / 改角色均吊销目标用户全部会话（即时生效）
// - 禁止管理员对自己禁用或改角色（防止误锁死最后的管理员）
// - 响应绝不包含 passwordHash
import type { Router } from 'express'
import { createUser, deleteUserSessions, hashPassword, MIN_PASSWORD_LENGTH } from './auth.js'
import { db } from './db.js'
import { logOperation, AUDIT_ACTIONS } from './audit.js'

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{2,32}$/
const MAX_DISPLAY_NAME = 64
const VALID_ROLES = new Set(['admin', 'teacher', 'student'])
const VALID_STATUS = new Set(['active', 'disabled'])

interface AdminUserRow {
  id: string
  username: string
  displayName: string
  role: string
  status: string
  failedLogins: number | null
  lockedUntil: number | null
  createdAt: number | null
  updated_at: number | null
}

// 响应字段白名单（passwordHash 永不外泄）
function toPublicUser(row: AdminUserRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    failedLogins: row.failedLogins ?? 0,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
  }
}

function parseBody(req: { body: unknown }): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
}

export function registerAdminUserRoutes(router: Router): void {
  // GET /api/admin/users — 用户列表（管理页加载）
  router.get('/users', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM users ORDER BY createdAt ASC')
      .all() as AdminUserRow[]
    res.json({ items: rows.map(toPublicUser) })
  })

  // POST /api/admin/users — 创建用户（用户名冲突返回 409）
  router.post('/users', (req, res) => {
    const body = parseBody(req)
    const { username, displayName, password, role } = body

    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim())) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: '用户名需为 2-32 位字母、数字或下划线' },
      })
    }
    if (
      typeof displayName !== 'string' ||
      !displayName.trim() ||
      displayName.trim().length > MAX_DISPLAY_NAME
    ) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: `显示名必填且不超过 ${MAX_DISPLAY_NAME} 字符` },
      })
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: `密码至少 ${MIN_PASSWORD_LENGTH} 位` },
      })
    }
    const targetRole = typeof role === 'string' && VALID_ROLES.has(role) ? role : 'student'

    let user
    try {
      user = createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role: targetRole,
      })
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: { code: 'USERNAME_TAKEN', message: '用户名已被占用' },
        })
      }
      throw err
    }

    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.userCreate,
      resource: 'users',
      resourceId: user.id,
      detail: { username: user.username, displayName: user.displayName, role: user.role },
      ip: req.ip,
    })

    return res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: 'active',
      },
    })
  })

  // PUT /api/admin/users/:id/status — 禁用 / 启用（禁用即时吊销全部会话）
  router.put('/users/:id/status', (req, res) => {
    const { status } = parseBody(req)
    if (typeof status !== 'string' || !VALID_STATUS.has(status)) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'status 必须为 active 或 disabled' },
      })
    }
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | AdminUserRow
      | undefined
    if (!target) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '用户不存在' } })
    }
    if (target.id === req.user!.id) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: '不能修改自己的账号状态' },
      })
    }

    const now = Date.now()
    if (status === 'disabled') {
      // 禁用：会话即时失效（status 检查 + 显式吊销双保险）
      db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(
        'disabled',
        now,
        target.id,
      )
      deleteUserSessions(target.id)
    } else {
      // 启用：同时清除登录失败计数与锁定状态（避免禁用期间遗留的锁定）
      db.prepare(
        'UPDATE users SET status = ?, failedLogins = 0, lockedUntil = NULL, updated_at = ? WHERE id = ?',
      ).run('active', now, target.id)
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as AdminUserRow

    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: status === 'disabled' ? AUDIT_ACTIONS.userDisable : AUDIT_ACTIONS.userEnable,
      resource: 'users',
      resourceId: target.id,
      detail: { username: target.username, status },
      ip: req.ip,
    })

    return res.json({ user: toPublicUser(updated) })
  })

  // POST /api/admin/users/:id/reset-password — 重置密码（成功后目标用户全端下线）
  router.post('/users/:id/reset-password', (req, res) => {
    const body = parseBody(req)
    const { newPassword } = body
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: `新密码至少 ${MIN_PASSWORD_LENGTH} 位` },
      })
    }
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | AdminUserRow
      | undefined
    if (!target) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '用户不存在' } })
    }

    // 复用 auth.ts 的哈希实现，避免两处维护 scrypt 参数
    db.prepare('UPDATE users SET passwordHash = ?, failedLogins = 0, lockedUntil = NULL, updated_at = ? WHERE id = ?').run(
      hashPassword(newPassword),
      Date.now(),
      target.id,
    )
    deleteUserSessions(target.id)

    // 审计：重置密码（不记录密码本身）
    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.userResetPassword,
      resource: 'users',
      resourceId: target.id,
      detail: { username: target.username },
      ip: req.ip,
    })

    return res.status(204).end()
  })

  // PUT /api/admin/users/:id/role — 修改角色（不能修改自己的角色）
  router.put('/users/:id/role', (req, res) => {
    const body = parseBody(req)
    const { role } = body
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'role 必须为 admin / teacher / student' },
      })
    }
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | AdminUserRow
      | undefined
    if (!target) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '用户不存在' } })
    }
    if (target.id === req.user!.id) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: '不能修改自己的角色' },
      })
    }

    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, Date.now(), target.id)
    // 角色变更即时生效：吊销目标用户全部会话，防止降权后旧会话仍持有原权限
    deleteUserSessions(target.id)
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as AdminUserRow

    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.userChangeRole,
      resource: 'users',
      resourceId: target.id,
      detail: { username: target.username, from: target.role, to: role },
      ip: req.ip,
    })

    return res.json({ user: toPublicUser(updated) })
  })
}
