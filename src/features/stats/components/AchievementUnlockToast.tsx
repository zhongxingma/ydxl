// 成就解锁 Toast 组件
// - 接收 achievements 列表与 onClose 回调
// - 显示在屏幕顶部居中，每个成就以卡片形式展示：icon + 名称 + 描述
// - 使用 TailwindCSS 滑入动画（translate-y 从 -100 到 0）
// - 3 秒后自动调用 onClose
import { useEffect, useRef } from 'react'
import type { Achievement } from '@/shared/types'

export interface AchievementUnlockToastProps {
  achievements: Achievement[]
  onClose: () => void
}

// 单个成就卡片
function AchievementCard({ achievement }: { achievement: Achievement }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-4 py-3 shadow-lg dark:border-amber-700 dark:bg-gray-800">
      <span className="text-3xl" aria-hidden>
        {achievement.icon}
      </span>
      <div className="flex flex-col">
        <span className="text-xs text-amber-600 dark:text-amber-400">成就解锁</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {achievement.name}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {achievement.description}
        </span>
      </div>
    </div>
  )
}

export default function AchievementUnlockToast({
  achievements,
  onClose,
}: AchievementUnlockToastProps) {
  // 通过 ref 持有最新的 onClose，避免回调变化导致定时器重置
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (achievements.length === 0) return
    // 3 秒后自动关闭
    const timer = window.setTimeout(() => {
      onCloseRef.current()
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [achievements.length])

  if (achievements.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-4">
      {/* 入场动画：从顶部滑入 */}
      <style>{`
        @keyframes achievement-toast-slide-in {
          0% { transform: translateY(-100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      {achievements.map((a) => (
        <div
          key={a.id}
          className="w-full max-w-md"
          style={{
            animation: 'achievement-toast-slide-in 0.4s ease-out forwards',
          }}
        >
          <AchievementCard achievement={a} />
        </div>
      ))}
    </div>
  )
}
