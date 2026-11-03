// 班级学情聚合路由（stats:class：teacher 与 admin）
import type { Router } from 'express'
import { logOperation, AUDIT_ACTIONS } from './audit.js'
import { getClassStats, DEFAULT_CLASS_STATS_DAYS, MAX_CLASS_STATS_DAYS } from './classStats.js'

function queryFromRequest(req: { query: Record<string, unknown> }): Record<string, unknown> {
  return req.query && typeof req.query === 'object' ? req.query : {}
}

export function registerAdminClassStatsRoute(router: Router): void {
  // GET /api/admin/class-stats?days=30 — 全班学员学习统计汇总（只读）
  // 敏感读：查询行为留痕（设计文档 4.2——谁在查别人数据必须记录）
  router.get('/class-stats', (req, res) => {
    const requested = Number(queryFromRequest(req).days)
    const days = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_CLASS_STATS_DAYS
    const result = getClassStats({ days: Math.min(days, MAX_CLASS_STATS_DAYS) })

    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.classStatsView,
      resource: 'users',
      detail: {
        days: result.days,
        from: result.from,
        to: result.to,
        studentCount: result.summary.studentCount,
      },
      ip: req.ip,
    })

    return res.json(result)
  })
}
