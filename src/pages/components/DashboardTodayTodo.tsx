// 今日待办：阅读 / 复习完成状态，以及逾期复习提醒
import { BookOpen, CheckIcon, RefreshCw, WarningIcon } from '@/shared/components/icons'
import { cn } from '@/shared/utils/cn'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { DashboardData } from '../hooks/useDashboardOverview'

interface DashboardTodayTodoProps {
  data: DashboardData
  goalArticles: number
  goalWords: number
  onStartReading: () => void
  onStartReview: () => void
}

export default function DashboardTodayTodo({
  data,
  goalArticles,
  goalWords,
  onStartReading,
  onStartReview,
}: DashboardTodayTodoProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.today_todo')}</h2>
      <div className="space-y-2">
        {/* 今日阅读 */}
        <div
          className={cn(
            'flex items-center justify-between rounded-md px-3 py-2',
            data.todayArticlesRead >= goalArticles
              ? 'bg-green-50 dark:bg-green-900/20'
              : 'bg-orange-50 dark:bg-orange-900/20',
          )}
        >
          <div className="flex items-center gap-2">
            {data.todayArticlesRead >= goalArticles ? (
              <CheckIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <BookOpen className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            )}
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('dashboard.today_articles')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {data.todayArticlesRead}/{goalArticles} {t('dashboard.unit.articles')}
            </span>
            <button
              type="button"
              onClick={onStartReading}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {t('button.start_reading')}
            </button>
          </div>
        </div>

        {/* 今日复习 */}
        <div
          className={cn(
            'flex items-center justify-between rounded-md px-3 py-2',
            data.todayWordsReviewed >= goalWords
              ? 'bg-green-50 dark:bg-green-900/20'
              : 'bg-orange-50 dark:bg-orange-900/20',
          )}
        >
          <div className="flex items-center gap-2">
            {data.todayWordsReviewed >= goalWords ? (
              <CheckIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <RefreshCw className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            )}
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('dashboard.today_words')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.reviewed_pending', {
                reviewed: data.todayWordsReviewed,
                pending: data.pendingReview,
              })}{' '}
              {t('dashboard.unit.words')}
            </span>
            <button
              type="button"
              onClick={onStartReview}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {t('button.start_review')}
            </button>
          </div>
        </div>

        {/* 逾期复习（仅有逾期时显示） */}
        {data.overdueCount > 0 && (
          <div className="flex items-center justify-between rounded-md bg-red-50 px-3 py-2 dark:bg-red-900/20">
            <div className="flex items-center gap-2">
              <WarningIcon className="h-5 w-5 text-red-600 dark:text-red-400" />
              <span className="text-sm text-red-700 dark:text-red-400">{t('dashboard.overdue_review')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                {data.overdueCount} {t('dashboard.unit.words')}
              </span>
              <button
                type="button"
                onClick={onStartReview}
                className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-700 dark:text-red-400 dark:hover:bg-gray-600"
              >
                {t('dashboard.go_review')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
