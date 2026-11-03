// 角色路由守卫（多用户）
// - 默认仅 admin 可进入（/admin 用户管理）；可通过 roles prop 放宽（如日志页允许 teacher）
// - 非 allowed 角色重定向首页（体验层隐藏，
//   真正的授权由服务端 requirePermission 强制，见 docs/MULTI_USER_DESIGN.md 第 3.3 节）
import { Navigate, Outlet } from 'react-router-dom'
import { getCurrentUser } from '@/shared/services/authService'

interface RequireAdminProps {
  /** 允许访问的角色集合，默认仅 admin */
  roles?: readonly string[]
}

export default function RequireAdmin({ roles = ['admin'] }: RequireAdminProps) {
  const user = getCurrentUser()
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}
