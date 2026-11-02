// 班级学情页：teacher / admin 可见（RequireAdmin roles prop 控制）
// 功能：按天窗口聚合全班学员阅读 / 生词数据，展示汇总卡片与学员明细表
// 数据经 adminService 调用 /api/admin/class-stats（服务端 stats:class 权限强制；查询行为留痕）
// 隐私边界：仅展示显示名与统计数值，不含任何学习内容
import { useCallback, useEffect, useState } from 'react'
import { useTranslation, type TranslateFn } from '@/shared/i18n/useTranslation'
import { getClassStats, type ClassStatsResult } from '@/shared/services/adminService'

// 可选窗口（天）：7 / 30 / 90，与学习统计页的常用区间对齐
const DAY_OPTIONS = [7, 30, 90]
const DEFAULT_DAYS = 30

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function formatDuration(sec: number, t: TranslateFn): string {
  const hours = Math.floor(sec / 3600)
  const minutes = Math.round((sec % 3600) / 60)
  return hours > 0
    ? t('admin.class_stats.duration_hours', { hours, minutes })
    : t('admin.class_stats.duration_minutes', { minutes })
}

export default function ClassStatsPage() {
  const { t } = useTranslation()
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [data, setData] = useState<ClassStatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getClassStats(days))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.class_stats.error_load'))
    } finally {
      setLoading(false)
    }
  }, [days, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.class_stats.title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('admin.class_stats.subtitle')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          {t('admin.class_stats.window')}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t('admin.days_window', { days: d })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
          {t('admin.common.loading')}
        </div>
      ) : data ? (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('admin.range', { from: data.from, to: data.to })}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              {
                key: 'students',
                value: String(data.summary.studentCount),
              },
              {
                key: 'active',
                value: String(data.summary.activeStudentCount),
              },
              {
                key: 'articles',
                value: String(data.summary.totalArticlesRead),
              },
              {
                key: 'words',
                value: String(data.summary.totalWordsLearned),
              },
              {
                key: 'accuracy',
                value: formatPercent(data.summary.avgCorrectRate),
              },
              {
                key: 'duration',
                value: formatDuration(data.summary.totalReadingDurationSec, t),
              },
            ].map(({ key, value }) => (
              <div
                key={key}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t(`admin.class_stats.summary_${key}`)}
                </div>
                <div className="mt-1 text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>

          {data.students.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
              {t('admin.class_stats.empty')}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    {[
                      'student',
                      'articles',
                      'words',
                      'reviews',
                      'mastered',
                      'accuracy',
                      'active_days',
                      'streak',
                      'last_active',
                    ].map((key) => (
                      <th
                        key={key}
                        className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                      >
                        {t(`admin.class_stats.col_${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                  {data.students.map((s) => (
                    <tr key={s.userId}>
                      <td className="px-3 py-2">{s.displayName}</td>
                      <td className="px-3 py-2">{s.articlesRead}</td>
                      <td className="px-3 py-2">{s.wordsLearned}</td>
                      <td className="px-3 py-2">{s.wordsReviewed}</td>
                      <td className="px-3 py-2">{s.wordsMastered}</td>
                      <td className="px-3 py-2">{formatPercent(s.correctRate)}</td>
                      <td className="px-3 py-2">{s.activeDays}</td>
                      <td className="px-3 py-2">{s.streak}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                        {s.lastActiveDate ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
