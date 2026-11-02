// 5 步骤导航条
// - 已完成：绿色
// - 当前：高亮（蓝色 + 描边）
// - 已解锁但未完成：默认色
// - 未解锁：灰色
// - 点击已解锁的步骤可切换（仅 unlockedSteps 中的步骤可点击）
import type { ReviewStep } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'
import { STEP_ORDER } from '../types'

interface StepIndicatorProps {
  // 当前步骤
  currentStep: ReviewStep | null
  // 已解锁步骤
  unlockedSteps: Set<ReviewStep>
  // 已完成步骤
  completedSteps: Set<ReviewStep>
  // 切换步骤回调（仅解锁的步骤可点击）
  onGoToStep: (step: ReviewStep) => void
  // 额外类名
  className?: string
}

export default function StepIndicator({
  currentStep,
  unlockedSteps,
  completedSteps,
  onGoToStep,
  className,
}: StepIndicatorProps) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('review.steps.nav_label')}
      className={cn('flex items-center justify-center gap-2', className)}
    >
      {STEP_ORDER.map((step, idx) => {
        const isCurrent = step === currentStep
        const isCompleted = completedSteps.has(step)
        const isUnlocked = unlockedSteps.has(step)
        const isLocked = !isUnlocked

        return (
          <div key={step} className="flex items-center">
            {/* 步骤圆点 */}
            <button
              type="button"
              onClick={() => isUnlocked && onGoToStep(step)}
              disabled={isLocked}
              title={t(`review.step.${step}`)}
              aria-label={t('review.steps.item_aria', {
                index: idx + 1,
                step: t(`review.step.${step}`),
                status: isCompleted
                  ? t('review.steps.status_completed')
                  : isCurrent
                    ? t('review.steps.status_current')
                    : isLocked
                      ? t('review.steps.status_locked')
                      : '',
              })}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-all',
                isCurrent &&
                  'border-2 border-blue-500 bg-blue-600 text-white shadow-md dark:border-blue-400 dark:bg-blue-500',
                !isCurrent && isCompleted &&
                  'bg-green-500 text-white hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500',
                !isCurrent && !isCompleted && isUnlocked &&
                  'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-700',
                isLocked && 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
              )}
            >
              {isCompleted ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                idx + 1
              )}
            </button>

            {/* 步骤标签（桌面端显示） */}
            <span
              className={cn(
                'ml-1.5 hidden text-xs sm:inline',
                isCurrent ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400',
              )}
            >
              {t(`review.step.${step}`)}
            </span>

            {/* 连接线 */}
            {idx < STEP_ORDER.length - 1 && (
              <div
                className={cn(
                  'mx-2 h-0.5 w-6 sm:w-10',
                  isCompleted ? 'bg-green-400 dark:bg-green-500' : 'bg-gray-200 dark:bg-gray-700',
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
