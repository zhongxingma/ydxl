// 用户管理 API 服务（多用户，RBAC）
// 仅 admin 角色可用（服务端 requirePermission('users:manage') 强制，前端仅作体验层）
// 401 会话失效：清除本地会话并广播 ydxl:unauthorized（与 localApi 行为一致）
import { authHeaders, clearSession } from './authService'

// 用户管理条目（服务端 toPublicUser 响应，绝不含 passwordHash）
export interface AdminUser {
  id: string
  username: string
  displayName: string
  role: string
  status: string
  failedLogins: number
  lockedUntil: number | null
  createdAt: number | null
}

export type UserRole = 'admin' | 'teacher' | 'student'

export interface CreateUserInput {
  username: string
  displayName: string
  password: string
  role: UserRole
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'

function notifyUnauthorized(): void {
  clearSession()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ydxl:unauthorized'))
  }
}

/** 统一请求与错误解析：401 清会话广播、403 提示无权限、其余抛出服务端 message */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/admin${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      ...init,
    })
  } catch (err) {
    throw new Error(`网络错误: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (response.status === 401) {
    notifyUnauthorized()
    throw new Error('会话已失效，请重新登录')
  }
  if (response.status === 204) return undefined as T
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    const message =
      response.status === 403 ? '无权限执行该操作' : (body.error?.message ?? `请求失败（${response.status}）`)
    throw new Error(message)
  }
  return body as T
}

/** 用户列表（按创建时间升序） */
export async function listUsers(): Promise<AdminUser[]> {
  const body = await request<{ items: AdminUser[] }>('/users')
  return body.items
}

/** 创建用户（用户名冲突抛 409 文案） */
export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const body = await request<{ user: AdminUser }>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return body.user
}

/** 禁用 / 启用（禁用即时吊销目标用户全部会话） */
export async function setUserStatus(id: string, status: 'active' | 'disabled'): Promise<AdminUser> {
  const body = await request<{ user: AdminUser }>(`/users/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
  return body.user
}

/** 重置密码（成功后目标用户全端下线） */
export async function resetPassword(id: string, newPassword: string): Promise<void> {
  await request<void>(`/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  })
}

/** 修改角色（目标用户旧会话吊销，需重新登录） */
export async function setUserRole(id: string, role: UserRole): Promise<AdminUser> {
  const body = await request<{ user: AdminUser }>(`/users/${id}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
  return body.user
}

// ===== 审计日志（logs:view：admin 与 teacher） =====

export interface AuditLogEntry {
  id: string
  userId: string | null
  username: string | null
  action: string
  resource: string | null
  resourceId: string | null
  result: string
  detail: string | null
  ip: string | null
  createdAt: number | null
}

export interface AuditLogFilter {
  userId?: string
  action?: string
  from?: number
  to?: number
  limit?: number
  offset?: number
}

/** 过滤条件 → query string（忽略空值） */
function buildAuditQuery(filter: AuditLogFilter): string {
  const params = new URLSearchParams()
  if (filter.userId) params.set('userId', filter.userId)
  if (filter.action) params.set('action', filter.action)
  if (filter.from !== undefined) params.set('from', String(filter.from))
  if (filter.to !== undefined) params.set('to', String(filter.to))
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  if (filter.offset !== undefined) params.set('offset', String(filter.offset))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** 分页查询审计日志（createdAt 倒序） */
export async function listAuditLogs(
  filter: AuditLogFilter = {},
): Promise<{ items: AuditLogEntry[]; total: number; limit: number; offset: number }> {
  return request(`/logs${buildAuditQuery(filter)}`)
}

/** 导出审计日志 CSV 并触发浏览器下载（带会话令牌，不能用 <a href> 直链） */
export async function exportAuditLogs(filter: AuditLogFilter = {}): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/admin/logs/export${buildAuditQuery(filter)}`, {
      headers: authHeaders(),
    })
  } catch (err) {
    throw new Error(`网络错误: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (response.status === 401) {
    notifyUnauthorized()
    throw new Error('会话已失效，请重新登录')
  }
  if (!response.ok) {
    throw new Error(response.status === 403 ? '无权限执行该操作' : `导出失败（${response.status}）`)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ===== 班级学情聚合（stats:class：admin 与 teacher） =====

export interface ClassStudentStat {
  userId: string
  username: string
  displayName: string
  articlesRead: number
  wordsLearned: number
  wordsReviewed: number
  wordsMastered: number
  activeDays: number
  streak: number
  lastActiveDate: string | null
  correctRate: number
}

export interface ClassStatsSummary {
  studentCount: number
  activeStudentCount: number
  totalArticlesRead: number
  totalWordsLearned: number
  totalWordsReviewed: number
  avgArticlesRead: number
  avgCorrectRate: number
  totalReadingDurationSec: number
  totalSessions: number
}

export interface ClassStatsResult {
  days: number
  from: string
  to: string
  summary: ClassStatsSummary
  students: ClassStudentStat[]
}

/** 班级学情聚合（只读；服务端会记录本次查询） */
export async function getClassStats(days: number): Promise<ClassStatsResult> {
  return request(`/class-stats?days=${encodeURIComponent(String(days))}`)
}

// ===== AI 成本与用量（logs:view：admin 与 teacher） =====

export interface AiCostBucket {
  tokens: number
  costCny: number
  calls: number
}

export interface AiCostDaily extends AiCostBucket {
  date: string
}

export interface AiCostByModel extends AiCostBucket {
  model: string
  provider: string
}

export interface AiCostByUser extends AiCostBucket {
  userId: string
  username: string | null
}

export interface AiCostReport {
  days: number
  from: string
  to: string
  totals: {
    today: AiCostBucket
    month: AiCostBucket
    window: AiCostBucket
  }
  budgets: {
    daily: number
    monthly: number
  }
  daily: AiCostDaily[]
  byModel: AiCostByModel[]
  byUser: AiCostByUser[]
}

/** AI 成本与用量聚合（只读；服务端会记录本次查询） */
export async function getAiUsageReport(days: number): Promise<AiCostReport> {
  return request(`/ai-usage?days=${encodeURIComponent(String(days))}`)
}
