// 用户管理与审计日志查询路由（多用户 P1/P2）
// 权限分组（RBAC 矩阵见 permissions.ts / docs/MULTI_USER_DESIGN.md 3.1）：
// - /users 子组要求 users:manage（仅 admin 角色持有）
// - /logs  子组要求 logs:view（admin 与 teacher，教师可查日志追溯）
//
// 路由按领域拆分：
//   - adminUserRoutes：用户列表 / 创建 / 禁用启用 / 重置密码 / 改角色
//   - adminLogRoutes：审计日志查询与 CSV 导出
//   - adminClassStatsRoute：班级学情聚合
//   - adminAiUsageRoute：AI 成本与用量聚合（L2）
import { Router } from 'express'
import { requirePermission } from './permissions.js'
import { registerAdminUserRoutes } from './adminUserRoutes.js'
import { registerAdminLogRoutes } from './adminLogRoutes.js'
import { registerAdminClassStatsRoute } from './adminClassStatsRoute.js'
import { registerAdminAiUsageRoute } from './adminAiUsageRoute.js'

export const adminRouter = Router()

// 权限分组：/users 要求 users:manage，/logs 要求 logs:view，
// /class-stats 要求 stats:class（authMiddleware 由 index.ts 统一挂载）
adminRouter.use('/users', requirePermission('users:manage'))
adminRouter.use('/logs', requirePermission('logs:view'))
adminRouter.use('/class-stats', requirePermission('stats:class'))
adminRouter.use('/ai-usage', requirePermission('logs:view'))

registerAdminUserRoutes(adminRouter)
registerAdminLogRoutes(adminRouter)
registerAdminClassStatsRoute(adminRouter)
registerAdminAiUsageRoute(adminRouter)
