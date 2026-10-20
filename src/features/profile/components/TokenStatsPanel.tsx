// AI 用量与成本面板
//
// 在 ProfilePage 中展示 DeepSeek 上下文硬盘缓存（KV Cache）命中情况、
// 本地响应缓存命中情况以及按官方定价估算的总成本（¥）。
//
// 数据源：tokenStats.ts 的 getStats / getDeepSeekCacheStats / getCostEstimation
// 设计目标：best-effort 展示，统计读取失败时静默回退到「暂无数据」占位

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCostEstimation,
  getDeepSeekCacheStats,
  getStats,
  type CostEstimationSnapshot,
  type DeepSeekCacheStatsSnapshot,
  type TokenStatsSnapshot,
} from '@/shared/services/ai/tokenStats'
import { useTranslation } from '@/shared/i18n/useTranslation'

export default function TokenStatsPanel() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<TokenStatsSnapshot | null>(null)
  const [cacheStats, setCacheStats] = useState<DeepSeekCacheStatsSnapshot | null>(null)
  const [cost, setCost] = useState<CostEstimationSnapshot | null>(null)

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 加载 token 统计快照
  // 三次读取均为同步内存操作（已通过 ensureLoaded 懒加载 localStorage）
  const refreshStats = useCallback(() => {
    try {
      const s = getStats()
      const c = getDeepSeekCacheStats()
      const est = getCostEstimation()
      if (isMountedRef.current) {
        setStats(s)
        setCacheStats(c)
        setCost(est)
      }
    } catch (err) {
      console.warn('[token-stats-panel] 获取统计失败', err)
    }
  }, [])

  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  // 格式化金额（小数位自适应：小于 0.01 时保留 6 位，否则保留 4 位）
  const formatYuan = (yuan: number): string => {
    if (yuan < 0.01) return yuan.toFixed(6)
    return yuan.toFixed(4)
  }

  // 格式化百分比（0-1 -> "80.0%"）
  const formatPercent = (rate: number): string => {
    if (!Number.isFinite(rate) || rate <= 0) return '0.0%'
    return `${(rate * 100).toFixed(1)}%`
  }

  // 本地响应缓存命中/总调用数（从按场景统计聚合）
  const totalCacheHits = stats
    ? Object.values(stats.byScenario).reduce((sum, s) => sum + s.cacheHits, 0)
    : 0
  const totalCalls = stats
    ? Object.values(stats.byScenario).reduce((sum, s) => sum + s.totalCalls, 0)
    : 0

  // 是否有任何 AI 调用数据
  const hasAnyData =
    stats !== null &&
    cacheStats !== null &&
    cost !== null &&
    (stats.total.prompt > 0 ||
      stats.total.completion > 0 ||
      cacheStats.hitTokens + cacheStats.missTokens > 0 ||
      totalCalls > 0)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        {t('profile.token_stats.title')}
      </h3>

      {!hasAnyData ? (
        <div className="rounded bg-gray-50 p-3 text-center text-sm text-gray-500 dark:bg-gray-700/50 dark:text-gray-400">
          {t('profile.token_stats.no_data')}
        </div>
      ) : (
        <div className="space-y-3">
          {/* DeepSeek 上下文硬盘缓存命中 */}
          {cacheStats && (cacheStats.hitTokens > 0 || cacheStats.missTokens > 0) && (
            <div className="rounded bg-emerald-50 p-3 dark:bg-emerald-900/20">
              <div className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-emerald-700 dark:text-emerald-300">
                    {t('profile.token_stats.deepseek_cache_hit')}
                  </div>
                  <div className="text-xs text-emerald-600 dark:text-emerald-400">
                    {t('profile.token_stats.deepseek_cache_hit_desc')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-emerald-600 dark:text-emerald-400">
                    {t('profile.token_stats.hit_rate')}
                  </div>
                  <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-200">
                    {formatPercent(cacheStats.hitRate)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                <span>
                  hit/miss：{cacheStats.hitTokens.toLocaleString()} /{' '}
                  {cacheStats.missTokens.toLocaleString()}
                </span>
                {cacheStats.estimatedSavingsYuan > 0 && (
                  <span>
                    {t('profile.token_stats.estimated_savings')}：¥
                    {formatYuan(cacheStats.estimatedSavingsYuan)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 本地响应缓存命中（responseCache） */}
          {stats && stats.total.cacheHitRate > 0 && (
            <div className="rounded bg-indigo-50 p-3 dark:bg-indigo-900/20">
              <div className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-indigo-700 dark:text-indigo-300">
                    {t('profile.token_stats.local_cache_hit')}
                  </div>
                  <div className="text-xs text-indigo-600 dark:text-indigo-400">
                    {t('profile.token_stats.local_cache_hit_desc')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-indigo-600 dark:text-indigo-400">
                    {t('profile.token_stats.hit_rate')}
                  </div>
                  <div className="text-lg font-semibold text-indigo-700 dark:text-indigo-200">
                    {formatPercent(stats.total.cacheHitRate)}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
                {totalCacheHits.toLocaleString()} / {totalCalls.toLocaleString()} calls
              </div>
            </div>
          )}

          {/* 估算成本（按 v4-pro 真实定价） */}
          {cost && cost.totalCostYuan > 0 && (
            <div className="rounded bg-yellow-50 p-3 dark:bg-yellow-900/20">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-yellow-700 dark:text-yellow-300">
                  {t('profile.token_stats.estimated_cost')}
                </span>
                <span className="text-lg font-bold text-yellow-700 dark:text-yellow-200">
                  ¥{formatYuan(cost.totalCostYuan)}
                </span>
              </div>
              <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                {t('profile.token_stats.tokens')}：
                {((stats?.total.prompt ?? 0) + (stats?.total.completion ?? 0)).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
