// 复习进度条
// - 显示已复习 / 总数
// - 进度条按比例填充
import { cn } from '@/shared/utils/cn'

interface ProgressBarProps {
  // 已复习数量
  reviewedCount: number
  // 总数
  totalCount: number
  // 额外类名
  className?: string
}

export default function ProgressBar({ reviewedCount, totalCount, className }: ProgressBarProps) {
  const percent = totalCount > 0 ? Math.min(100, Math.round((reviewedCount / totalCount) * 100)) : 0

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          复习进度
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {reviewedCount} / {totalCount}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300 dark:from-blue-400 dark:to-indigo-400"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={reviewedCount}
          aria-valuemin={0}
          aria-valuemax={totalCount}
        />
      </div>
    </div>
  )
}
