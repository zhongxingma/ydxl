// 仪表盘文章列表：历史阅读 / 最近阅读 / 相关推荐及各自分页
//
// 数据源：articleService（历史与最近阅读，内部 SWR 本地优先）、recommendationService（推荐）
// 缓存联动：订阅 articles 缓存事件，后台刷新完成后重载文章相关数据
import { logger } from '../../shared/utils/logger'
import type { MutableRefObject } from 'react'
import { useCallback, useState } from 'react'
import type { Article } from '@/shared/types'
import type { RecentlyReadArticle } from '@/features/reading/services/articleService'
import { articleService } from '@/features/reading/services/articleService'
import { getRecommendedArticles } from '@/features/reading/services/recommendationService'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'

// 历史阅读每页加载条数
const HISTORY_PAGE_SIZE = 6
// 推荐文章加载条数
const RECOMMENDED_LIMIT = 6
const RECENTLY_READ_PAGE_SIZE = 5

export interface UseDashboardArticlesResult {
  historyArticles: Article[]
  historyLoading: boolean
  historyHasMore: boolean
  handleLoadMoreHistory: () => Promise<void>
  recentlyReadArticles: RecentlyReadArticle[]
  recentlyReadLoading: boolean
  recentlyReadHasMore: boolean
  handleLoadMoreRecentlyRead: () => Promise<void>
  recommendedArticles: Article[]
  recommendedLoading: boolean
  loadArticles: () => Promise<void>
}

export function useDashboardArticles(
  mountedRef: MutableRefObject<boolean>,
): UseDashboardArticlesResult {
  const [historyArticles, setHistoryArticles] = useState<Article[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyHasMore, setHistoryHasMore] = useState(false)

  const [recentlyReadArticles, setRecentlyReadArticles] = useState<RecentlyReadArticle[]>([])
  const [recentlyReadLoading, setRecentlyReadLoading] = useState(true)
  const [recentlyReadHasMore, setRecentlyReadHasMore] = useState(false)

  const [recommendedArticles, setRecommendedArticles] = useState<Article[]>([])
  const [recommendedLoading, setRecommendedLoading] = useState(true)

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
  }, [mountedRef])

  // 订阅 articles 缓存事件：articleService 后台刷新完成后重载文章相关数据
  useCacheInvalidated('articles', () => {
    void loadArticles()
  })

  // 「查看更多」：加载下一页历史阅读，追加到现有列表
  const handleLoadMoreHistory = async () => {
    setHistoryLoading(true)
    try {
      const more = await articleService.getReadHistory(HISTORY_PAGE_SIZE, historyArticles.length)
      setHistoryArticles((prev) => [...prev, ...more])
      setHistoryHasMore(more.length === HISTORY_PAGE_SIZE)
    } catch (err) {
      logger.warn('[DashboardPage] 加载更多历史阅读失败', err)
      setHistoryHasMore(false)
    } finally {
      setHistoryLoading(false)
    }
  }

  // 「展开更多」：最近阅读按累计 limit 重新拉取并追加新增部分
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
      logger.warn('[DashboardPage] 加载更多最近阅读失败', err)
      setRecentlyReadHasMore(false)
    } finally {
      setRecentlyReadLoading(false)
    }
  }

  return {
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
  }
}
