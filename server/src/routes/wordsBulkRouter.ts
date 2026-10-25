// words 批量插入路由（POST /bulk）
//
// 用于批量加入生词本场景，消除 N+1 HTTP 调用：
// - 请求体：`{ items: Word[] }`，单次最多 1000 条
// - 使用事务 + `INSERT OR IGNORE` 批量插入：已存在的词跳过，不覆盖已有复习进度
// - 响应：`{ added: number, skipped: number, errors: Array<{ index: number, error: string }> }`
//   - added：新插入的记录数
//   - skipped：已存在被跳过的记录数（含字段校验失败的记录）
//   - errors：字段校验失败的详细错误列表（index 为 items 数组下标）
import { Router } from 'express'
import { db, JSON_COLUMNS, ENCRYPTED_COLUMNS } from '../db.js'
import { AUDIT_ACTIONS } from '../audit.js'
import {
  auditWrite,
  requireUser,
  sanitizeBody,
  serializeValue,
  toStoredId,
} from './shared.js'

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
          // 服务端记录真实原因；响应只返回通用错误，避免泄露表/约束等内部细节
          console.warn('[routes] words 批量插入单项失败', { index: i, err })
          errors.push({ index: i, error: 'invalid item' })
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
