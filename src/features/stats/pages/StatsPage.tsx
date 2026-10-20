// 学习统计页面：KPI 概览 + 周/月折线图 + 本周柱状图 + 阅读能力增长曲线
// SWR 模式：statsRepository 后台刷新完成后通过 cacheEvents 通知本页面重载（跨终端数据同步）
import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeIcon, BookIcon, FlameIcon } from '@/shared/components/icons'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import KPICard from '../components/KPICard'
import ReadingGrowthChart from '../components/ReadingGrowthChart'
import StatsBarChart from '../components/StatsBarChart'
import StatsChart from '../components/StatsChart'
import StatsTabs from '../components/StatsTabs'
import { statsService } from '../services/statsService'
import type { ReadingAbilityTrendPoint, StatsMode, StatsOverview } from '../types'
import { getDateRange } from '../utils/date'
import type { Stats } from '@/shared/types'

// 加号图标 - 新增生词
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

// 创建空 stats 记录（用于补齐无数据的日期）
function createEmptyStats(date: string): Stats {
  return {
    id: date,
    articlesRead: 0,
    wordsLearned: 0,
    wordsReviewed: 0,
    wordsMastered: 0,
    streak: 0,
    updated_at: 0,
  }
}

// 将查询到的 stats 与日期范围合并，缺失日期补零
function mergeWithDateRange(dates: string[], stats: Stats[]): Stats[] {
  return dates.map((d) => stats.find((s) => s.id === d) ?? createEmptyStats(d))
}

export default function StatsPage() {
  const [mode, setMode] = useState<StatsMode>('week')
  const [rangeData, setRangeData] = useState<Stats[]>([])
  const [weekData, setWeekData] = useState<Stats[]>([])
  const [readingTrend, setReadingTrend] = useState<ReadingAbilityTrendPoint[]>([])
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [loading, setLoading] = useState(true)

  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  // 加载统计概览
  // SWR 模式：本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本页面重载
  const loadOverview = useCallback(async () => {
    try {
      const data = await statsService.getStatsOverview()
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      setOverview(data)
      setLoading(false)
    } catch (err) {
      console.warn('[StatsPage] 加载统计概览失败', err)
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // 加载周/月折线图数据（依赖 mode，切换 tab 时由下方 effect 重载）
  const loadRangeData = useCallback(async () => {
    try {
      const dates = getDateRange(mode)
      const stats = await statsService.getStatsByDateRange(dates[0], dates[dates.length - 1])
      if (!mountedRef.current) return
      setRangeData(mergeWithDateRange(dates, stats))
    } catch (err) {
      console.warn('[StatsPage] 加载折线图数据失败', err)
    }
  }, [mode])

  // 加载本周柱状图数据
  const loadWeekData = useCallback(async () => {
    try {
      const dates = getDateRange('week')
      const stats = await statsService.getStatsByDateRange(dates[0], dates[dates.length - 1])
      if (!mountedRef.current) return
      setWeekData(mergeWithDateRange(dates, stats))
    } catch (err) {
      console.warn('[StatsPage] 加载柱状图数据失败', err)
    }
  }, [])

  // 加载最近 30 天阅读能力增长曲线数据（服务层聚合，已修复时间窗口与缺失字段兜底）
  const loadReadingTrend = useCallback(async () => {
    try {
      const trend = await statsService.getReadingAbilityTrend(30)
      if (!mountedRef.current) return
      setReadingTrend(trend)
    } catch (err) {
      console.warn('[StatsPage] 加载阅读能力曲线数据失败', err)
    }
  }, [])

  // 初次挂载：加载概览、本周柱状图、阅读能力曲线；设置 mountedRef 防止卸载后 setState
  // 折线图数据由下方 mode effect 在首次挂载时统一触发，避免重复请求
  useEffect(() => {
    mountedRef.current = true
    void loadOverview()
    void loadWeekData()
    void loadReadingTrend()
    return () => {
      mountedRef.current = false
    }
  }, [loadOverview, loadWeekData, loadReadingTrend])

  // mode 变化时重新加载折线图数据（首次挂载时也会触发，与原逻辑一致）
  useEffect(() => {
    void loadRangeData()
  }, [loadRangeData])

  // 订阅 stats 缓存事件：statsRepository 后台刷新完成后重载全部统计数据
  // 跨终端数据同步场景下，确保本页面持续显示最新数据
  // useCacheInvalidated 内部用 ref 透传最新 callback，此处闭包捕获的 loadXxx 始终为最新值
  useCacheInvalidated('stats', () => {
    void loadOverview()
    void loadRangeData()
    void loadWeekData()
    void loadReadingTrend()
  })

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">加载中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">学习统计</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">追踪你的学习进度与打卡记录</p>
      </div>

      {/* 顶部 KPI 卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="连续打卡天数"
          value={overview?.currentStreak ?? 0}
          icon={<FlameIcon className="h-8 w-8" />}
          color="text-amber-600 dark:text-amber-400"
        />
        <KPICard
          title="今日阅读篇数"
          value={overview?.todayArticlesRead ?? 0}
          icon={<BookIcon className="h-8 w-8" />}
          color="text-indigo-600 dark:text-indigo-400"
        />
        <KPICard
          title="已掌握单词总数"
          value={overview?.totalWordsMastered ?? 0}
          icon={<BadgeIcon className="h-8 w-8" />}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <KPICard
          title="今日新增生词数"
          value={overview?.todayWordsLearned ?? 0}
          icon={<PlusIcon className="h-8 w-8" />}
          color="text-rose-600 dark:text-rose-400"
        />
      </div>

      {/* 中部折线图 + 周/月切换 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">学习趋势</h2>
          <StatsTabs mode={mode} onChange={setMode} />
        </div>
        <StatsChart data={rangeData} mode={mode} />
      </div>

      {/* 底部柱状图：本周每日掌握单词数 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">本周每日掌握单词数</h2>
        <StatsBarChart data={weekData} />
      </div>

      {/* 阅读能力增长曲线：最近 30 天阅读会话正确率与字数 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          阅读能力增长曲线
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          基于最近 30 天的阅读会话记录，展示答题正确率与阅读字数趋势
        </p>
        <ReadingGrowthChart data={readingTrend} />
      </div>
    </div>
  )
}
