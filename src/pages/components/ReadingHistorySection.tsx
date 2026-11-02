// 展示用户已读完或已开始阅读的文章卡片网格，支持「查看更多」分页加载
// 卡片点击跳转 /reading?articleId=<articleId>
import { useNavigate } from 'react-router-dom'
import type { Article, Genre } from '@/shared/types'
import { useTranslation, type TranslateFn } from '@/shared/i18n/useTranslation'

interface ReadingHistorySectionProps {
  articles: Article[]
  onLoadMore: () => void
  loading: boolean
  hasMore: boolean
}

const GENRE_EMOJI: Record<Genre, string> = {
  narrative: '📖',
  expository: '🔬',
  practical: '📝',
  argumentative: '🎯',
}

// 一分钟 / 一小时 / 一天的毫秒数
const ONE_MINUTE = 60 * 1000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

/**
 * 计算相对时间文案（避免引入新依赖，文案通过传入的 t() 翻译）
 * - < 1 分钟：「刚刚」
 * - < 1 小时：「X 分钟前」
 * - < 24 小时：「X 小时前」
 * - < 48 小时：「昨天」
 * - < 7 天：「X 天前」
 * - 否则：YYYY-MM-DD
 */
function formatRelativeTime(timestamp: number, t: TranslateFn): string {
  const now = Date.now()
  const diff = now - timestamp
  if (diff < ONE_MINUTE) return t('reading.history.just_now')
  if (diff < ONE_HOUR) return t('reading.history.minutes_ago', { count: Math.floor(diff / ONE_MINUTE) })
  if (diff < ONE_DAY) return t('reading.history.hours_ago', { count: Math.floor(diff / ONE_HOUR) })
  if (diff < 2 * ONE_DAY) return t('reading.history.yesterday')
  if (diff < 7 * ONE_DAY) return t('reading.history.days_ago', { count: Math.floor(diff / ONE_DAY) })
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function ReadingHistorySection({
  articles,
  onLoadMore,
  loading,
  hasMore,
}: ReadingHistorySectionProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  // 空状态：无阅读记录时引导用户开始阅读
  if (articles.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.history_title')}</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('reading.history.subtitle')}</p>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-3 text-4xl">📚</div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.no_history')}
          </p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {t('button.start_reading')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.history_title')}</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('reading.history.subtitle')}</p>
        </div>
      </div>

      {/* 文章卡片网格：移动端 1 列 / 平板 2 列 / 桌面 3 列 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => {
          // 阅读状态：已读完 / 阅读中
          const isFinished = article.readAt != null
          const isReading = article.startedAt != null && article.readAt == null
          // 用于显示相对时间的时间戳：优先 readAt，其次 startedAt，最后 createdAt
          const relTime = article.readAt ?? article.startedAt ?? article.createdAt
          return (
            <button
              key={article.id}
              type="button"
              onClick={() => navigate(`/reading?articleId=${encodeURIComponent(article.id)}`)}
              className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
            >
              {/* 体裁 emoji + 标题（截断 2 行） */}
              <div className="flex items-start gap-2">
                <span className="text-xl leading-6" aria-hidden>
                  {GENRE_EMOJI[article.genre] ?? '📄'}
                </span>
                <h3 className="line-clamp-2 flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {article.title}
                </h3>
              </div>
              {/* 相对时间 + 阅读状态徽章 */}
              <div className="mt-3 flex items-center justify-between">
                <time className="text-xs text-gray-500 dark:text-gray-400">
                  {formatRelativeTime(relTime, t)}
                </time>
                {isFinished && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {t('reading.history.finished')}
                  </span>
                )}
                {isReading && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {t('reading.history.reading')}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* 查看更多按钮：无更多数据时隐藏；加载中显示「加载中...」并禁用 */}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {loading ? t('loading.default') : t('dashboard.load_more')}
          </button>
        </div>
      )}
    </section>
  )
}
