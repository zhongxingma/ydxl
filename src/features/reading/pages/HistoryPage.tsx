// 分页展示所有已读/已开始阅读的文章，点击跳转 /reading?articleId=xxx
// 数据来源：articleService.getReadHistory(limit, offset)
// SWR 模式：articleService.getReadHistory 内部使用 getAllLocalFirst，
//          本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本页面重载
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { articleService } from '../services/articleService'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import VirtualList from '@/shared/components/VirtualList'
import type { TranslateFn } from '@/shared/i18n/useTranslation'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { TOPIC_LABEL, DIFFICULTY_LABEL, DIFFICULTY_STYLE } from '../types'
import type { Article, Genre } from '@/shared/types'

// 历史页每页加载条数
const HISTORY_PAGE_SIZE = 10

// 虚拟滚动：行高估算（标题 + 元信息两行，约 68px）
const HISTORY_ROW_HEIGHT = 68
// 虚拟滚动：行唯一键（文章 id）
const getArticleKey = (article: Article) => article.id

// 体裁 emoji 映射（与 ReadingHistorySection 一致）
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
 * 计算相对时间文案（与 ReadingHistorySection 保持一致）
 */
function formatRelativeTime(timestamp: number, t: TranslateFn): string {
  const now = Date.now()
  const diff = now - timestamp
  if (diff < ONE_MINUTE) return t('reading.history.just_now')
  if (diff < ONE_HOUR)
    return t('reading.history.minutes_ago', { count: Math.floor(diff / ONE_MINUTE) })
  if (diff < ONE_DAY)
    return t('reading.history.hours_ago', { count: Math.floor(diff / ONE_HOUR) })
  if (diff < 2 * ONE_DAY) return t('reading.history.yesterday')
  if (diff < 7 * ONE_DAY)
    return t('reading.history.days_ago', { count: Math.floor(diff / ONE_DAY) })
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function HistoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)

  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  // 加载历史数据（从 offset=0 开始加载指定数量）
  // SWR 模式：本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本页面重载
  // limit 参数：初次挂载使用 HISTORY_PAGE_SIZE；缓存事件回调时传入当前已加载数量以保持分页位置
  const loadHistory = useCallback(async (limit: number = HISTORY_PAGE_SIZE) => {
    try {
      const history = await articleService.getReadHistory(limit, 0)
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      setArticles(history)
      // 返回数量 === 请求 limit 时认为可能还有更多
      setHasMore(history.length === limit)
    } catch (err) {
      logger.warn('[HistoryPage] 加载历史失败', err)
    } finally {
      // 组件已卸载则放弃更新
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // 首次挂载加载第一页历史数据
  useEffect(() => {
    mountedRef.current = true
    void loadHistory()
    return () => {
      mountedRef.current = false
    }
  }, [loadHistory])

  // 订阅 articles 缓存事件：articleService 后台刷新完成后重载历史列表
  // 保持当前已加载位置（重载与当前 articles.length 等量的数据），避免「加载更多」进度丢失
  // useCacheInvalidated 内部用 ref 透传最新 callback，此处闭包捕获的 articles.length 始终为最新值
  useCacheInvalidated('articles', () => {
    void loadHistory(Math.max(articles.length, HISTORY_PAGE_SIZE))
  })

  // 加载更多：追加下一页
  const handleLoadMore = async () => {
    setLoading(true)
    try {
      const more = await articleService.getReadHistory(
        HISTORY_PAGE_SIZE,
        articles.length,
      )
      setArticles((prev) => [...prev, ...more])
      setHasMore(more.length === HISTORY_PAGE_SIZE)
    } catch (err) {
      logger.warn('[HistoryPage] 加载更多失败', err)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('reading.history.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('reading.history.subtitle')}
        </p>
      </div>

      {/* 空状态 */}
      {!loading && articles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm dark:border-gray-600 dark:bg-gray-800">
          <div className="mb-3 text-4xl">📚</div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {t('reading.history.empty')}
          </p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {t('reading.start')}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {/* 文章列表：窗口化虚拟滚动，仅渲染视口内行，DOM 量与历史条数解耦 */}
          <VirtualList
            rows={articles}
            getKey={getArticleKey}
            estimateRowHeight={HISTORY_ROW_HEIGHT}
            renderRow={(article, index) => {
              const isFinished = article.readAt != null
              const isReading = article.startedAt != null && article.readAt == null
              const relTime = article.readAt ?? article.startedAt ?? article.createdAt
              const topicLabel = article.topic
                ? TOPIC_LABEL[article.topic]
                  ? t(`reading.topic.${article.topic}`)
                  : article.topic
                : null
              const difficultyLabel = article.difficulty
                ? DIFFICULTY_LABEL[article.difficulty]
                  ? t(`reading.difficulty.${article.difficulty}`)
                  : article.difficulty
                : null
              const difficultyStyle = article.difficulty ? DIFFICULTY_STYLE[article.difficulty] : ''
              return (
                <div
                  className={
                    index < articles.length - 1
                      ? 'border-b border-gray-100 dark:border-gray-700'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/reading?articleId=${encodeURIComponent(article.id)}`)
                    }
                    className="flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    {/* 体裁 emoji */}
                    <span className="text-xl flex-shrink-0" aria-hidden>
                      {GENRE_EMOJI[article.genre] ?? '📄'}
                    </span>
                    {/* 标题 + 元信息 */}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {article.title}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        {topicLabel && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                            {topicLabel}
                          </span>
                        )}
                        {difficultyLabel && difficultyStyle && (
                          <span className={`rounded px-1.5 py-0.5 font-medium ${difficultyStyle}`}>
                            {difficultyLabel}
                          </span>
                        )}
                        <span className="text-gray-500 dark:text-gray-400">
                          {t('reading.words_count', { count: article.wordCount })}
                        </span>
                        {isFinished && (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            {t('reading.history.finished')}
                          </span>
                        )}
                        {isReading && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            {t('reading.history.reading')}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 相对时间 */}
                    <time className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(relTime, t)}
                    </time>
                  </button>
                </div>
              )
            }}
          />

          {/* 加载更多 */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {loading ? t('reading.loading') : t('reading.load_more')}
              </button>
            </div>
          )}

          {/* 加载中骨架（首次加载） */}
          {loading && articles.length === 0 && (
            <div className="space-y-3 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
