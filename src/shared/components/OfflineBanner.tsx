// 离线状态横幅组件
// - 仅在断网时渲染，固定在顶部，黄色背景提示用户
// - 网络恢复后自动消失（useOnlineStatus 内部还会触发所有 repository 刷新）
// - 无障碍：role="status" + aria-live="polite" 让屏幕阅读器友好播报状态变化
import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus'

/**
 * 离线状态横幅。仅在断网时渲染，固定在顶部，黄色背景提示用户。
 * 网络恢复后自动消失。
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus()
  if (isOnline) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 w-full bg-yellow-500 px-4 py-2 text-center text-sm font-medium text-yellow-950 shadow-md"
    >
      当前处于离线模式，显示的数据可能不是最新
    </div>
  )
}
