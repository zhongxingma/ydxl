// 审计日志查看页：teacher / admin 可见（RequireAdmin roles prop 控制）
// 功能：按动作 / 操作者过滤、分页浏览、CSV 导出
// 数据经 adminService 调用 /api/admin/logs（服务端 logs:view 权限强制；查询行为本身留痕）
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  exportAuditLogs,
  listAuditLogs,
  type AuditLogEntry,
} from '@/shared/services/adminService'
import { getCurrentUser } from '@/shared/services/authService'

const PAGE_SIZE = 50

const RESULT_STYLES: Record<string, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  denied: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  failed: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export default function AuditLogsPage() {
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
      setError(err instanceof Error ? err.message : '加载审计日志失败')
    } finally {
      setLoading(false)
    }
  }, [appliedFilter, offset])

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
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">审计日志</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          记录登录、用户管理、权限拒绝、数据写操作与 AI 调用。日志保留 180 天，查询行为本身也会被记录。
        </p>
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
          placeholder="动作（如 auth.login.success）"
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <input
          value={userIdInput}
          onChange={(e) => setUserIdInput(e.target.value)}
          placeholder="操作者用户 ID"
          className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          查询
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {exporting ? '导出中...' : '导出 CSV'}
        </button>
        <div className="ml-auto flex items-center gap-4">
          <Link
            to="/admin/class-stats"
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            班级学情
          </Link>
          {/* 用户管理仅 admin 可见（teacher 无 users:manage 权限） */}
          {isAdmin && (
            <Link
              to="/admin"
              className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
            >
              用户管理
            </Link>
          )}
        </div>
      </form>

      {/* 日志列表 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
          加载中...
        </div>
      ) : logs.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
          暂无日志
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['时间', '操作者', '动作', '资源', '结果', 'IP', '详情'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-gray-400">
                    {formatTime(log.createdAt)}
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
          共 {total} 条{appliedFilter.action || appliedFilter.userId ? '（已过滤）' : ''}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40 dark:border-gray-600"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40 dark:border-gray-600"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  )
}
