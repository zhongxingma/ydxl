// "我的"页面统计卡片：展示单个累计指标（数字 + 标签 + 图标）
import type { ReactNode } from 'react'
import { cn } from '@/shared/utils/cn'

interface StatCardProps {
  // 标签文案
  label: string
  // 主数值（数字或字符串）
  value: number | string
  // 单位（可选，如 "篇" "词" "小时"）
  unit?: string
  // 图标节点
  icon: ReactNode
  // 强调色 tailwind 类名，如 'text-indigo-600 dark:text-indigo-400'
  color: string
}

export default function StatCard({ label, value, unit, icon, color }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
        <span className={cn('shrink-0', color)}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">{unit}</span>
        )}
      </p>
    </div>
  )
}
