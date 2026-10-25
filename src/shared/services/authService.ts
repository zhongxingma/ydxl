// 认证服务
// - 会话令牌存 sessionStorage（关标签即失效，公用电脑场景更安全，见设计文档 5.3 取舍）
// - 令牌永不写入 localStorage，避免跨标签持久化窃取
// - 登录时检测本地缓存归属：换账号登录先清空上个账号的 Dexie 业务缓存（防串号泄露）
// - 登出清空本地业务缓存并吊销服务端会话
import { db } from './db'
import { clearAIUsage } from './ai/aiUsageTracker'

// 当前登录用户信息（与后端 AuthUser 一致，不含任何凭证）
export interface CurrentUser {
  id: string
  username: string
  displayName: string
  role: string
}

const TOKEN_KEY = 'ydxl-auth-token'
const USER_KEY = 'ydxl-auth-user'
// 本地 Dexie 缓存归属标记（localStorage）：记录缓存属于哪个用户，换账号时清空
const CACHE_OWNER_KEY = 'ydxl-cache-owner'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'

/** 读取当前会话令牌（sessionStorage，标签页关闭即失效） */
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** 读取当前登录用户（未登录返回 null） */
export function getCurrentUser(): CurrentUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as CurrentUser) : null
  } catch {
    return null
  }
}

function setSession(token: string, user: CurrentUser): void {
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
}

/** 清除本地会话（令牌 + 用户信息） */
export function clearSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
  } catch {
    // sessionStorage 不可用（隐私模式极端场景）：忽略，后续请求 401 会自然跳登录
  }
}

/**
 * 为同源 API 请求构造认证头
 * 仅用于发往本服务 /api 的请求；第三方 AI 端点直连禁止使用（防止令牌泄露）
 */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { 'x-user-token': token } : {}
}

/**
 * 判断 URL 是否为本服务 API（相对路径或同源绝对地址）
 * baseProvider 据此决定是否附带会话令牌
 */
export function isInternalApiUrl(url: string): boolean {
  if (url.startsWith('/')) return true
  if (typeof window !== 'undefined' && window.location?.origin) {
    return url.startsWith(window.location.origin)
  }
  return false
}

/** 清空 Dexie 中全部业务表与 AI 缓存/用量（共享电脑换号时不泄露上一账号行为数据） */
async function clearLocalUserData(): Promise<void> {
  clearAIUsage()
  await Promise.allSettled([
    db.articles.clear(),
    db.questions.clear(),
    db.words.clear(),
    db.reviews.clear(),
    db.stats.clear(),
    db.readingSessions.clear(),
    db.achievements.clear(),
    db.aiCache.clear(),
  ])
}

/**
 * 登录：校验成功后将令牌与用户信息写入 sessionStorage
 * 换账号登录时先清空上个账号的本地业务缓存（防止公用电脑串号泄露）
 * @throws Error 登录失败（401 用户名或密码错误 / 403 账号锁定 / 网络错误）
 */
export async function login(username: string, password: string): Promise<CurrentUser> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch (err) {
    throw new Error(`登录请求失败: ${err instanceof Error ? err.message : String(err)}`)
  }
  const body = (await response.json().catch(() => ({}))) as {
    token?: string
    user?: CurrentUser
    error?: { code?: string; message?: string }
  }
  if (!response.ok || !body.token || !body.user) {
    throw new Error(body.error?.message ?? `登录失败（${response.status}）`)
  }

  // 缓存归属检查：本地缓存属于其他账号时先清空，避免上个账号的数据泄露给新账号
  try {
    const prevOwner = localStorage.getItem(CACHE_OWNER_KEY)
    if (prevOwner && prevOwner !== body.user.id) {
      await clearLocalUserData()
    }
    localStorage.setItem(CACHE_OWNER_KEY, body.user.id)
  } catch (err) {
    console.warn('[authService] 本地缓存归属检查失败（不影响登录）', err)
  }

  setSession(body.token, body.user)
  return body.user
}

/**
 * 登出：吊销服务端会话（best-effort）→ 清除本地会话 → 清空本地业务缓存
 * 调用方负责跳转登录页（本函数不依赖路由，可在任意位置调用）
 */
export async function logout(): Promise<void> {
  const token = getToken()
  if (token) {
    try {
      await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'x-user-token': token },
      })
    } catch (err) {
      // 服务器不可达时仍继续本地清理（会话 7 天后自然过期）
      console.warn('[authService] 服务端会话吊销失败（继续本地登出）', err)
    }
  }
  clearSession()
  try {
    localStorage.removeItem(CACHE_OWNER_KEY)
  } catch {
    // 忽略
  }
  await clearLocalUserData()
}

// ===== 会话管理：我的设备 / 移除设备 / 全端下线 =====

/** 会话视图行（与后端 SessionRow 一致，不含完整令牌） */
export interface SessionInfo {
  // 会话内部标识（数据库 rowid），移除设备时作为路径参数
  sessionId: number
  // 脱敏指纹（前 8 + 尾 4），供用户辨识设备
  tokenFingerprint: string
  ip: string | null
  userAgent: string | null
  createdAt: number | null
  expiresAt: number | null
  // 是否当前发起请求的设备
  current: boolean
}

/** 列出当前用户的全部有效会话（我的设备） */
export async function listSessions(): Promise<SessionInfo[]> {
  const response = await fetch(`${baseUrl}/auth/sessions`, { headers: authHeaders() })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `获取登录设备失败（${response.status}）`)
  }
  const body = (await response.json()) as { items: SessionInfo[] }
  return body.items
}

/** 移除单个登录设备（吊销指定会话） */
export async function revokeSession(sessionId: number): Promise<void> {
  const response = await fetch(`${baseUrl}/auth/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `移除设备失败（${response.status}）`)
  }
}

/**
 * 全端下线：吊销当前用户全部会话（含本设备）
 * 成功后清除本地会话；调用方负责跳转登录页
 */
export async function logoutAll(): Promise<void> {
  const token = getToken()
  const response = await fetch(`${baseUrl}/auth/sessions`, {
    method: 'DELETE',
    headers: token ? { 'x-user-token': token } : {},
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `全端下线失败（${response.status}）`)
  }
  clearSession()
  try {
    localStorage.removeItem(CACHE_OWNER_KEY)
  } catch {
    // 忽略
  }
  await clearLocalUserData()
}

/** 修改密码（成功后服务端吊销全部会话，调用方应跳转登录页重新登录） */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(`${baseUrl}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ oldPassword, newPassword }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(body.error?.message ?? `修改密码失败（${response.status}）`)
  }
}
