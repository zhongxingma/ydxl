// 通用表 REST 路由工厂
//
// 为除 articles 外的表生成 GET 列表 / GET :id / POST / PUT :id / DELETE :id。
// 私有表按 req.user 严格隔离（透明 id 前缀映射）；questions 的修改/删除需 content:manage。
import { Router } from 'express'
import { db, JSON_COLUMNS, ENCRYPTED_COLUMNS } from '../db.js'
import { createArticlesRouter } from './articlesRouter.js'
import {
  auditWrite,
  deserializeRow,
  parsePagination,
  prepareWriteBody,
  requireContentManager,
  requireUser,
  serializeValue,
  stripPrivateFields,
  toStoredId,
  PRIVATE_REF_COLUMNS,
  PRIVATE_TABLES,
  type TableName,
} from './shared.js'

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
    db.prepare(
      `INSERT OR REPLACE INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
    ).run(...values)
    // 返回写入后的 body（明文，未加密；加密仅影响存储层；私有表剥离前缀与 userId）
    const responseBody = isPrivate ? stripPrivateFields(body, `${user.id}:`, refCols) : body
    // 审计：表写操作（动作名 `${table}.create`）
    auditWrite(
      req,
      user,
      `${tableName}.create`,
      tableName,
      String(responseBody.id ?? body.id ?? '') || null,
    )
    return res.status(201).json(responseBody)
  })

  // PUT /:id — 更新记录（自动刷新 updated_at；私有表 id 参数先加用户前缀）
  router.put('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    // 共享内容（questions）的核心字段仅教师/管理员可改；学生保留创建与私有写操作
    if (tableName === 'questions' && !requireContentManager(req, res, user)) return
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
    if (updateResult.changes === 0)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    // 返回写入后的 body（明文，未加密；私有表剥离前缀与 userId）
    const responseBody = isPrivate ? stripPrivateFields(body, `${user.id}:`, refCols) : body
    // 审计：表写操作（动作名 `${table}.update`；resourceId 为业务 id）
    auditWrite(req, user, `${tableName}.update`, tableName, req.params.id)
    return res.json(responseBody)
  })

  // DELETE /:id — 删除记录（私有表 id 参数先加用户前缀，且限定当前用户）
  router.delete('/:id', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    // 共享内容（questions）删除仅教师/管理员
    if (tableName === 'questions' && !requireContentManager(req, res, user)) return
    const result = isPrivate
      ? db
          .prepare(`DELETE FROM ${tableName} WHERE id = ? AND userId = ?`)
          .run(toStoredId(user.id, req.params.id), user.id)
      : db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(req.params.id)
    if (result.changes === 0)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    // 审计：表写操作（动作名 `${table}.delete`；resourceId 为业务 id）
    auditWrite(req, user, `${tableName}.delete`, tableName, req.params.id)
    return res.status(204).end()
  })

  return router
}
