// 监听浏览器在线/离线状态的 React Hook
// - 初始值取 navigator.onLine（SSR/测试环境下安全降级为 true）
// - 监听 window 的 online / offline 事件实时更新状态
// - 网络恢复时（offline → online）自动调用所有 CachedRemoteRepository 的 triggerRefresh()
//   同步离线期间可能被其他端修改的数据（fire-and-forget，不阻塞 UI）
//
// 使用示例：
//   const isOnline = useOnlineStatus()
//   if (!isOnline) { ... }
import { useEffect, useRef, useState } from 'react'
import {
  articleRepository,
  wordRepository,
  questionRepository,
  reviewRepository,
  statsRepository,
  readingSessionRepository,
  achievementRepository,
} from '@/shared/services'

/**
 * 监听浏览器在线/离线状态。
 * - 初始值取 navigator.onLine
 * - 监听 window 的 online / offline 事件
 * - 网络恢复时（offline → online）自动调用所有 repository 的 triggerRefresh()
 *   同步离线期间可能被其他端修改的数据
 *
 * @returns 当前是否在线（true 表示在线）
 */
export function useOnlineStatus(): boolean {
  // SSR 或测试环境下 navigator 可能未定义，安全降级为 true（避免误报离线）
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  // 用 ref 保存最新状态，事件 handler 中可读取最新值判断是否为 offline→online 切换
  const isOnlineRef = useRef(isOnline)
  isOnlineRef.current = isOnline

  useEffect(() => {
    const handleOnline = () => {
      // 仅在从离线切换到在线时触发 repository 刷新，避免重复刷新
      // （初始就在线时不会触发，因为 ref 初值与 navigator.onLine 一致）
      const wasOffline = !isOnlineRef.current
      setIsOnline(true)
      if (wasOffline) {
        // 网络恢复时触发所有 repository 后台刷新（fire-and-forget，不阻塞）
        // 同步离线期间可能被其他端修改的数据
        const repositories = [
          articleRepository,
          wordRepository,
          questionRepository,
          reviewRepository,
          statsRepository,
          readingSessionRepository,
          achievementRepository,
        ]
        repositories.forEach((repo) => {
          if (typeof repo.triggerRefresh === 'function') {
            repo.triggerRefresh()
          }
        })
      }
    }
    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
    // 仅在挂载时注册一次；isOnline 通过 setState 更新，handler 通过 ref 读取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return isOnline
}
