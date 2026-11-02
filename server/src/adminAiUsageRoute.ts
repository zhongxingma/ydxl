// AI 成本可观测路由（L2，logs:view：admin 与 teacher）
// GET /api/admin/ai-usage?days=30 —— 聚合近 N 天 AI 调用量、token 与估算成本
// 数据源为 operation_logs 中的 ai.proxy.usage 行；查询行为本身留痕
import type { Router } from 'express'
import { logOperation, AUDIT_ACTIONS } from './audit.js'
import { getAiCostReport } from './aiUsage.js'

const DEFAULT_DAYS = 30

export function registerAdminAiUsageRoute(router: Router): void {
  router.get('/ai-usage', (req, res) => {
    const requested = Number(req.query.days)
    const days = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_DAYS
    const report = getAiCostReport(days)

    logOperation({
      userId: req.user!.id,
      username: req.user!.username,
      action: AUDIT_ACTIONS.aiCostView,
      resource: 'ai-proxy',
      detail: { days: report.days, from: report.from, to: report.to },
      ip: req.ip,
    })

    return res.json(report)
  })
}
