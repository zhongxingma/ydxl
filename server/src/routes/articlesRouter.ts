// articles 共享路由
//
// articles / questions 为全站共享内容（AI 生成一篇全站使用，节省 token），
// 但 readAt / startedAt 是每个用户的私有阅读状态，存储在 user_article_states：
// - 读取：共享文章行 + 按当前用户合并阅读状态（readAt/startedAt）
// - 写入：业务字段（translation/phrases/vocabulary 等）写共享 articles 表；
//         readAt/startedAt 从请求体分离，upsert 到 user_article_states（按当前用户）
// - 前端实体形态与单用户时代一致（readAt/startedAt 仍在 Article 对象上），零改动
import { Router } from 'express'
import { db, JSON_COLUMNS } from '../db.js'
import { AUDIT_ACTIONS } from '../audit.js'
import {
  auditWrite,
  deserializeRow,
  parsePagination,
  requireContentManager,
  requireUser,
  sanitizeBody,
  serializeValue,
  STUDENT_WRITABLE_ARTICLE_FIELDS,
} from './shared.js'

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
  // 创建保持对所有登录用户开放：AI 生成文章由客户端触发并回写（学生同样需要）
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
      // 审计：标记阅读（私有阅读状态写入）
      auditWrite(req, user, AUDIT_ACTIONS.articlesMarkRead, 'articles', articleId)
      return res.status(201).json(mergeState(deserializeRow(row, jsonCols, []), states))
    }

    const body: Record<string, unknown> = { ...articleFields, updated_at: Date.now() }
    const keys = Object.keys(body)
    const values = keys.map((k) => serializeValue(body[k], jsonCols.includes(k), false))
    const placeholders = keys.map(() => '?').join(', ')
    // 事务：共享文章与当前用户阅读状态需同写同成，避免半写状态
    const persistArticle = db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO articles (${keys.join(', ')}) VALUES (${placeholders})`,
      ).run(...values)
      if (articleId && hasState) upsertState(user.id, articleId, state)
    })
    persistArticle()
    // 响应用于回显请求体（含 readAt/startedAt），与单用户时代形态一致
    // 审计：共享文章业务写入（AI 生成回写等）
    auditWrite(req, user, 'articles.create', 'articles', articleId ?? null)
    return res.status(201).json({ ...result.data, updated_at: body.updated_at })
  })

  // PUT /:id — 更新共享文章业务字段 和/或 当前用户阅读状态
  // 仅 vocabulary/phrases 派生缓存允许学生写回；标题/正文/翻译等核心字段需 content:manage
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

    // 学生仅可写回 vocabulary/phrases 派生缓存；核心内容字段需 content:manage
    if (
      businessKeys.some((k) => !STUDENT_WRITABLE_ARTICLE_FIELDS.has(k)) &&
      !requireContentManager(req, res, user)
    ) {
      return
    }

    if (!articleExists(req.params.id)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    }
    if (businessKeys.length === 0 && !hasState) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '缺少有效字段' } })
    }

    // 事务：业务字段更新与私有阅读状态同写同成
    const persistUpdate = db.transaction(() => {
      if (businessKeys.length > 0) {
        const body: Record<string, unknown> = { ...articleFields, updated_at: Date.now() }
        const keys = Object.keys(body)
        const values = keys.map((k) => serializeValue(body[k], jsonCols.includes(k), false))
        const setClause = keys.map((k) => `${k} = ?`).join(', ')
        db.prepare(`UPDATE articles SET ${setClause} WHERE id = ?`).run(...values, req.params.id)
      }
      if (hasState) upsertState(user.id, req.params.id, state)
    })
    persistUpdate()
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
    if (!requireContentManager(req, res, user)) return
    // 事务：删除共享文章与清理所有用户阅读状态（孤儿清理）需原子完成
    const removeArticle = db.transaction(() => {
      const result = db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id)
      if (result.changes === 0) return 0
      db.prepare('DELETE FROM user_article_states WHERE articleId = ?').run(req.params.id)
      return result.changes
    })
    if (removeArticle() === 0)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    // 审计：删除共享文章（全站影响操作）
    auditWrite(req, user, 'articles.delete', 'articles', req.params.id)
    return res.status(204).end()
  })

  return router
}
