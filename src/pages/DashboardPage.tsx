// 首页仪表盘 - 连续打卡 + 今日目标进度 + 今日待办 + 历史阅读 + 相关推荐 + 阅读能力曲线 + 本周掌握单词
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, FlameIcon, RefreshCw } from '@/shared/components/icons'
import { cn } from '@/shared/utils/cn'
import {
  getSettings,
  statsRepository,
  reviewRepository,
  readingSessionRepository,
} from '@/shared/services'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { statsService } from '@/features/stats'
import { reviewService, isOverdue } from '@/features/review'
import { getDateNDaysAgo } from '@/features/stats'
import { articleService } from '@/features/reading/services/articleService'
import type { RecentlyReadArticle } from '@/features/reading/services/articleService'
import { getRecommendedArticles } from '@/features/reading/services/recommendationService'
import AddArticleModal from '@/features/reading/components/AddArticleModal'
import ImportArticlesModal from '@/features/reading/components/ImportArticlesModal'
import type { Article, Word } from '@/shared/types'
import type { ReadingAbilityTrendPoint } from '@/features/stats'
import DashboardStatCard from './components/DashboardStatCard'
import ReadingHistorySection from './components/ReadingHistorySection'
import RecentlyReadSection from './components/RecentlyReadSection'
import RelatedArticlesSection from './components/RelatedArticlesSection'
import { useTranslation } from '@/shared/i18n/useTranslation'

// 历史阅读每页加载条数
const HISTORY_PAGE_SIZE = 6
// 推荐文章加载条数
const RECOMMENDED_LIMIT = 6
const RECENTLY_READ_PAGE_SIZE = 5

// 阅读能力曲线图表懒加载：recharts 体积较大（~408KB），
// 仅在 Dashboard 有阅读数据时才动态导入，避免首屏加载时下载 recharts。
// 项目约束：仅在有数据时才渲染图表（条件渲染位于 Suspense 外层，空状态不会触发动态加载）
const ReadingGrowthChart = lazy(() => import('@/features/stats/components/ReadingGrowthChart'))

// 仪表盘聚合数据
interface DashboardData {
  // 连续打卡天数
  streak: number
  // 今日已读篇数
  todayArticlesRead: number
  // 今日已复习单词数
  todayWordsReviewed: number
  // 待复习单词总数（截断前）
  pendingReview: number
  // 逾期单词数（nextReview 早于 now - 24h）
  overdueCount: number
  // 已掌握单词总数
  totalWordsMastered: number
  // 最近 30 天阅读能力增长曲线数据点（已按日聚合）
  readingTrend: ReadingAbilityTrendPoint[]
  // 本周（最近 7 天）掌握单词数
  weekMastered: number
  // 上周（7-13 天前）掌握单词数，用于趋势对比
  lastWeekMastered: number
}

// 上升趋势图标
function TrendUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
      />
    </svg>
  )
}

// 下降趋势图标
function TrendDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.358-1.359m-3.358 1.359L18 21"
      />
    </svg>
  )
}

