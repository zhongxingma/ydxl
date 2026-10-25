// REST 路由共享工具
//
// 集中定义表名白名单、用户/权限校验、请求体清洗、私有表前缀映射与序列化逻辑，
// 供 tableRouter / articlesRouter / wordsBulkRouter 复用。
import type { Request, Response } from 'express'
import { db } from '../db.js'
import { encryptField, decryptField } from '../encryption.js'
import type { AuthUser } from '../auth.js'
import { logOperation, AUDIT_ACTIONS } from '../audit.js'
import { hasPermission } from '../permissions.js'

// 审计辅助：写操作成功后记录（动作名 `${table}.create/update/delete`，
// 字典见 audit.ts / 设计文档 4.2；普通 GET 不记录）
export function auditWrite(
  req: Request,
  user: AuthUser,
  action: string,
  resource: string,
  resourceId: string | null,
  detail?: Record<string, unknown>,
): void {
  logOperation({
    userId: user.id,
    username: user.username,
    action,
    resource,
    resourceId,
    detail,
    ip: req.ip,
  })
}

// 允许的表名白名单
export const TABLES = [
  'articles',
  'questions',
  'words',
  'reviews',
  'stats',
  'readingSessions',
  'achievements',
] as const

export type TableName = (typeof TABLES)[number]

// 默认分页大小
const DEFAULT_LIMIT = 100
// 最大分页大小（防止过大查询）
const MAX_LIMIT = 1000

// 单个字符串字段最大长度（1MB，远超任何合法文本字段需求，防止内存滥用）
// 文章内容通常 < 50KB，1MB 上限不影响正常使用
const MAX_STRING_LENGTH = 1024 * 1024

export function isTableName(name: string): name is TableName {
  return (TABLES as readonly string[]).includes(name)
}

// 私有表：所有查询强制 WHERE userId = ?，id 存储为 `${userId}:${原id}`
export const PRIVATE_TABLES: ReadonlySet<TableName> = new Set([
  'words',
  'reviews',
  'stats',
  'readingSessions',
  'achievements',
])

// 私有引用列：值引用另一张私有表的主键，需与 id 做同样的前缀映射/剥离
export const PRIVATE_REF_COLUMNS: Partial<Record<TableName, readonly string[]>> = {
  reviews: ['wordId'],
}

/**
 * 获取当前登录用户；未认证时直接响应 401 并返回 null
 * 生产环境由 index.ts 的 authMiddleware 保证 req.user 存在；
 * 此处的兜底防止中间件漏挂时以匿名身份读写数据（fail-closed）
 */
export function requireUser(req: Request, res: Response): AuthUser | null {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
    return null
  }
  return user
}

/**
 * 共享内容（articles/questions）的管理权限校验。
 * - 学生可创建内容（AI 生成写回）与更新派生缓存字段，但不得修改核心内容或删除
 * - 教师/管理员持有 content:manage，可执行全部写操作
 * 拒绝时统一 403 并留审计痕迹（与 requirePermission 语义一致）。
 */
export function requireContentManager(req: Request, res: Response, user: AuthUser): boolean {
  if (hasPermission(user, 'content:manage')) return true
  logOperation({
    userId: user.id,
    username: user.username,
    action: AUDIT_ACTIONS.permissionDenied,
    result: 'denied',
    detail: { permission: 'content:manage', method: req.method, path: req.originalUrl },
    ip: req.ip,
  })
  res.status(403).json({ error: { code: 'FORBIDDEN', message: '缺少权限：content:manage' } })
  return false
}

/**
 * 学生可写回的文章派生字段（AI 增强结果，非核心正文）：
 * - vocabulary：阅读页 AI 增强后的词汇缓存
 * - phrases：AI 提取的重点短语缓存
 * 其余业务字段（标题/正文/翻译/文体等）由 content:manage 角色维护。
 */
export const STUDENT_WRITABLE_ARTICLE_FIELDS: ReadonlySet<string> = new Set([
  'vocabulary',
  'phrases',
])

/** 业务 id → 存储 id（私有表加用户前缀） */
export function toStoredId(userId: string, rawId: string): string {
  return `${userId}:${rawId}`
}

/**
 * 私有表响应字段剥离：去除 id/引用列的用户前缀、删除 userId 字段
 * 保证前端看到的实体与单用户时代形态一致（前端零改动）
 */
export function stripPrivateFields(
  row: Record<string, unknown>,
  prefix: string,
  refCols: readonly string[],
): Record<string, unknown> {
  const result = { ...row }
  if (typeof result.id === 'string' && result.id.startsWith(prefix)) {
    result.id = result.id.slice(prefix.length)
  }
  for (const col of refCols) {
    const value = result[col]
    if (typeof value === 'string' && value.startsWith(prefix)) {
      result[col] = value.slice(prefix.length)
    }
  }
  delete result.userId
  return result
}

