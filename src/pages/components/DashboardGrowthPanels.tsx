// 仪表盘底部面板：阅读能力增长曲线（懒加载 recharts）+ 本周掌握单词数
import { lazy, Suspense } from 'react'
import { TrendDownIcon, TrendUpIcon } from '@/shared/components/icons'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { ReadingAbilityTrendPoint } from '@/features/stats'

// 阅读能力曲线图表懒加载：recharts 体积较大（~408KB），
// 仅在 Dashboard 有阅读数据时才动态导入，避免首屏加载时下载 recharts。
// 项目约束：仅在有数据时才渲染图表（条件渲染位于 Suspense 外层，空状态不会触发动态加载）
const ReadingGrowthChart = lazy(() => import('@/features/stats/components/ReadingGrowthChart'))

interface DashboardGrowthPanelsProps {
  readingTrend: ReadingAbilityTrendPoint[]
  weekMastered: number
  lastWeekMastered: number
  totalWordsMastered: number
}

export default function DashboardGrowthPanels({
  readingTrend,
  weekMastered,
  lastWeekMastered,
  totalWordsMastered,
}: DashboardGrowthPanelsProps) {
  const { t } = useTranslation()
  // 本周掌握趋势：本周 - 上周
  const trendDiff = weekMastered - lastWeekMastered

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* 阅读能力增长曲线 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-2">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('dashboard.reading_growth_curve')}
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          {t('dashboard.reading_growth_desc')}
        </p>
        {readingTrend.length > 0 ? (
          <Suspense
            fallback={
              <div className="h-80 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
            }
          >
            <ReadingGrowthChart data={readingTrend} />
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
            {weekMastered}
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
            {totalWordsMastered} {t('dashboard.unit.words')}
          </p>
        </div>
      </div>
    </div>
  )
}
