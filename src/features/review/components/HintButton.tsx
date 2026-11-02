// 提示按钮组件
// - 默认蓝色，点击后变灰（hintShown=true）
// - 点击触发 onShowHint 回调
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'

interface HintButtonProps {
  // 点击回调
  onShowHint: () => void
  // 是否已显示提示
  hintShown: boolean
  // 按钮文案，默认"显示提示"
  label?: string
  // 额外类名
  className?: string
}

export default function HintButton({
  onShowHint,
  hintShown,
  label,
  className,
}: HintButtonProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onShowHint}
      disabled={hintShown}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        hintShown
          ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
          : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600',
        className,
      )}
    >
      {/* 灯泡图标 */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
        />
      </svg>
      {hintShown ? t('review.hint.shown') : (label ?? t('review.hint.show'))}
    </button>
  )
}
