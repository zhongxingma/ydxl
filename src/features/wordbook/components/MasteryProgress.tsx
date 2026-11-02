// 掌握进度组件：用 5 个圆点展示 mastery（0-5）的掌握程度
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'

interface MasteryProgressProps {
  // 掌握程度 0-5
  mastery: number
  className?: string
}

// 最大掌握度
const MAX_MASTERY = 5

export default function MasteryProgress({ mastery, className }: MasteryProgressProps) {
  const { t } = useTranslation()
  // 限制在 0-5 之间
  const level = Math.max(0, Math.min(MAX_MASTERY, mastery))

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      aria-label={t('wordbook.mastery.label', { level, max: MAX_MASTERY })}
    >
      {Array.from({ length: MAX_MASTERY }).map((_, i) => {
        const filled = i < level
        return (
          <span
            key={i}
            className={cn(
              'h-2 w-2 rounded-full transition-colors',
              filled
                ? level >= 5
                  ? 'bg-green-500 dark:bg-green-400'
                  : level >= 3
                    ? 'bg-indigo-500 dark:bg-indigo-400'
                    : 'bg-amber-500 dark:bg-amber-400'
                : 'bg-gray-200 dark:bg-gray-600',
            )}
          />
        )
      })}
    </div>
  )
}
