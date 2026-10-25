// 复习进度条：sticky 顶部，参考 ReadingPage 阅读进度条样式
import { cn } from '@/shared/utils/cn'

interface ReviewProgressHeaderProps {
  sessionReviewedCount: number
  initialTotal: number
  reviewProgress: number
  isReviewComplete: boolean
  stageLabel: string
}

export default function ReviewProgressHeader({
  sessionReviewedCount,
  initialTotal,
  reviewProgress,
  isReviewComplete,
  stageLabel,
}: ReviewProgressHeaderProps) {
  return (
    <header className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {isReviewComplete
            ? '今日复习已完成 🎉'
            : `已复习 ${sessionReviewedCount} / ${initialTotal} · ${reviewProgress}%`}
        </span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {stageLabel}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuenow={sessionReviewedCount}
        aria-valuemin={0}
        aria-valuemax={initialTotal}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isReviewComplete
              ? 'bg-gradient-to-r from-emerald-500 to-green-500 dark:from-emerald-400 dark:to-green-400'
              : 'bg-gradient-to-r from-blue-500 to-indigo-500 dark:from-blue-400 dark:to-indigo-400'
          )}
          style={{ width: `${reviewProgress}%` }}
        />
      </div>
    </header>
  )
}
