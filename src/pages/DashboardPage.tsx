// 首页仪表盘 - 连续打卡 + 今日目标进度 + 今日待办 + 历史阅读 + 相关推荐 + 阅读能力曲线 + 本周掌握单词
//
// 数据加载与展示区块下沉：
//   - hooks/useDashboardOverview：概览统计、今日需复习单词
//   - hooks/useDashboardArticles：历史阅读 / 最近阅读 / 相关推荐及分页
//   - components/Dashboard*：快捷操作、数据卡片、今日待办、复习列表、底部面板
import { logger } from '../shared/utils/logger'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  getSettings,
  statsRepository,
  reviewRepository,
  readingSessionRepository,
} from '@/shared/services'
import AddArticleModal from '@/features/reading/components/AddArticleModal'
import ImportArticlesModal from '@/features/reading/components/ImportArticlesModal'
import { useTranslation } from '@/shared/i18n/useTranslation'
import DashboardQuickActions from './components/DashboardQuickActions'
import DashboardStatGrid from './components/DashboardStatGrid'
import DashboardTodayTodo from './components/DashboardTodayTodo'
import DashboardReviewWords from './components/DashboardReviewWords'
import DashboardGrowthPanels from './components/DashboardGrowthPanels'
import ReadingHistorySection from './components/ReadingHistorySection'
import RecentlyReadSection from './components/RecentlyReadSection'
import RelatedArticlesSection from './components/RelatedArticlesSection'
import { useDashboardOverview } from './hooks/useDashboardOverview'
import { useDashboardArticles } from './hooks/useDashboardArticles'

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()

  const [addArticleModalOpen, setAddArticleModalOpen] = useState(false)
  const [importArticlesModalOpen, setImportArticlesModalOpen] = useState(false)

  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  const { data, loading, todayReviewWords, loadOverview } = useDashboardOverview(mountedRef)
  const {
    historyArticles,
    historyLoading,
    historyHasMore,
    handleLoadMoreHistory,
    recentlyReadArticles,
    recentlyReadLoading,
    recentlyReadHasMore,
    handleLoadMoreRecentlyRead,
    recommendedArticles,
    recommendedLoading,
    loadArticles,
  } = useDashboardArticles(mountedRef)

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
      logger.warn('[DashboardPage] 加载概览数据失败', err)
    })
    return () => {
      cancelled = true
      mountedRef.current = false
    }
    // 仅在路由切换时重新加载；loadOverview/loadArticles 为 useCallback 稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // 推荐文章点击：跳转对应文章阅读页
  const handleRecommendedClick = (id: string) => {
    navigate(`/reading?articleId=${encodeURIComponent(id)}`)
  }

  // 加载中骨架屏
  if (loading || !data) {
    return <DashboardSkeleton />
  }

  // 每日目标（同步读取设置）
  const goalArticles = getSettings().dailyGoalArticles
  const goalWords = getSettings().dailyGoalWords

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
      <DashboardQuickActions
        onAddArticle={() => setAddArticleModalOpen(true)}
        onImportArticles={() => setImportArticlesModalOpen(true)}
      />

      {/* 顶部数据卡片：连续打卡 / 今日阅读 / 今日复习 */}
      <DashboardStatGrid data={data} goalArticles={goalArticles} goalWords={goalWords} />

      {/* 今日待办事项列表 */}
      <DashboardTodayTodo
        data={data}
        goalArticles={goalArticles}
        goalWords={goalWords}
        onStartReading={() => navigate('/reading')}
        onStartReview={() => navigate('/review')}
      />

      {/* 今日需复习单词列表 */}
      <DashboardReviewWords
        words={todayReviewWords}
        onViewAll={() => navigate('/review')}
      />

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
      <DashboardGrowthPanels
        readingTrend={data.readingTrend}
        weekMastered={data.weekMastered}
        lastWeekMastered={data.lastWeekMastered}
        totalWordsMastered={data.totalWordsMastered}
      />

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

// 加载中骨架屏
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
