// 紧凑列表展示最近已读文章，支持「查看全部」跳转 /history 与「展开更多」分页加载
// 每条点击跳转 /reading?articleId=xxx
import { useNavigate } from 'react-router-dom'
import type { RecentlyReadArticle } from '@/features/reading/services/articleService'
import { TOPIC_LABEL, DIFFICULTY_LABEL, DIFFICULTY_STYLE } from '@/features/reading/types'
import { useTranslation, type TranslateFn } from '@/shared/i18n/useTranslation'

interface RecentlyReadSectionProps {
  articles: RecentlyReadArticle[]
  onLoadMore: () => void
  loading: boolean
  hasMore: boolean
}

// 一分钟 / 一小时 / 一天的毫秒数
const ONE_MINUTE = 60 * 1000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

/**
 * 计算相对时间文案（与 ReadingHistorySection 保持一致，文案通过传入的 t() 翻译）
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

export default function RecentlyReadSection({
  articles,
  onLoadMore,
  loading,
  hasMore,
}: RecentlyReadSectionProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  // 空状态：无阅读记录时不渲染该区块（由父组件控制是否挂载）
  if (articles.length === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('dashboard.recent_reading')}
        </h2>
        {/* 查看全部：跳转到 /history 历史页 */}
        <button
          type="button"
          onClick={() => navigate('/history')}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          {t('dashboard.view_all')}
        </button>
      </div>

      {/* 紧凑列表：每条显示标题（截断）+ 相对时间 + 题材/难度徽章 */}
      <ul className="space-y-1">
        {articles.map((article) => {
          // 题材/难度文案走字典翻译；未知取值保持原样展示（与迁移前行为一致）
          const topicLabel = article.topic
            ? TOPIC_LABEL[article.topic]
              ? t(`reading.topic.${article.topic}`)
              : article.topic
            : null
          const difficultyLabel = article.difficulty
            ? DIFFICULTY_LABEL[article.difficulty]
              ? t(`reading.difficulty.${article.difficulty}`)
              : null
            : null
          const difficultyStyle = article.difficulty ? DIFFICULTY_STYLE[article.difficulty] : ''
          return (
            <li key={article.id}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/reading?articleId=${encodeURIComponent(article.id)}`)
                }
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                {/* 标题（截断单行） */}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {article.title}
                </span>
                {/* 题材徽章 */}
                {topicLabel && (
                  <span className="flex-shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {topicLabel}
                  </span>
                )}
                {/* 难度徽章 */}
                {difficultyLabel && difficultyStyle && (
                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${difficultyStyle}`}>
                    {difficultyLabel}
                  </span>
                )}
                {/* 阅读时间（相对时间） */}
                <time className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  {formatRelativeTime(article.readAt, t)}
                </time>
              </button>
            </li>
          )
        })}
      </ul>

      {/* 展开更多：默认折叠为最近 5 篇，点击加载后续 5 篇 */}
      {hasMore && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-indigo-400"
          >
            {loading ? t('loading.default') : t('dashboard.expand_more')}
          </button>
        </div>
      )}
    </section>
  )
}
