// 认证路由：登录 / 登出 / 当前用户 / 修改密码
// 设计方案见 docs/MULTI_USER_DESIGN.md 第 1/5 节
// 安全要点：
// - 登录失败统一文案（INVALID_CREDENTIALS），避免用户名枚举
// - 连续失败 5 次锁定 15 分钟（auth.ts recordLoginFailure/isLocked）
// - 登录端点独立限流 5/min（键 = IP + 用户名，口令爆破防护，与全局 60/min 叠加）
// - 修改密码成功后吊销全部会话（全端下线），前端需重新登录
import { Router, type Request } from 'express'
import rateLimit from 'express-rate-limit'
import {
  authMiddleware,
  changeUserPassword,
  createSession,
  deleteSession,
  deleteSessionById,
  deleteUserSessions,
  findUserByUsername,
  getSessionUser,
  isLocked,
  listUserSessions,
  lockedRemainingSec,
  MIN_PASSWORD_LENGTH,
  recordLoginFailure,
  resetLoginFailures,
  verifyPassword,
} from './auth.js'
import { logOperation, AUDIT_ACTIONS } from './audit.js'

// 登录端点专用限流：5 次/分钟（键 = IP + 用户名）
// 测试环境跳过：锁定逻辑测试需要连续发起失败登录；限流中间件本身的正确性由
// rateLimit.test.ts 的既有模式覆盖（独立 app 挂载自定义 limiter）
// 同一出口 IP（机房/NAT）下不同学生的登录尝试互不影响；
// 反向代理部署需设置 TRUST_PROXY，req.ip 才是真实客户端地址
export function loginLimiterKey(req: Request): string {
  const body = req.body as { username?: unknown } | undefined
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ''
  return `${req.ip}|${username}`
}

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginLimiterKey,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many login attempts, please try again later' },
    })
  },
})

export const authRouter = Router()

// POST /api/auth/login — 账号密码登录，返回会话令牌与用户信息
authRouter.post('/login', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const { username, password } = body
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username.trim() ||
    !password
  ) {
    return res
      .status(400)
      .json({ error: { code: 'INVALID_INPUT', message: '用户名与密码必填' } })
  }

  const user = findUserByUsername(username.trim())
  // 统一 401 文案，避免通过响应差异枚举用户名是否存在
  const invalid = () =>
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } })

  // 审计：登录失败（用户不存在 / 被禁用 / 密码错误；统一 result=failed）
  const auditLoginFailed = (target: { id?: string; username: string }) =>
    logOperation({
      userId: target.id ?? null,
      username: target.username,
      action: AUDIT_ACTIONS.authLoginFailed,
      result: 'failed',
      ip: req.ip,
    })

  if (!user || user.status !== 'active') {
    auditLoginFailed({ username: username.trim() })
    return invalid()
  }
  if (isLocked(user)) {
    logOperation({
      userId: user.id,
      username: user.username,
      action: AUDIT_ACTIONS.authLocked,
      result: 'denied',
      ip: req.ip,
    })
    return res.status(403).json({
      error: {
        code: 'ACCOUNT_LOCKED',
        message: `失败次数过多，账号已锁定，请 ${lockedRemainingSec(user)} 秒后重试`,
      },
    })
  }
  if (!verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(user)
    auditLoginFailed({ id: user.id, username: user.username })
    return invalid()
  }

  resetLoginFailures(user.id)
  const token = createSession(user.id, req.ip, req.get('user-agent'))
  logOperation({
    userId: user.id,
    username: user.username,
    action: AUDIT_ACTIONS.authLoginSuccess,
    ip: req.ip,
  })
  return res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  })
})

// POST /api/auth/logout — 吊销当前会话（幂等，无效令牌同样返回 204）
authRouter.post('/logout', (req, res) => {
  const token = req.get('x-user-token')
  if (token) {
    // 先解析用户身份再吊销（审计需要 userId；无效令牌解析为 null，跳过审计）
    const user = getSessionUser(token)
    deleteSession(token)
    if (user) {
      logOperation({
        userId: user.id,
        username: user.username,
        action: AUDIT_ACTIONS.authLogout,
        ip: req.ip,
      })
    }
  }
  res.status(204).end()
})

// GET /api/auth/me — 返回当前登录用户（会话有效性探针）
authRouter.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user })
})

// ===== 会话管理：我的设备 / 全端下线 / 移除单个设备 =====
// 安全要点：
// - 仅操作当前登录用户自己的会话（listUserSessions / deleteSessionForUser 均按 userId 限定）
// - 响应绝不返回完整令牌，仅返回脱敏指纹（前 8 + 尾 4）
// - 全端下线 / 移除设备均记审计日志

// GET /api/auth/sessions — 当前用户的全部有效会话（我的设备列表）
authRouter.get('/sessions', authMiddleware, (req, res) => {
  const token = req.get('x-user-token') ?? null
  const items = listUserSessions(req.user!.id, token)
  res.json({ items })
})

// DELETE /api/auth/sessions/:id — 移除单个设备（吊销指定会话）
// :id 为 GET /sessions 返回的 sessionId（数据库 rowid），与 userId 联合限定，防越权
authRouter.delete('/sessions/:id', authMiddleware, (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: { code: 'INVALID_INPUT', message: '无效的会话标识' },
    })
  }
  const ok = deleteSessionById(req.user!.id, id)
  logOperation({
    userId: req.user!.id,
    username: req.user!.username,
    action: AUDIT_ACTIONS.authRevokeSession,
    resource: 'session',
    resourceId: String(id),
    result: ok ? 'success' : 'failed',
    ip: req.ip,
  })
  if (!ok) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: '会话不存在或已过期' },
    })
  }
  return res.status(204).end()
})

// DELETE /api/auth/sessions — 全端下线（吊销当前用户全部会话）
authRouter.delete('/sessions', authMiddleware, (req, res) => {
  const userId = req.user!.id
  deleteUserSessions(userId)
  logOperation({
    userId,
    username: req.user!.username,
    action: AUDIT_ACTIONS.authLogoutAll,
    ip: req.ip,
  })
  res.status(204).end()
})

// POST /api/auth/change-password — 修改密码；成功后吊销全部会话（全端下线）
authRouter.post('/change-password', authMiddleware, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const { oldPassword, newPassword } = body
  if (
    typeof oldPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    newPassword.length < MIN_PASSWORD_LENGTH
  ) {
    return res.status(400).json({
      error: { code: 'INVALID_INPUT', message: `新密码至少 ${MIN_PASSWORD_LENGTH} 位` },
    })
  }
  const ok = changeUserPassword(req.user!.id, oldPassword, newPassword)
  if (!ok) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: '原密码错误' } })
  }
  // 审计：自助修改密码（成功后全端下线，P2）
  logOperation({
    userId: req.user!.id,
    username: req.user!.username,
    action: AUDIT_ACTIONS.authChangePassword,
    ip: req.ip,
  })
  return res.status(204).end()
})
