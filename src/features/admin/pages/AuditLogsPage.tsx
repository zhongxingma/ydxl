// 审计日志查看页：teacher / admin 可见（RequireAdmin roles prop 控制）
// 功能：按动作 / 操作者过滤、分页浏览、CSV 导出
// 数据经 adminService 调用 /api/admin/logs（服务端 logs:view 权限强制；查询行为本身留痕）
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { exportAuditLogs, listAuditLogs, type AuditLogEntry } from '@/shared/services/adminService'
import { getCurrentUser } from '@/shared/services/authService'

const PAGE_SIZE = 50

const RESULT_STYLES: Record<string, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  denied: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  failed: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

function formatTime(ts: number | null, language: string): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(language, { hour12: false })
}

export default function AuditLogsPage() {
  const { t, language } = useTranslation()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // 过滤条件（提交后生效；action 支持输入如 auth.login.success）
  const [actionInput, setActionInput] = useState('')
  const [userIdInput, setUserIdInput] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<{ action?: string; userId?: string }>({})

  // admin 额外可见「用户管理」入口（teacher 无 users:manage 权限）
  const isAdmin = getCurrentUser()?.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listAuditLogs({ ...appliedFilter, limit: PAGE_SIZE, offset })
      setLogs(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.logs.error_load'))
    } finally {
      setLoading(false)
    }
  }, [appliedFilter, offset, t])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setOffset(0)
    setAppliedFilter({
      action: actionInput.trim() || undefined,
      userId: userIdInput.trim() || undefined,
    })
  }

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      await exportAuditLogs(appliedFilter)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.logs.error_export'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.logs.title')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('admin.logs.subtitle')}</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 过滤与导出 */}
      <form
        onSubmit={(e) => void handleSearch(e)}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      >
        <input
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          placeholder={t('admin.logs.action_placeholder')}
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <input
          value={userIdInput}
          onChange={(e) => setUserIdInput(e.target.value)}
          placeholder={t('admin.logs.user_placeholder')}
          className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {t('admin.logs.search')}
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {exporting ? t('admin.logs.exporting') : t('admin.logs.export')}
        </button>
        <div className="ml-auto flex items-center gap-4">
          <Link
            to="/admin/class-stats"
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {t('admin.nav.class_stats')}
          </Link>
          {/* 用户管理仅 admin 可见（teacher 无 users:manage 权限） */}
          {isAdmin && (
            <Link
              to="/admin"
              className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {t('admin.nav.users')}
            </Link>
          )}
        </div>
      </form>

      {/* 日志列表 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
          {t('admin.common.loading')}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
          {t('admin.logs.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['time', 'operator', 'action', 'resource', 'result', 'ip', 'detail'].map((key) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                  >
                    {t(`admin.logs.col_${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-gray-400">
                    {formatTime(log.createdAt, language)}
                  </td>
                  <td className="px-3 py-2">{log.username ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
                  <td className="px-3 py-2">
                    {log.resource ?? '-'}
                    {log.resourceId && (
                      <span className="ml-1 text-xs text-gray-400">{log.resourceId}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        RESULT_STYLES[log.result] ??
                        'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {log.result}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{log.ip ?? '-'}</td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {log.detail ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span>
          {appliedFilter.action || appliedFilter.userId
            ? t('admin.logs.count_filtered', { total })
            : t('admin.logs.count', { total })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40 dark:border-gray-600"
          >
            {t('admin.logs.prev')}
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40 dark:border-gray-600"
          >
            {t('admin.logs.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
