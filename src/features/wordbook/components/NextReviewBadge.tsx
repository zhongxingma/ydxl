// 下次复习时间徽章：区分今日 / 已逾期 / 未来 X 天后
import type { TranslateFn } from '@/shared/i18n/useTranslation'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'

interface NextReviewBadgeProps {
  // 下次复习时间戳（毫秒）
  nextReview: number
  className?: string
}

// 一天的毫秒数
const DAY_MS = 24 * 60 * 60 * 1000

// 计算下次复习的相对时间描述与状态（文案通过传入的 t() 翻译）
function getReviewStatus(nextReview: number, t: TranslateFn): {
  label: string
  tone: 'overdue' | 'today' | 'future'
} {
  const now = Date.now()
  if (nextReview <= now) {
    return { label: t('wordbook.next_review.overdue'), tone: 'overdue' }
  }

  // 按日历天计算差值（忽略同日内的小时差异）
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const reviewDayStart = new Date(nextReview)
  reviewDayStart.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((reviewDayStart.getTime() - todayStart.getTime()) / DAY_MS)

  if (dayDiff <= 0) {
    return { label: t('wordbook.next_review.today'), tone: 'today' }
  }
  return { label: t('wordbook.next_review.in_days', { days: dayDiff }), tone: 'future' }
}

export default function NextReviewBadge({ nextReview, className }: NextReviewBadgeProps) {
  const { t } = useTranslation()
  const { label, tone } = getReviewStatus(nextReview, t)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'overdue' &&
          'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
        tone === 'today' &&
          'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
        tone === 'future' &&
          'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
        className,
      )}
    >
      {label}
    </span>
  )
}
