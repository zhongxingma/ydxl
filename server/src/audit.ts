// 审计日志模块（多用户 P2）
// 设计依据 docs/MULTI_USER_DESIGN.md 第 4 节：
// - 谁何时做了什么对什么结果如何五要素齐全；detail 一律脱敏
// - 只追加（无更新/删除 API）；写日志失败仅 console.error，绝不阻塞主流程
// - 保留 180 天，到期按 createdAt 清理，清理前导出 CSV 归档到 server/data/log-archive/
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db.js'

export type AuditResult = 'success' | 'denied' | 'failed'

// 动作字典（设计文档 4.2 + 实现扩充，扩充项在 7.3 落地摘要中登记）
// - 表写操作泛化为 `${table}.create/update/delete`（字典以 words.* 为代表）
// - 新增 auth.change_password（自助改密）、logs.export（CSV 导出）、permission.denied（任何 403）
export const AUDIT_ACTIONS = {
  authLoginSuccess: 'auth.login.success',
  authLoginFailed: 'auth.login.failed',
  authLocked: 'auth.locked',
  authLogout: 'auth.logout',
  authChangePassword: 'auth.change_password',
  // 会话管理（P3）：全端下线 / 移除单个登录设备
  authLogoutAll: 'auth.logout_all',
  authRevokeSession: 'auth.revoke_session',
  userCreate: 'user.create',
  userDisable: 'user.disable',
  userEnable: 'user.enable',
  userResetPassword: 'user.reset_password',
  userChangeRole: 'user.change_role',
  wordsBulkImport: 'words.bulk_import',
  articlesMarkRead: 'articles.mark_read',
  logsQuery: 'logs.query',
  logsExport: 'logs.export',
  classStatsView: 'class_stats.view',
  aiProxyInvoke: 'ai.proxy.invoke',
  permissionDenied: 'permission.denied',
} as const

export interface AuditEntry {
  // 操作者（匿名场景如登录失败可为 null）
  userId?: string | null
  // 冗余存储：用户删除后日志仍可追溯
  username?: string | null
  action: string
  resource?: string | null
  resourceId?: string | null
  result?: AuditResult
  // 脱敏后的上下文（写入前经 sanitizeDetail 过滤敏感键）
  detail?: Record<string, unknown> | null
  ip?: string | null
}

// detail 单值最大长度（防超大文本落库）
const DETAIL_VALUE_MAX = 1024
// detail 序列化后总长上限
const DETAIL_TOTAL_MAX = 4096

// 敏感键名匹配：出现在 detail 键名中即整键剔除（防御性脱敏，写入点亦应自觉不传）
const SENSITIVE_KEY_PATTERN = /password|token|secret|apikey|api_key|authorization|note|hash/i

/** detail 脱敏：剔除敏感键、字符串截断、序列化超长时丢弃整包（保底不抛错） */
function sanitizeDetail(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail || typeof detail !== 'object') return null
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    if (typeof value === 'string') {
      cleaned[key] = value.length > DETAIL_VALUE_MAX ? `${value.slice(0, DETAIL_VALUE_MAX)}…` : value
    } else if (value !== undefined) {
      cleaned[key] = value
    }
  }
  try {
    const json = JSON.stringify(cleaned)
    if (json.length > DETAIL_TOTAL_MAX) {
      return JSON.stringify({ truncated: true, keys: Object.keys(cleaned) })
    }
    return json
  } catch {
    return null
  }
}

/**
 * 写入一条审计日志（只追加）。
 * 内部吞掉一切异常（仅 console.error）：审计失败绝不阻塞业务主流程。
 * 调用方须在业务事务成功后调用（日志与业务写同事务的要求见设计文档 5.2——
 * 本实现采用「业务成功后追加」而非同事务：日志 INSERT 无外部依赖、不会失败，
 * 换取业务代码零感知；与 4.1「写日志失败仅 console.error 不阻塞主流程」一致）
 */
