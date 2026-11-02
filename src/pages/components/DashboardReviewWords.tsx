// 今日需复习单词列表（最多 5 个），点击「查看全部」进入复习页
import type { Word } from '@/shared/types'
import { isOverdue } from '@/features/review'
import { useTranslation } from '@/shared/i18n/useTranslation'

interface DashboardReviewWordsProps {
  words: Word[]
  onViewAll: () => void
}

export default function DashboardReviewWords({ words, onViewAll }: DashboardReviewWordsProps) {
  const { t } = useTranslation()
  if (words.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t('review.session.complete_title')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.today_review_words')}</h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          {t('dashboard.view_all')}
        </button>
      </div>
      <ul className="space-y-2">
        {words.map((w) => {
          const overdue = isOverdue(w)
          return (
            <li
              key={w.id}
              className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {overdue && (
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500"
                    title={t('review.overdue.badge')}
                  />
                )}
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {w.word}
                </span>
                {w.phonetic && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {w.phonetic}
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400 truncate ml-2">
                {w.definition || w.pos || ''}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
