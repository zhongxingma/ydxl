// REST 路由工厂：为每张表生成 GET 列表 / GET :id / POST 新增 / PUT :id 更新 / DELETE :id 删除
// 表名通过白名单校验，防止 SQL 注入（表名不可参数化，故只接受预定义集合）
// 加密：ENCRYPTED_COLUMNS 中的字段在写入前 encryptField、读取后 decryptField
// - 私有表（words/reviews/stats/readingSessions/achievements）按 req.user 严格隔离：
//   存储层 id 为 `${userId}:${原id}`（透明前缀映射），查询强制 WHERE userId = ?，
//   响应剥离前缀与 userId 字段，前端实体形态与单用户时代完全一致
// - 共享表（articles/questions）全站一份；articles 的 readAt/startedAt（私有阅读状态）
//   剥离到 user_article_states，读写时按当前用户合并（见 createArticlesRouter）
import { Router } from 'express'
import type { Request, Response } from 'express'
import { db, JSON_COLUMNS, ENCRYPTED_COLUMNS } from './db.js'
import { encryptField, decryptField } from './encryption.js'
import type { AuthUser } from './auth.js'
import { logOperation, AUDIT_ACTIONS } from './audit.js'

// 审计辅助：写操作成功后记录（动作名 `${table}.create/update/delete`，
// 字典见 audit.ts / 设计文档 4.2；普通 GET 不记录）
function auditWrite(
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

function isTableName(name: string): name is TableName {
  return (TABLES as readonly string[]).includes(name)
}


// 私有表：所有查询强制 WHERE userId = ?，id 存储为 `${userId}:${原id}`
const PRIVATE_TABLES: ReadonlySet<TableName> = new Set([
  'words',
  'reviews',
  'stats',
  'readingSessions',
  'achievements',
])

// 私有引用列：值引用另一张私有表的主键，需与 id 做同样的前缀映射/剥离
const PRIVATE_REF_COLUMNS: Partial<Record<TableName, readonly string[]>> = {
  reviews: ['wordId'],
}

/**
 * 获取当前登录用户；未认证时直接响应 401 并返回 null
 * 生产环境由 index.ts 的 authMiddleware 保证 req.user 存在；
 * 此处的兜底防止中间件漏挂时以匿名身份读写数据（fail-closed）
 */
function requireUser(req: Request, res: Response): AuthUser | null {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
    return null
  }
  return user
}

/** 业务 id → 存储 id（私有表加用户前缀） */
function toStoredId(userId: string, rawId: string): string {
  return `${userId}:${rawId}`
}

/**
 * 私有表响应字段剥离：去除 id/引用列的用户前缀、删除 userId 字段
 * 保证前端看到的实体与单用户时代形态一致（前端零改动）
 */