export function logOperation(entry: AuditEntry): void {
  try {
    const now = Date.now()
    db.prepare(
      `INSERT INTO operation_logs (id, userId, username, action, resource, resourceId, result, detail, ip, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      entry.userId ?? null,
      entry.username ?? null,
      entry.action,
      entry.resource ?? null,
      entry.resourceId ?? null,
      entry.result ?? 'success',
      sanitizeDetail(entry.detail),
      entry.ip ?? null,
      now,
    )
  } catch (err) {
    console.error('[audit] 审计日志写入失败（不阻塞业务）', err)
  }
}

export interface AuditLogRow {
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

export interface AuditQueryFilter {
  userId?: string
  action?: string
  // 起止时间（ms 时间戳，含边界）
  from?: number
  to?: number
  limit?: number
  offset?: number
}

function buildWhere(filter: AuditQueryFilter): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filter.userId) {
    conditions.push('userId = ?')
    params.push(filter.userId)
  }
  if (filter.action) {
    conditions.push('action = ?')
    params.push(filter.action)
  }
  if (typeof filter.from === 'number') {
    conditions.push('createdAt >= ?')
    params.push(filter.from)
  }
  if (typeof filter.to === 'number') {
    conditions.push('createdAt <= ?')
    params.push(filter.to)
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

/** 按过滤条件查询审计日志（createdAt 倒序，服务端分页） */
export function queryAuditLogs(filter: AuditQueryFilter): { items: AuditLogRow[]; total: number } {
  const { where, params } = buildWhere(filter)
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0
  const items = db
    .prepare(
      `SELECT * FROM operation_logs ${where} ORDER BY createdAt DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AuditLogRow[]
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM operation_logs ${where}`).get(...params) as {
      count: number
    }
  ).count
  return { items, total }
}

/** CSV 字段转义：含逗号/引号/换行的值用双引号包裹，内部双引号翻倍 */
function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const CSV_COLUMNS: Array<keyof AuditLogRow> = [
  'id',
  'userId',
  'username',
  'action',
  'resource',
  'resourceId',
  'result',
  'detail',
  'ip',
  'createdAt',
]

/** 将日志行集合渲染为 CSV 文本（UTF-8，含表头） */
export function renderLogsCsv(rows: AuditLogRow[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(','))
  return [header, ...lines].join('\n')
}

// 归档目录：server/data/log-archive（与 db.ts 的 data 目录推导一致）
const __dirname = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ARCHIVE_DIR = join(__dirname, '..', 'data', 'log-archive')

export interface RetentionResult {
  archived: number
  deleted: number
  archiveFile: string | null
}

/**
 * 审计日志保留策略：导出 180 天前的日志为 CSV 归档，然后从库中删除。
 * 幂等安全：无过期日志时不创建文件、不写库。仅归档目录创建失败时抛错由调用方兜底。
 */
export function runAuditRetention(
  options: { archiveDir?: string; now?: number } = {},
): RetentionResult {
  const now = options.now ?? Date.now()
  const retentionMs = 180 * 24 * 60 * 60 * 1000
  const cutoff = now - retentionMs
  const rows = db
    .prepare('SELECT * FROM operation_logs WHERE createdAt < ? ORDER BY createdAt ASC')
    .all(cutoff) as AuditLogRow[]
  if (rows.length === 0) {
    return { archived: 0, deleted: 0, archiveFile: null }
  }

  const archiveDir = options.archiveDir ?? DEFAULT_ARCHIVE_DIR
  mkdirSync(archiveDir, { recursive: true })
  const archiveFile = join(archiveDir, `audit-logs-${new Date(now).toISOString().slice(0, 10)}.csv`)
  // 归档文件按天聚合：文件已存在（同日多次清理）时仅追加数据行（不带表头）
  const csv = renderLogsCsv(rows)
  const content = existsSync(archiveFile)
    ? csv.split('\n').slice(1).join('\n') + '\n'
    : `${csv}\n`
  writeFileSync(archiveFile, content, { flag: 'a' })

  const deleteResult = db.prepare('DELETE FROM operation_logs WHERE createdAt < ?').run(cutoff)
  return { archived: rows.length, deleted: deleteResult.changes, archiveFile }
}
