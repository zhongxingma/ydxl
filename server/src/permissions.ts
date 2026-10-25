// RBAC 权限体系
// 角色存于 users.role 列，权限点与角色的映射硬编码在本文件（3 种角色、权限稳定，
// 不建独立 roles/permissions 表，见 docs/MULTI_USER_DESIGN.md 第 3/8 节取舍）
// 服务端强制是授权的唯一权威：任何 403 均由 requirePermission 产生，前端只作体验层隐藏
import type express from 'express'
import type { AuthUser } from './auth.js'
import { logOperation, AUDIT_ACTIONS } from './audit.js'

export type Role = 'admin' | 'teacher' | 'student'

export const ROLES: readonly Role[] = ['admin', 'teacher', 'student']

// 权限点全集（与设计文档 3.1 权限矩阵一一对应）
export type Permission =
  | 'reading:use'
  | 'wordbook:own'
  | 'stats:own'
  | 'profile:own'
  | 'ai:invoke'
  | 'content:manage'
  | 'stats:class'
  | 'users:manage'
  | 'logs:view'
  | 'system:config'

// 权限矩阵：角色 → 权限点集合
// 学生拥有全部个人功能权限；教师额外可见班级学情与日志；管理员独占用户管理与系统配置
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  student: ['reading:use', 'wordbook:own', 'stats:own', 'profile:own', 'ai:invoke'],
  teacher: [
    'reading:use',
    'wordbook:own',
    'stats:own',
    'profile:own',
    'ai:invoke',
    'content:manage',
    'stats:class',
    'logs:view',
  ],
  admin: [
    'reading:use',
    'wordbook:own',
    'stats:own',
    'profile:own',
    'ai:invoke',
    'content:manage',
    'stats:class',
    'users:manage',
    'logs:view',
    'system:config',
  ],
}

/** 判断用户角色是否持有指定权限点（未知角色一律视为无权限，fail-closed） */
export function hasPermission(user: AuthUser, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[user.role as Role]
  if (!perms) return false
  return perms.includes(permission)
}

/**
 * 授权中间件工厂：校验 req.user 是否持有权限点，无权限统一 403
 * 仅可在 authMiddleware 之后使用（req.user 已由认证层挂载）
 */
export function requirePermission(permission: Permission): express.RequestHandler {
  return (req, res, next) => {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return
    }
    if (!hasPermission(user, permission)) {
      // 审计：权限拒绝留痕（设计文档 4.2——任何 403 均记录，作为入侵探测信号）
      logOperation({
        userId: user.id,
        username: user.username,
        action: AUDIT_ACTIONS.permissionDenied,
        result: 'denied',
        detail: { permission, method: req.method, path: req.originalUrl },
        ip: req.ip,
      })
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: `缺少权限：${permission}` },
      })
      return
    }
    next()
  }
}
