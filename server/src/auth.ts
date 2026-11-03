// 认证核心模块
// - 密码哈希：Node 内置 scrypt（N=16384,r=8,p=1），零新增依赖，格式 scrypt$N$saltHex$hashHex
// - 会话：不透明令牌（256 位随机）存 sessions 表，滑动过期（7 天），可即时吊销
// - 认证中间件：解析 x-user-token 头 → 挂载 req.user；未认证统一 401
// 取舍说明见 docs/MULTI_USER_DESIGN.md 第 1/5 节
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type express from 'express'
import { db } from './db.js'

// 认证用户信息（挂载到 req.user，绝不包含 passwordHash）
export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: string
}

// Express 类型扩展：认证中间件之后 req.user 可用
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express 官方推荐的请求扩展方式
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

// ===== 密码哈希（scrypt） =====
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32
const HASH_PREFIX = 'scrypt'

/** 密码最小长度（登录/改密/建用户统一校验） */
export const MIN_PASSWORD_LENGTH = 6

/** 生成 scrypt 密码哈希，格式：scrypt$N$saltHex$hashHex */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `${HASH_PREFIX}$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** 校验密码与存储的哈希（timingSafeEqual 防时序侧信道） */
export function verifyPassword(password: string, stored: string): boolean {
  const [prefix, nStr, saltHex, hashHex] = stored.split('$')
  if (prefix !== HASH_PREFIX || !nStr || !saltHex || !hashHex) return false
  const n = parseInt(nStr, 10)
  if (!Number.isFinite(n) || n <= 0) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length, { N: n, r: SCRYPT_R, p: SCRYPT_P })
  return timingSafeEqual(actual, expected)
}

// ===== 用户 =====
interface UserRow {
  id: string
  username: string
  displayName: string
  passwordHash: string
  role: string
  status: string
  failedLogins: number | null
  lockedUntil: number | null
}

/** 按用户名查找用户（含 passwordHash，仅服务端内部使用） */
export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
}

/** 创建用户（迁移脚本 / 用户管理共用）。用户名冲突抛 UNIQUE 约束错误 */
export function createUser(input: {
  username: string
  displayName: string
  password: string
  role?: string
}): AuthUser {
  const now = Date.now()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, displayName, passwordHash, role, status, failedLogins, createdAt, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
  ).run(id, input.username, input.displayName, hashPassword(input.password), input.role ?? 'student', now, now)
  return { id, username: input.username, displayName: input.displayName, role: input.role ?? 'student' }
}

// ===== 登录锁定（连续失败 5 次锁 15 分钟） =====
const MAX_FAILED_LOGINS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

/** 账号是否处于锁定期 */
export function isLocked(user: UserRow): boolean {
  return typeof user.lockedUntil === 'number' && user.lockedUntil > Date.now()
}

/** 锁定期剩余秒数（用于错误提示） */
export function lockedRemainingSec(user: UserRow): number {
  return Math.max(0, Math.ceil(((user.lockedUntil ?? 0) - Date.now()) / 1000))
}

/** 记录一次登录失败；达到阈值时写入锁定期止时间 */
export function recordLoginFailure(user: UserRow): void {
  const failures = (user.failedLogins ?? 0) + 1
  const lockedUntil = failures >= MAX_FAILED_LOGINS ? Date.now() + LOCK_DURATION_MS : null
  db.prepare('UPDATE users SET failedLogins = ?, lockedUntil = ? WHERE id = ?').run(
    failures,
    lockedUntil,
    user.id,
  )
}

/** 登录成功：清零失败计数与锁定状态 */
export function resetLoginFailures(userId: string): void {
  db.prepare('UPDATE users SET failedLogins = 0, lockedUntil = NULL WHERE id = ?').run(userId)
}

/** 修改密码：校验旧密码 → 更新哈希 → 吊销该用户全部会话（全端下线） */
export function changeUserPassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
): boolean {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
  if (!row || !verifyPassword(oldPassword, row.passwordHash)) return false
  db.prepare('UPDATE users SET passwordHash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    Date.now(),
    userId,
  )
  deleteUserSessions(userId)
  return true
}

// ===== 会话 =====
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
// 剩余有效期不足一半时才顺延，避免每个请求都写库
const SESSION_EXTEND_THRESHOLD_MS = SESSION_TTL_MS / 2

/** 创建会话，返回不透明令牌（256 位随机 hex） */
export function createSession(userId: string, ip?: string, userAgent?: string): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (token, userId, createdAt, expiresAt, ip, userAgent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(token, userId, now, now + SESSION_TTL_MS, ip ?? null, userAgent ?? null)
  return token
}

/**
 * 按令牌解析会话用户：会话不存在 / 已过期 / 用户被禁用均返回 null
 * 滑动过期：剩余有效期不足一半时顺延至 7 天
 */
export function getSessionUser(token: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT s.token AS token, s.expiresAt AS expiresAt, u.id AS id, u.username AS username,
              u.displayName AS displayName, u.role AS role, u.status AS status
       FROM sessions s JOIN users u ON u.id = s.userId WHERE s.token = ?`,
    )
    .get(token) as
    | { token: string; expiresAt: number; id: string; username: string; displayName: string; role: string; status: string }
    | undefined
  if (!row) return null
  const now = Date.now()
  if (row.expiresAt <= now || row.status !== 'active') {
    // 过期会话顺手清理；禁用用户的会话立即吊销
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  if (row.expiresAt - now < SESSION_EXTEND_THRESHOLD_MS) {
    db.prepare('UPDATE sessions SET expiresAt = ? WHERE token = ?').run(now + SESSION_TTL_MS, token)
  }
  return { id: row.id, username: row.username, displayName: row.displayName, role: row.role }
}

