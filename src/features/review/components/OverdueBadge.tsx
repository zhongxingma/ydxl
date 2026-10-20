// 逾期徽章组件
// - 红点徽章，提示该单词已逾期超过 1 天
// - 可在 WordCard / 列表项中复用
import { cn } from '@/shared/utils/cn'

interface OverdueBadgeProps {
  // 是否显示（通常由 isOverdue(word) 计算）
  show: boolean
  // 可选的自定义文案，默认"逾期"
  label?: string
  // 额外类名
  className?: string
}

export default function OverdueBadge({
  show,
  label = '逾期',
  className,
}: OverdueBadgeProps) {
  if (!show) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300',
        className,
      )}
      title="该单词已逾期，建议优先复习"
    >
      {/* 红点图标 */}
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 dark:bg-red-400"
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