function stripPrivateFields(
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
function sanitizeBody(
  body: Record<string, unknown>,
  tableName: TableName
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
function prepareWriteBody(
  rawBody: unknown,
  tableName: TableName,
  user: AuthUser,
  isPrivate: boolean,
  refCols: readonly string[]
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
function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit = Number(query.limit)
  const rawOffset = Number(query.offset)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0
  return { limit, offset }
}

// 序列化写入值：
// - 加密字段：先 encryptField 再返回（生成 `enc:v1:...` 字符串）
// - JSON 字段：stringify
// - boolean 字段：转 0/1
// - undefined：转 null
function serializeValue(
  value: unknown,
  isJsonColumn: boolean,
  isEncryptedColumn: boolean
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
function deserializeRow(
  row: Record<string, unknown>,
  jsonCols: readonly string[],
  encCols: readonly string[]
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

// 表名仅用于拼接 SQL，已通过白名单校验防止注入
export function createTableRouter(tableName: TableName): Router {
  // articles 为共享表且含私有阅读状态合并逻辑，委托专用路由（保持单一入口）
  if (tableName === 'articles') return createArticlesRouter()

  const router = Router()
  const jsonCols = JSON_COLUMNS[tableName] ?? []
  const encCols = ENCRYPTED_COLUMNS[tableName] ?? []
  const isPrivate = PRIVATE_TABLES.has(tableName)
  const refCols = PRIVATE_REF_COLUMNS[tableName] ?? []

  // GET / — 返回分页记录，按 updated_at 倒序
  // 支持 ?limit=N&offset=N 查询参数，默认 limit=100，最大 limit=1000
  // 返回 { items: [...], total: N, limit: N, offset: N }
  // 私有表：强制 WHERE userId = 当前用户（严格数据隔离）
  router.get('/', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>)
    const rows = (
      isPrivate
        ? db
            .prepare(
              `SELECT * FROM ${tableName} WHERE userId = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
            )
            .all(user.id, limit, offset)
        : db
            .prepare(`SELECT * FROM ${tableName} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset)
    ) as Record<string, unknown>[]
    const total = (
      (isPrivate
        ? db.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE userId = ?`).get(user.id)
        : db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get()) as { count: number }
    ).count
    const prefix = `${user.id}:`
    const items = rows.map((row) => {
      const deserialized = deserializeRow(row, jsonCols, encCols)
      return isPrivate ? stripPrivateFields(deserialized, prefix, refCols) : deserialized
    })
    res.json({ items, total, limit, offset })
  })

  // GET /:id — 返回单条记录（私有表 id 参数先加用户前缀再查询）
  router.get('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const row = (
      isPrivate
        ? db
            .prepare(`SELECT * FROM ${tableName} WHERE id = ? AND userId = ?`)
            .get(toStoredId(user.id, req.params.id), user.id)
        : db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(req.params.id)
    ) as Record<string, unknown> | undefined
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    const deserialized = deserializeRow(row, jsonCols, encCols)
    return res.json(
      isPrivate ? stripPrivateFields(deserialized, `${user.id}:`, refCols) : deserialized,
    )
  })

  // POST / — 新增记录（自动填充 updated_at）
  // 使用 INSERT OR REPLACE 实现幂等：当客户端重试提交相同主键时，覆盖已有记录而非抛出
  // UNIQUE constraint 异常，避免该异常冒泡到 Express 默认错误处理（返回 HTML 500），
  // 进而避免前置 nginx 将 500 转换为 502 Bad Gateway
  // 私有表：强制写入当前用户的 userId（忽略客户端伪造值），id/引用列加用户前缀
  router.post('/', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    // 安全：过滤非法列名（防止列名注入）并校验字段长度；私有表强制归属当前用户
    const prepared = prepareWriteBody(req.body, tableName, user, isPrivate, refCols)
    if (!prepared.ok) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: prepared.error } })
    }
    const body = prepared.body
    const keys = Object.keys(body)
    const values = keys.map((k) =>
      serializeValue(body[k], jsonCols.includes(k), encCols.includes(k)),
    )
    const placeholders = keys.map(() => '?').join(', ')
    db.prepare(`INSERT OR REPLACE INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values)
    // 返回写入后的 body（明文，未加密；加密仅影响存储层；私有表剥离前缀与 userId）
    const responseBody = isPrivate ? stripPrivateFields(body, `${user.id}:`, refCols) : body
    // 审计：表写操作（P2；动作名 `${table}.create`）
    auditWrite(req, user, `${tableName}.create`, tableName, String(responseBody.id ?? body.id ?? '') || null)
    return res.status(201).json(responseBody)
  })

  // PUT /:id — 更新记录（自动刷新 updated_at；私有表 id 参数先加用户前缀）
  router.put('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    // 安全：过滤非法列名（防止列名注入）并校验字段长度；私有表强制归属当前用户
    const prepared = prepareWriteBody(req.body, tableName, user, isPrivate, refCols)
    if (!prepared.ok) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: prepared.error } })
    }
    const body = prepared.body
    const keys = Object.keys(body)
    const values = keys.map((k) =>
      serializeValue(body[k], jsonCols.includes(k), encCols.includes(k)),
    )
    const setClause = keys.map((k) => `${k} = ?`).join(', ')
    const storedId = isPrivate ? toStoredId(user.id, req.params.id) : req.params.id
    const updateResult = db
      .prepare(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`)
      .run(...values, storedId)
    if (updateResult.changes === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    // 返回写入后的 body（明文，未加密；私有表剥离前缀与 userId）
    const responseBody = isPrivate ? stripPrivateFields(body, `${user.id}:`, refCols) : body
    // 审计：表写操作（P2；动作名 `${table}.update`；resourceId 为业务 id）
    auditWrite(req, user, `${tableName}.update`, tableName, req.params.id)
    return res.json(responseBody)
  })

  // DELETE /:id — 删除记录（私有表 id 参数先加用户前缀，且限定当前用户）
  router.delete('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const result = isPrivate
      ? db
          .prepare(`DELETE FROM ${tableName} WHERE id = ? AND userId = ?`)
          .run(toStoredId(user.id, req.params.id), user.id)
      : db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(req.params.id)
    if (result.changes === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    // 审计：表写操作（P2；动作名 `${table}.delete`；resourceId 为业务 id）
    auditWrite(req, user, `${tableName}.delete`, tableName, req.params.id)
    return res.status(204).end()
  })

  return router
}

/**
 * 创建 articles 表的共享路由
 *
 * articles / questions 为全站共享内容（AI 生成一篇全站使用，节省 token），
 * 但 readAt / startedAt 是每个用户的私有阅读状态，存储在 user_article_states：
 * - 读取：共享文章行 + 按当前用户合并阅读状态（readAt/startedAt）
 * - 写入：业务字段（translation/phrases/vocabulary 等）写共享 articles 表；
 *         readAt/startedAt 从请求体分离，upsert 到 user_article_states（按当前用户）
 * - 前端实体形态与单用户时代一致（readAt/startedAt 仍在 Article 对象上），零改动
 */
export function createArticlesRouter(): Router {
  const router = Router()
  const jsonCols = JSON_COLUMNS['articles'] ?? []

  interface StateRow {
    articleId: string
    startedAt: number | null
    readAt: number | null
  }

  function getUserStates(userId: string): Map<string, StateRow> {
    const rows = db
      .prepare('SELECT articleId, startedAt, readAt FROM user_article_states WHERE userId = ?')
      .all(userId) as StateRow[]
    return new Map(rows.map((r) => [r.articleId, r]))
  }

  // 将当前用户的阅读状态合并到文章对象上（无状态时为 null，与旧数据语义一致）
  function mergeState(
    article: Record<string, unknown>,
    states: Map<string, StateRow>,
  ): Record<string, unknown> {
    const state = states.get(article.id as string)
    article.startedAt = state?.startedAt ?? null
    article.readAt = state?.readAt ?? null
    return article
  }

  // 从请求体分离私有阅读状态字段（不写入共享 articles 表）
  function splitStateFields(body: Record<string, unknown>): {
    articleFields: Record<string, unknown>
    state: { readAt?: unknown; startedAt?: unknown }
    hasState: boolean
  } {
    const { readAt, startedAt, ...articleFields } = body
    const state: { readAt?: unknown; startedAt?: unknown } = {}
    if ('readAt' in body) state.readAt = readAt
    if ('startedAt' in body) state.startedAt = startedAt
    return { articleFields, state, hasState: 'readAt' in body || 'startedAt' in body }
  }

  // upsert 当前用户对某文章的阅读状态（未提供的字段保留原值）
  function upsertState(
    userId: string,
    articleId: string,
    state: { readAt?: unknown; startedAt?: unknown },
  ): void {
    const existing = db
      .prepare(
        'SELECT startedAt, readAt FROM user_article_states WHERE userId = ? AND articleId = ?',
      )
      .get(userId, articleId) as { startedAt: number | null; readAt: number | null } | undefined
    const startedAt =
      'startedAt' in state ? (state.startedAt as number | null) : (existing?.startedAt ?? null)
    const readAt = 'readAt' in state ? (state.readAt as number | null) : (existing?.readAt ?? null)
    db.prepare(
      `INSERT OR REPLACE INTO user_article_states (userId, articleId, startedAt, readAt, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(userId, articleId, startedAt, readAt, Date.now())
  }

  function articleExists(articleId: string): boolean {
    return !!db.prepare('SELECT 1 FROM articles WHERE id = ?').get(articleId)
  }

  // GET / — 共享文章分页列表 + 当前用户阅读状态合并
  router.get('/', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>)
    const rows = db
      .prepare(`SELECT * FROM articles ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Record<string, unknown>[]
    const total = (db.prepare('SELECT COUNT(*) as count FROM articles').get() as { count: number })
      .count
    const states = getUserStates(user.id)
    const items = rows.map((row) => mergeState(deserializeRow(row, jsonCols, []), states))
    res.json({ items, total, limit, offset })
  })

  // GET /:id — 单篇共享文章 + 当前用户阅读状态合并
  router.get('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    const states = getUserStates(user.id)
    return res.json(mergeState(deserializeRow(row, jsonCols, []), states))
  })

  // POST / — 新增/覆盖共享文章；readAt/startedAt 写入当前用户的阅读状态
  router.post('/', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const rawBody =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
    const result = sanitizeBody(rawBody, 'articles')
    if (!result.ok) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: result.error } })
    }
    const { articleFields, state, hasState } = splitStateFields(result.data)
    const businessKeys = Object.keys(articleFields).filter((k) => k !== 'id')
    const articleId = typeof articleFields.id === 'string' ? articleFields.id : undefined

    if (businessKeys.length === 0) {
      // 仅阅读状态字段：文章必须已存在，只更新状态（等价于标记阅读）
      if (!articleId || !hasState || !articleExists(articleId)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '缺少有效字段' } })
      }
      upsertState(user.id, articleId, state)
      const states = getUserStates(user.id)
      const row = db
        .prepare('SELECT * FROM articles WHERE id = ?')
        .get(articleId) as Record<string, unknown>
      // 审计：标记阅读（P2，私有阅读状态写入）
      auditWrite(req, user, AUDIT_ACTIONS.articlesMarkRead, 'articles', articleId)
      return res.status(201).json(mergeState(deserializeRow(row, jsonCols, []), states))
    }

    const body: Record<string, unknown> = { ...articleFields, updated_at: Date.now() }
    const keys = Object.keys(body)
    const values = keys.map((k) => serializeValue(body[k], jsonCols.includes(k), false))
    const placeholders = keys.map(() => '?').join(', ')
    db.prepare(
      `INSERT OR REPLACE INTO articles (${keys.join(', ')}) VALUES (${placeholders})`,
    ).run(...values)
    if (articleId && hasState) upsertState(user.id, articleId, state)
    // 响应用于回显请求体（含 readAt/startedAt），与单用户时代形态一致
    // 审计：共享文章业务写入（P2，AI 生成回写等）
    auditWrite(req, user, 'articles.create', 'articles', articleId ?? null)
    return res.status(201).json({ ...result.data, updated_at: body.updated_at })
  })

  // PUT /:id — 更新共享文章业务字段 和/或 当前用户阅读状态
  router.put('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const rawBody =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
    const result = sanitizeBody(rawBody, 'articles')
    if (!result.ok) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: result.error } })
    }
    const { articleFields, state, hasState } = splitStateFields(result.data)
    const businessKeys = Object.keys(articleFields).filter((k) => k !== 'id')

    if (!articleExists(req.params.id)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    }
    if (businessKeys.length === 0 && !hasState) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '缺少有效字段' } })
    }

    if (businessKeys.length > 0) {
      const body: Record<string, unknown> = { ...articleFields, updated_at: Date.now() }
      const keys = Object.keys(body)
      const values = keys.map((k) => serializeValue(body[k], jsonCols.includes(k), false))
      const setClause = keys.map((k) => `${k} = ?`).join(', ')
      db.prepare(`UPDATE articles SET ${setClause} WHERE id = ?`).run(...values, req.params.id)
    }
    if (hasState) upsertState(user.id, req.params.id, state)
    if (businessKeys.length > 0) {
      auditWrite(req, user, 'articles.update', 'articles', req.params.id)
    }
    if (hasState) {
      auditWrite(req, user, AUDIT_ACTIONS.articlesMarkRead, 'articles', req.params.id)
    }
    // 响应用于回显请求体（含 readAt/startedAt），与单用户时代形态一致
    return res.json({ ...result.data, updated_at: Date.now() })
  })

  // DELETE /:id — 删除共享文章，同时清理全部用户的阅读状态（孤儿清理）
  router.delete('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const result = db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id)
    if (result.changes === 0)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    db.prepare('DELETE FROM user_article_states WHERE articleId = ?').run(req.params.id)
    // 审计：删除共享文章（P2，全站影响操作）
    auditWrite(req, user, 'articles.delete', 'articles', req.params.id)
    return res.status(204).end()
  })

  return router
}

/**
 * 创建 words 表的批量插入路由（POST /bulk）
 *
 * 用于批量加入生词本场景，消除 N+1 HTTP 调用：
 * - 请求体：`{ items: Word[] }`，单次最多 1000 条
 * - 使用事务 + `INSERT OR IGNORE` 批量插入：已存在的词跳过，不覆盖已有复习进度
 * - 响应：`{ added: number, skipped: number, errors: Array<{ index: number, error: string }> }`
 *   - added：新插入的记录数
 *   - skipped：已存在被跳过的记录数（含字段校验失败的记录）
 *   - errors：字段校验失败的详细错误列表（index 为 items 数组下标）
 *
 * @returns Express Router，注册到 `/api/words/bulk`
 */
export function createWordsBulkRouter(): Router {
  const router = Router()
  const jsonCols = JSON_COLUMNS['words'] ?? []
  const encCols = ENCRYPTED_COLUMNS['words'] ?? []

  router.post('/', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const body = req.body
    if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: '请求体必须包含 items 数组' },
      })
    }
    const items = (body as { items: unknown[] }).items
    if (items.length === 0) {
      return res.json({ added: 0, skipped: 0, errors: [] })
    }
    if (items.length > 1000) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: '单次最多批量插入 1000 条' },
      })
    }

    let added = 0
    let skipped = 0
    const errors: Array<{ index: number; error: string }> = []

    // 事务批量插入：单条失败不中断整体，try/catch 在事务内捕获
    const insertAll = db.transaction(() => {
      for (let i = 0; i < items.length; i++) {
        const rawItem = items[i]
        if (!rawItem || typeof rawItem !== 'object') {
          skipped += 1
          errors.push({ index: i, error: '无效的记录格式' })
          continue
        }
        const result = sanitizeBody(rawItem as Record<string, unknown>, 'words')
        if (!result.ok) {
          skipped += 1
          errors.push({ index: i, error: result.error })
          continue
        }
        if (Object.keys(result.data).length === 0) {
          skipped += 1
          errors.push({ index: i, error: '缺少有效字段' })
          continue
        }
        // 多用户：归属当前用户（忽略客户端伪造 userId），id 加用户前缀
        const item: Record<string, unknown> = {
          ...result.data,
          updated_at: Date.now(),
          userId: user.id,
        }
        if (typeof item.id === 'string') item.id = toStoredId(user.id, item.id)
        const keys = Object.keys(item)
        try {
          const values = keys.map((k) =>
            serializeValue(item[k], jsonCols.includes(k), encCols.includes(k)),
          )
          const placeholders = keys.map(() => '?').join(', ')
          // INSERT OR IGNORE：已存在的词跳过，不覆盖已有复习进度与笔记
          const info = db
            .prepare(`INSERT OR IGNORE INTO words (${keys.join(', ')}) VALUES (${placeholders})`)
            .run(...values)
          if (info.changes > 0) {
            added += 1
          } else {
            skipped += 1
          }
        } catch (err) {
          skipped += 1
          errors.push({
            index: i,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    })

    try {
      insertAll()
    } catch (err) {
      // 事务整体失败（罕见，如磁盘满）
      console.error('[routes] words 批量插入事务失败', err)
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '批量插入事务失败' },
      })
    }

    auditWrite(req, user, AUDIT_ACTIONS.wordsBulkImport, 'words', null, {
      total: items.length,
      added,
      skipped,
      errorCount: errors.length,
    })

    return res.status(201).json({ added, skipped, errors })
  })

  return router
}

// 校验辅助：供 index.ts 校验路由表名
export { isTableName }
