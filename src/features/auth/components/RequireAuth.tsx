// 认证路由守卫
// - 无会话令牌：重定向到 /login
// - 监听 ydxl:unauthorized 事件（localApi 在 401 时广播）：整页跳转登录页，
//   彻底清空内存状态，防止上个会话的数据残留
import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { getToken } from '@/shared/services/authService'

export default function RequireAuth() {
  useEffect(() => {
    const handleUnauthorized = () => {
      // 整页跳转而非 navigate：同步清空 zustand store 等全部内存状态
      window.location.assign('/login')
    }
    window.addEventListener('ydxl:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('ydxl:unauthorized', handleUnauthorized)
  }, [])

  if (!getToken()) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
