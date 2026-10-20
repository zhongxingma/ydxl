// 仪表盘数据统计卡片：图标 + 数值 + 进度条 + 提示 + 逾期红点
// 与 profile 模块的 StatCard 接口不兼容（accent vs color，且包含进度条/提示/红点），
// 因此独立抽取为 DashboardStatCard，专供 DashboardPage 使用
import type { ReactNode } from 'react'

interface DashboardStatCardProps {
  // 标签文案
  label: string
  // 主数值
  value: number
  // 单位（可选，如 "天" "/ 5 篇"）
  unit?: string
  // 图标节点
  icon: ReactNode
  // 强调色 tailwind 类名，如 'text-amber-600 dark:text-amber-400'
  accent: string
  // 进度条数值（0-1），可选
  progress?: number
  // 提示文案（可选）
  hint?: string
  // 是否显示逾期红点提醒
  showRedDot?: boolean
}

export default function DashboardStatCard({
  label,
  value,
  unit,
  icon,
  accent,
  progress,
  hint,
  showRedDot,
}: DashboardStatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={accent}>{icon}</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
        </div>
        {/* 逾期红点提醒 */}
        {showRedDot && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">{unit}</span>}
      </p>
      {/* 进度条 */}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-current transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  )
}