// 完成图标 - 待办已完成
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// 警告图标 - 逾期提醒
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const [historyArticles, setHistoryArticles] = useState<Article[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyHasMore, setHistoryHasMore] = useState(false)

  const [recentlyReadArticles, setRecentlyReadArticles] = useState<RecentlyReadArticle[]>([])
  const [recentlyReadLoading, setRecentlyReadLoading] = useState(true)
  const [recentlyReadHasMore, setRecentlyReadHasMore] = useState(false)

  const [recommendedArticles, setRecommendedArticles] = useState<Article[]>([])
  const [recommendedLoading, setRecommendedLoading] = useState(true)

  const [addArticleModalOpen, setAddArticleModalOpen] = useState(false)
  const [importArticlesModalOpen, setImportArticlesModalOpen] = useState(false)

  // 今日需复习单词列表（前 5 个）
  const [todayReviewWords, setTodayReviewWords] = useState<Word[]>([])

  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  // 异步加载仪表盘概览数据：并行查询统计概览、复习队列、阅读会话、本周与上周 stats
  // SWR 模式：不再主动 refreshFromServer articles/words（由 service 层 getAllLocalFirst 触发后台刷新）；
  //          stats/review/readingSession 仍主动 refresh 以保证跨终端数据一致性
  const loadOverview = useCallback(async () => {
    const [overview, reviewInfo, readingTrend, weekStats, lastWeekStats] = await Promise.all([
      statsService.getStatsOverview(),
      reviewService.getTodayReviewQueueInfo(),
      statsService.getReadingAbilityTrend(30),
      statsService.getStatsByDateRange(getDateNDaysAgo(6), getDateNDaysAgo(0)),
      statsService.getStatsByDateRange(getDateNDaysAgo(13), getDateNDaysAgo(7)),
    ])
    // 组件已卸载则放弃更新
    if (!mountedRef.current) return
    const weekMastered = weekStats.reduce((sum, s) => sum + s.wordsMastered, 0)
    const lastWeekMastered = lastWeekStats.reduce((sum, s) => sum + s.wordsMastered, 0)
    const overdueCount = reviewInfo.words.filter(isOverdue).length
    // 获取今日需复习的前 5 个单词（用于首页直接展示）
    const reviewWords = reviewInfo.words
      .slice()
      .sort((a, b) => a.nextReview - b.nextReview)
      .slice(0, 5)
    // 兜底：若 stats 服务的 todayArticlesRead 为 0，查询今日 readAt 文章数
    let todayArticlesRead = overview.todayArticlesRead
    if (todayArticlesRead === 0) {
      try {
        todayArticlesRead = await articleService.getTodayReadCount()
      } catch (err) {
        console.warn('[DashboardPage] getTodayReadCount 兜底查询失败', err)
      }
    }
    if (!mountedRef.current) return
    setData({
      streak: overview.currentStreak,
      todayArticlesRead,
      todayWordsReviewed: overview.todayWordsReviewed,
      pendingReview: reviewInfo.total,
      overdueCount,
      totalWordsMastered: overview.totalWordsMastered,
      readingTrend,
      weekMastered,
      lastWeekMastered,
    })
    setTodayReviewWords(reviewWords)
    setLoading(false)
  }, [])

  // 异步加载历史阅读记录、最近阅读与推荐文章（与主仪表盘数据并行加载，互不阻塞）
  // SWR 模式：articleService.getReadHistory / getRecentlyReadArticles 内部使用 getAllLocalFirst，
  //          本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本页面重载
  const loadArticles = useCallback(async () => {
    const [history, recentlyRead, recommended] = await Promise.all([
      articleService.getReadHistory(HISTORY_PAGE_SIZE, 0),
      articleService.getRecentlyReadArticles(RECENTLY_READ_PAGE_SIZE),
      getRecommendedArticles(RECOMMENDED_LIMIT),
    ])
    // 组件已卸载则放弃更新
    if (!mountedRef.current) return
    setHistoryArticles(history)
    // 返回数量 === 请求 limit 时认为可能还有更多
    setHistoryHasMore(history.length === HISTORY_PAGE_SIZE)
    setHistoryLoading(false)
    setRecentlyReadArticles(recentlyRead)
    // 已读文章数 > 当前展示数时认为还有更多可展开
    setRecentlyReadHasMore(recentlyRead.length === RECENTLY_READ_PAGE_SIZE)
    setRecentlyReadLoading(false)
    setRecommendedArticles(recommended)
    setRecommendedLoading(false)
  }, [])

  // 初次挂载：跨终端同步 stats/review/readingSession 后并行加载概览与文章数据
  // articles/words 不再主动 refreshFromServer（由 service 层 getAllLocalFirst 触发后台刷新）
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    const init = async () => {
      // 跨终端数据同步：仅刷新 stats/review/readingSession（articles/words 由 service 层 SWR 处理）
      await Promise.allSettled([
        statsRepository.refreshFromServer(),
        reviewRepository.refreshFromServer(),
        readingSessionRepository.refreshFromServer(),
      ])
      if (cancelled) return
      await Promise.all([loadOverview(), loadArticles()])
    }
    init().catch((err) => {
      console.warn('[DashboardPage] 加载概览数据失败', err)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      mountedRef.current = false
    }
    // 仅在路由切换时重新加载；loadOverview/loadArticles 为 useCallback 稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // 订阅 articles 缓存事件：articleService 后台刷新完成后重载文章相关数据
  useCacheInvalidated('articles', () => {
    void loadArticles()
  })

  // 订阅 words 缓存事件：wordRepository 后台刷新完成后重载概览数据（含复习队列）
  useCacheInvalidated('words', () => {
    void loadOverview()
  })

  // 「查看更多」：加载下一页历史阅读，追加到现有列表
  const handleLoadMoreHistory = async () => {
    setHistoryLoading(true)
    try {
      const more = await articleService.getReadHistory(HISTORY_PAGE_SIZE, historyArticles.length)
      setHistoryArticles((prev) => [...prev, ...more])
      setHistoryHasMore(more.length === HISTORY_PAGE_SIZE)
    } catch (err) {
      console.warn('[DashboardPage] 加载更多历史阅读失败', err)
      setHistoryHasMore(false)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleLoadMoreRecentlyRead = async () => {
    setRecentlyReadLoading(true)
    try {
      const more = await articleService.getRecentlyReadArticles(
        recentlyReadArticles.length + RECENTLY_READ_PAGE_SIZE,
      )
      // getRecentlyReadArticles 返回从头开始的 limit 条，需截取新增部分追加
      const newItems = more.slice(recentlyReadArticles.length)
      setRecentlyReadArticles((prev) => [...prev, ...newItems])
      // 返回总数 === 已展示数 + 页大小 时认为可能还有更多
      setRecentlyReadHasMore(more.length === recentlyReadArticles.length + RECENTLY_READ_PAGE_SIZE)
    } catch (err) {
      console.warn('[DashboardPage] 加载更多最近阅读失败', err)
      setRecentlyReadHasMore(false)
    } finally {
      setRecentlyReadLoading(false)
    }
  }

  // 推荐文章点击跳转
  const handleRecommendedClick = (id: string) => {
    navigate(`/reading?articleId=${encodeURIComponent(id)}`)
  }

  // 每日目标（同步读取设置）
  const goalArticles = getSettings().dailyGoalArticles
  const goalWords = getSettings().dailyGoalWords

  // 加载中骨架屏
  if (loading || !data) {
    return <DashboardSkeleton />
  }

  // 本周掌握趋势：本周 - 上周
  const trendDiff = data.weekMastered - data.lastWeekMastered

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('dashboard.welcome')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('dashboard.subtitle')}</p>
      </div>

      {/* 自有文章操作按钮：单篇添加 + 批量导入 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAddArticleModalOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          添加文章
        </button>
        <button
          type="button"
          onClick={() => setImportArticlesModalOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
            />
          </svg>
          批量导入
        </button>
      </div>

      {/* 顶部数据卡片：连续打卡 / 今日阅读 / 今日复习 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DashboardStatCard
          label={t('dashboard.continuous_days')}
          value={data.streak}
          unit={t('dashboard.unit.day')}
          icon={<FlameIcon className="h-6 w-6" />}
          accent="text-amber-600 dark:text-amber-400"
        />
        <DashboardStatCard
          label={t('dashboard.today_articles')}
          value={data.todayArticlesRead}
          unit={`/ ${goalArticles} ${t('dashboard.unit.articles')}`}
          icon={<BookOpen className="h-6 w-6" />}
          accent="text-indigo-600 dark:text-indigo-400"
          progress={goalArticles > 0 ? data.todayArticlesRead / goalArticles : 0}
        />
        <DashboardStatCard
          label={t('dashboard.today_words')}
          value={data.todayWordsReviewed}
          unit={`/ ${goalWords} ${t('dashboard.unit.words')}`}
          icon={<RefreshCw className="h-6 w-6" />}
          accent="text-emerald-600 dark:text-emerald-400"
          progress={goalWords > 0 ? data.todayWordsReviewed / goalWords : 0}
          hint={t('dashboard.pending_review', { count: data.pendingReview })}
          showRedDot={data.overdueCount > 0}
        />
      </div>

      {/* 今日待办事项列表 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">今日待办</h2>
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
                onClick={() => navigate('/reading')}
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
                已复习 {data.todayWordsReviewed} / 待复习 {data.pendingReview}{' '}
                {t('dashboard.unit.words')}
              </span>
              <button
                type="button"
                onClick={() => navigate('/review')}
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
                <span className="text-sm text-red-700 dark:text-red-400">逾期复习</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  {data.overdueCount} {t('dashboard.unit.words')}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/review')}
                  className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-700 dark:text-red-400 dark:hover:bg-gray-600"
                >
                  去复习
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 今日需复习单词列表 */}
      {todayReviewWords.length > 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">今日需复习</h2>
            <button
              type="button"
              onClick={() => navigate('/review')}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
            >
              查看全部 →
            </button>
          </div>
          <ul className="space-y-2">
            {todayReviewWords.map((w) => {
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
                        title="逾期"
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
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">今日复习已完成 🎉</p>
        </div>
      )}

      {/* 「最近阅读」快捷区块
              位于「今日需复习」下方，紧凑列表展示最近已读文章
              初始加载期间不渲染，避免空状态闪烁；加载完成或已有数据时渲染 */}
      {(!recentlyReadLoading || recentlyReadArticles.length > 0) && (
        <RecentlyReadSection
          articles={recentlyReadArticles}
          onLoadMore={handleLoadMoreRecentlyRead}
          loading={recentlyReadLoading}
          hasMore={recentlyReadHasMore}
        />
      )}

      {/* 历史阅读记录模块
              初始加载期间不渲染，避免空状态闪烁；加载完成或已有数据时渲染 */}
      {(!historyLoading || historyArticles.length > 0) && (
        <ReadingHistorySection
          articles={historyArticles}
          onLoadMore={handleLoadMoreHistory}
          loading={historyLoading}
          hasMore={historyHasMore}
        />
      )}

      {/* 相关文章推荐模块
              初始加载期间不渲染，避免空状态闪烁；加载完成或已有数据时渲染 */}
      {(!recommendedLoading || recommendedArticles.length > 0) && (
        <RelatedArticlesSection
          articles={recommendedArticles}
          onArticleClick={handleRecommendedClick}
        />
      )}

      {/* 底部：阅读能力曲线 + 本周掌握单词数 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 阅读能力增长曲线 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-2">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('dashboard.reading_growth_curve')}
          </h2>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            {t('dashboard.reading_growth_desc')}
          </p>
          {data.readingTrend.length > 0 ? (
            <Suspense
              fallback={
                <div className="h-80 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              }
            >
              <ReadingGrowthChart data={data.readingTrend} />
            </Suspense>
          ) : (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              暂无阅读数据，开始阅读后将显示能力曲线
            </p>
          )}
        </div>

        {/* 本周掌握单词数 */}
        <div className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('dashboard.week_mastered')}
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('dashboard.week_mastered_desc')}
            </p>
          </div>
          <div className="mt-4">
            <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
              {data.weekMastered}
              <span className="ml-1 text-base font-normal text-gray-500 dark:text-gray-400">
                {t('dashboard.unit.words')}
              </span>
            </p>
            {/* 趋势对比 */}
            <div className="mt-3 flex items-center gap-1.5 text-sm">
              {trendDiff > 0 ? (
                <>
                  <TrendUpIcon className="h-4 w-4 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {t('dashboard.trend_up', { count: trendDiff })}
                  </span>
                </>
              ) : trendDiff < 0 ? (
                <>
                  <TrendDownIcon className="h-4 w-4 text-rose-500" />
                  <span className="text-rose-600 dark:text-rose-400">
                    {t('dashboard.trend_down', { count: Math.abs(trendDiff) })}
                  </span>
                </>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">
                  {t('dashboard.trend_flat')}
                </span>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('dashboard.total_mastered')}
            </p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {data.totalWordsMastered} {t('dashboard.unit.words')}
            </p>
          </div>
        </div>
      </div>

      {/* 添加文章 Modal：保存成功后刷新页面以重新加载历史阅读与推荐数据 */}
      <AddArticleModal
        open={addArticleModalOpen}
        onClose={() => {
          setAddArticleModalOpen(false)
          // 简单方案：刷新页面以重新加载历史阅读与推荐数据
          window.location.reload()
        }}
      />

      {/* 批量导入 Modal：导入完成后刷新页面以重新加载历史阅读与推荐数据 */}
      <ImportArticlesModal
        open={importArticlesModalOpen}
        onClose={() => {
          setImportArticlesModalOpen(false)
          window.location.reload()
        }}
      />
    </div>
  )
}

// 骨架屏：加载中占位
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-7 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-2 h-4 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      {/* 顶部卡片骨架 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
          />
        ))}
      </div>
      {/* 中部卡片骨架 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
          />
        ))}
      </div>
      {/* 底部图表骨架 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-96 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 lg:col-span-2" />
        <div className="h-96 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
      </div>
    </div>
  )
}
