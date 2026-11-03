// AI 成本与用量页（admin / teacher 可见）
// 展示日/月 token 预算使用率、调用量、估算成本，以及按日 / 模型 / 用户的聚合明细
// 数据经 adminService 调用 /api/admin/ai-usage（服务端 logs:view 权限强制；查询行为留痕）
// 成本为按代码内置价格表的估算值（元），仅用于容量与费用观察，不是账单对账依据
import { useCallback, useEffect, useState } from 'react'
import { useTranslation, type TranslateFn } from '@/shared/i18n/useTranslation'
import { getAiUsageReport, type AiCostReport } from '@/shared/services/adminService'

const DAY_OPTIONS = [7, 30, 90]
const DEFAULT_DAYS = 30

function formatTokens(n: number, language: string): string {
  return n.toLocaleString(language)
}

function formatCost(n: number): string {
  return `¥${n.toFixed(4)}`
}

function formatPercent(used: number, limit: number, t: TranslateFn): string {
  if (limit <= 0) return t('admin.common.unlimited')
  return `${Math.round((used / limit) * 100)}%`
}

function BudgetCard({
  label,
  used,
  limit,
  t,
  language,
}: {
  label: string
  used: number
  limit: number
  t: TranslateFn
  language: string
}) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-semibold">{formatPercent(used, limit, t)}</div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-full ${ratio >= 1 ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {formatTokens(used, language)} /{' '}
        {limit > 0 ? formatTokens(limit, language) : t('admin.common.unlimited')}
      </div>
    </div>
  )
}

export default function AiCostPage() {
  const { t, language } = useTranslation()
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [data, setData] = useState<AiCostReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getAiUsageReport(days))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.cost.error_load'))
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
          <h1 className="text-2xl font-bold">{t('admin.cost.title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('admin.cost.subtitle')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          {t('admin.cost.window')}
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BudgetCard
              label={t('admin.cost.budget_daily')}
              used={data.totals.today.tokens}
              limit={data.budgets.daily}
              t={t}
              language={language}
            />
            <BudgetCard
              label={t('admin.cost.budget_monthly')}
              used={data.totals.month.tokens}
              limit={data.budgets.monthly}
              t={t}
              language={language}
            />
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.cost.today_calls_cost')}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {t('admin.cost.calls', {
                  count: formatTokens(data.totals.today.calls, language),
                })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {formatCost(data.totals.today.costCny)}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.cost.month_calls_cost')}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {t('admin.cost.calls', {
                  count: formatTokens(data.totals.month.calls, language),
                })}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {formatCost(data.totals.month.costCny)}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
            {t('admin.cost.window_total', {
              calls: formatTokens(data.totals.window.calls, language),
              tokens: formatTokens(data.totals.window.tokens, language),
              cost: formatCost(data.totals.window.costCny),
            })}
          </div>

          <section>
            <h2 className="mb-2 text-lg font-semibold">{t('admin.cost.daily_title')}</h2>
            {data.daily.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-gray-500 dark:text-gray-400">
                {t('admin.cost.empty')}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      {['date', 'calls', 'tokens', 'cost'].map((key) => (
                        <th
                          key={key}
                          className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                        >
                          {t(`admin.cost.col_${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                    {data.daily.map((row) => (
                      <tr key={row.date}>
                        <td className="px-3 py-2">{row.date}</td>
                        <td className="px-3 py-2">{row.calls}</td>
                        <td className="px-3 py-2">{formatTokens(row.tokens, language)}</td>
                        <td className="px-3 py-2">{formatCost(row.costCny)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-lg font-semibold">{t('admin.cost.by_model_title')}</h2>
              {data.byModel.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-gray-500 dark:text-gray-400">
                  {t('admin.cost.empty')}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        {['model', 'provider', 'call_short', 'tokens', 'cost_short'].map((key) => (
                          <th
                            key={key}
                            className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                          >
                            {t(`admin.cost.col_${key}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                      {data.byModel.map((row) => (
                        <tr key={`${row.provider}:${row.model}`}>
                          <td className="px-3 py-2">{row.model}</td>
                          <td className="px-3 py-2">{row.provider}</td>
                          <td className="px-3 py-2">{row.calls}</td>
                          <td className="px-3 py-2">{formatTokens(row.tokens, language)}</td>
                          <td className="px-3 py-2">{formatCost(row.costCny)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-lg font-semibold">{t('admin.cost.by_user_title')}</h2>
              {data.byUser.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-gray-500 dark:text-gray-400">
                  {t('admin.cost.empty')}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        {['user', 'call_short', 'tokens', 'cost_short'].map((key) => (
                          <th
                            key={key}
                            className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                          >
                            {t(`admin.cost.col_${key}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                      {data.byUser.map((row) => (
                        <tr key={row.userId}>
                          <td className="px-3 py-2">{row.username ?? row.userId}</td>
                          <td className="px-3 py-2">{row.calls}</td>
                          <td className="px-3 py-2">{formatTokens(row.tokens, language)}</td>
                          <td className="px-3 py-2">{formatCost(row.costCny)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  )
}