/** 吊销单个会话（登出） */
export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/** 吊销用户全部会话（改密 / 禁用账号） */
export function deleteUserSessions(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId)
}

// 会话视图行（会话管理页「我的设备」用）：仅暴露脱敏后的展示字段，绝不返回令牌本身
export interface SessionRow {
  // 会话内部标识（数据库 rowid，单调递增整数）：前端移除设备时作为路径参数
  sessionId: number
  // 展示用脱敏指纹（令牌前 8 位 + 尾 4 位），供用户辨识设备，不足以还原完整令牌
  tokenFingerprint: string
  ip: string | null
  userAgent: string | null
  createdAt: number | null
  expiresAt: number | null
  // 是否当前发起请求的设备（令牌匹配）
  current: boolean
}

/**
 * 列出某用户的全部有效会话（按创建时间倒序）。
 * currentToken 命中时对应行 current=true，供前端标记「当前设备」。
 * 返回前顺带清理该用户已过期会话（惰性回收，避免 sessions 表无限增长）。
 */
export function listUserSessions(userId: string, currentToken: string | null): SessionRow[] {
  const now = Date.now()
  db.prepare('DELETE FROM sessions WHERE userId = ? AND expiresAt <= ?').run(userId, now)
  const rows = db
    .prepare(
      `SELECT rowid AS rowid, token, ip, userAgent, createdAt, expiresAt
       FROM sessions WHERE userId = ? AND expiresAt > ?
       ORDER BY createdAt DESC`,
    )
    .all(userId, now) as Array<{
    rowid: number
    token: string
    ip: string | null
    userAgent: string | null
    createdAt: number
    expiresAt: number
  }>
  return rows.map((r) => ({
    sessionId: r.rowid,
    tokenFingerprint: `${r.token.slice(0, 8)}…${r.token.slice(-4)}`,
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    current: currentToken !== null && r.token === currentToken,
  }))
}

/**
 * 按 rowid 吊销指定用户的单个会话（仅限该用户自己的会话，防越权）。
 * 仅当 rowid 存在且属于该用户时删除，返回是否实际删除了一行。
 */
export function deleteSessionById(userId: string, rowid: number): boolean {
  const result = db
    .prepare('DELETE FROM sessions WHERE rowid = ? AND userId = ?')
    .run(rowid, userId)
  return result.changes > 0
}

// ===== 认证中间件 =====
/**
 * 解析 x-user-token 头 → 挂载 req.user；未认证统一 401
 * 挂载范围：/api 下除 /api/auth/* 与 /api/health 外的全部端点（见 index.ts）
 */
export const authMiddleware: express.RequestHandler = (req, res, next) => {
  const token = req.get('x-user-token')
  const user = token ? getSessionUser(token) : null
  if (!user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    })
    return
  }
  req.user = user
  next()
}