// 缓存各表的合法列名（通过 PRAGMA table_info 获取）
// 列名不可参数化（SQL 语法限制），故通过白名单过滤防止列名注入
const columnCache = new Map<TableName, Set<string>>()

function getValidColumns(tableName: TableName): Set<string> {
  let cols = columnCache.get(tableName)
  if (!cols) {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    cols = new Set(rows.map((r) => r.name))
    columnCache.set(tableName, cols)
  }
  return cols
}

// 过滤请求体：仅保留表内合法列名，防止通过列名进行 SQL 注入
// 同时校验字符串字段长度，防止超大文本导致内存滥用
export function sanitizeBody(
  body: Record<string, unknown>,
  tableName: TableName,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const validCols = getValidColumns(tableName)
  const sanitized: Record<string, unknown> = {}
  for (const key of Object.keys(body)) {
    if (!validCols.has(key)) {
      // 非法列名直接忽略（不抛错，保持向前兼容：客户端多传字段不应导致请求失败）
      continue
    }
    const value = body[key]
    // 校验字符串长度
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      return { ok: false, error: `字段 ${key} 值过长（超过 ${MAX_STRING_LENGTH} 字符）` }
    }
    // JSON 字段（对象/数组）序列化后校验长度
    if (value !== null && typeof value === 'object') {
      const serialized = JSON.stringify(value)
      if (serialized.length > MAX_STRING_LENGTH) {
        return { ok: false, error: `字段 ${key} 值过长（序列化后超过 ${MAX_STRING_LENGTH} 字符）` }
      }
    }
    sanitized[key] = value
  }
  return { ok: true, data: sanitized }
}

// 写操作请求体准备（POST / PUT 共用）：
// 1. 过滤非法列名并校验字段长度（sanitizeBody）
// 2. 拒绝无有效业务字段的请求
// 3. 自动填充 updated_at；私有表强制归属当前用户并映射 id/引用列前缀（忽略客户端伪造值）
// 失败时调用方以 400 响应（错误消息与原实现一致）
export function prepareWriteBody(
  rawBody: unknown,
  tableName: TableName,
  user: AuthUser,
  isPrivate: boolean,
  refCols: readonly string[],
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const raw = rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {}
  const result = sanitizeBody(raw, tableName)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  if (Object.keys(result.data).length === 0) {
    return { ok: false, error: '缺少有效字段' }
  }
  const body: Record<string, unknown> = { ...result.data, updated_at: Date.now() }
  if (isPrivate) {
    body.userId = user.id
    if (typeof body.id === 'string') body.id = toStoredId(user.id, body.id)
    for (const col of refCols) {
      if (typeof body[col] === 'string') body[col] = toStoredId(user.id, body[col] as string)
    }
  }
  return { ok: true, body }
}

// 从 query 参数解析分页：limit（默认 100，最大 1000）、offset（默认 0）
export function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit = Number(query.limit)
  const rawOffset = Number(query.offset)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0
  return { limit, offset }
}

// 序列化写入值：
// - 加密字段：先 encryptField 再返回（生成 `enc:v1:...` 字符串）
// - JSON 字段：stringify
// - boolean 字段：转 0/1
// - undefined：转 null
export function serializeValue(
  value: unknown,
  isJsonColumn: boolean,
  isEncryptedColumn: boolean,
): unknown {
  // 加密字段优先处理：在 JSON 序列化之前加密原始字符串
  if (isEncryptedColumn) {
    // 加密字段必须为 string 或 null/undefined；非字符串值先 String() 强转
    if (value !== null && value !== undefined && typeof value !== 'string') {
      value = String(value)
    }
    return encryptField(value as string | null | undefined)
  }
  if (isJsonColumn) {
    return value === undefined || value === null ? null : JSON.stringify(value)
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (value === undefined) {
    return null
  }
  return value
}

// 反序列化读取值：先解密加密字段，再 parse JSON 字段
export function deserializeRow(
  row: Record<string, unknown>,
  jsonCols: readonly string[],
  encCols: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row }
  // 1. 解密加密字段
  for (const col of encCols) {
    const raw = result[col]
    if (typeof raw === 'string') {
      result[col] = decryptField(raw)
    }
  }
  // 2. 反序列化 JSON 字段
  for (const col of jsonCols) {
    const raw = result[col]
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        result[col] = JSON.parse(raw)
      } catch (err) {
        // 解析失败保留原值，开发环境记录日志便于排查脏数据
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[routes] JSON 字段 ${col} 解析失败，保留原值`, err)
        }
      }
    }
  }
  return result
}
