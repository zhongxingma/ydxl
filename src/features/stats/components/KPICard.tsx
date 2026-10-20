// KPI 卡片组件：展示单个统计指标
import type { ReactNode } from 'react'
import { cn } from '@/shared/utils/cn'

interface KPICardProps {
  title: string
  value: number | string
  icon: ReactNode
  // 强调色 tailwind 类名，如 'text-amber-600 dark:text-amber-400'
  color: string
}

export default function KPICard({ title, value, icon, color }: KPICardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className={cn('mt-1 truncate text-2xl font-bold', color)}>{value}</p>
        </div>
        <div className={cn('ml-3 shrink-0', color)}>{icon}</div>
      </div>
    </div>
  )
}
