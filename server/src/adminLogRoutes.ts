// 审计日志查询与导出路由（P2，logs:view：admin 与 teacher）
import type { Router } from 'express'
import {
  logOperation,
  queryAuditLogs,
  renderLogsCsv,
  AUDIT_ACTIONS,
  type AuditQueryFilter,
} from './audit.js'

// 日志查询参数解析：userId / action 精确匹配，from/to 为 ms 时间戳，limit 上限 500
function parseAuditFilter(query: Record<string, unknown>): AuditQueryFilter {
  const filter: AuditQueryFilter = {}
  if (typeof query.userId === 'string' && query.userId) filter.userId = query.userId
  if (typeof query.action === 'string' && query.action) filter.action = query.action
  const from = Number(query.from)
  if (Number.isFinite(from) && from > 0) filter.from = from
  const to = Number(query.to)
  if (Number.isFinite(to) && to > 0) filter.to = to
  const limit = Number(query.limit)
  filter.limit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50
  const offset = Number(query.offset)
  filter.offset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  return filter
}

function queryFromRequest(req: { query: Record<string, unknown> }): Record<string, unknown> {
  return req.query && typeof req.query === 'object' ? req.query : {}
}

export function registerAdminLogRoutes(router: Router): void {
  // GET /api/admin/logs — 分页查询审计日志（敏感读：查询行为本身留痕）
  router.get('/logs', (req, res) => {
    const filter = parseAuditFilter(queryFromRequest(req))
    const { items, total } = queryAuditLogs(filter)

    // 敏感读留痕（设计文档 4.2：谁在查别人数据必须记录）
    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.logsQuery,
      resource: 'operation_logs',
      detail: {
        userId: filter.userId ?? null,
        action: filter.action ?? null,
        from: filter.from ?? null,
        to: filter.to ?? null,
        limit: filter.limit,
        offset: filter.offset,
        total,
      },
      ip: req.ip,
    })

    return res.json({ items, total, limit: filter.limit, offset: filter.offset })
  })

  // GET /api/admin/logs/export — 导出审计日志 CSV（同样过滤条件；导出行为留痕）
  router.get('/logs/export', (req, res) => {
    const filter = parseAuditFilter(queryFromRequest(req))
    // 导出不做分页截断（全量按过滤条件）；行数受保留期（180 天）与业务规模约束
    const { items } = queryAuditLogs({ ...filter, limit: 100000, offset: 0 })
    const csv = renderLogsCsv(items)

    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.logsExport,
      resource: 'operation_logs',
      detail: { rows: items.length, userId: filter.userId ?? null, action: filter.action ?? null },
      ip: req.ip,
    })

    const date = new Date().toISOString().slice(0, 10)
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-logs-${date}.csv"`,
    })
    // BOM 前缀：保证 Excel 直接打开时正确识别 UTF-8
    return res.send(`\uFEFF${csv}`)
  })
}
