// 批量加入生词本浮层内容
// 在用户划选多个单词时显示，提供"批量加入生词本"按钮与结果反馈
import clsx from 'clsx'
import { useTranslation } from '@/shared/i18n/useTranslation'

interface BatchActionBarProps {
  words: string[]
  processing: boolean
  result: { added: number; failed: number } | null
  onAdd: () => void
}

export default function BatchActionBar({ words, processing, result, onAdd }: BatchActionBarProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {t('reading.batch.title')}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('reading.batch.selected', { count: words.length })}
      </p>
      <div className="flex flex-wrap gap-1">
        {words.slice(0, 8).map((w, i) => (
          <span
            key={i}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
          >
            {w}
          </span>
        ))}
        {words.length > 8 && (
          <span className="text-xs text-gray-400">+{words.length - 8}</span>
        )}
      </div>
      {result ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          {t('reading.batch.result', { added: result.added, failed: result.failed })}
        </p>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={processing}
          className={clsx(
            'w-full rounded px-3 py-1.5 text-xs font-medium transition-colors',
            processing
              ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
          )}
        >
          {processing ? t('reading.batch.adding') : t('reading.batch.add', { count: words.length })}
        </button>
      )}
    </div>
  )
}
