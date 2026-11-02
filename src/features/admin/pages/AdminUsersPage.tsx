// 用户管理页（多用户 P1，RBAC）：仅 admin 角色可见（RequireAdmin 路由守卫控制）
// 功能：用户列表、创建用户、禁用/启用、重置密码、修改角色
// 数据经 adminService 调用 /api/admin/users（服务端 requirePermission 强制授权）
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from '@/shared/i18n/useTranslation'
import {
  createUser,
  listUsers,
  resetPassword,
  setUserRole,
  setUserStatus,
  type AdminUser,
  type UserRole,
} from '@/shared/services/adminService'

const ROLE_OPTIONS: UserRole[] = ['student', 'teacher', 'admin']

function formatTime(ts: number | null, language: string): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(language, { hour12: false })
}

export default function AdminUsersPage() {
  const { t, language } = useTranslation()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 创建用户表单
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('student')
  const [creating, setCreating] = useState(false)

  // 重置密码的行内编辑态（记录目标用户 id 与新密码）
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setUsers(await listUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.error_load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // 操作反馈自动消失（5 秒）
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const user = await createUser({ username, displayName, password, role })
      setNotice(
        t('admin.users.created', {
          name: user.displayName,
          role: t(`admin.roles.${user.role}`),
        }),
      )
      setUsername('')
      setDisplayName('')
      setPassword('')
      setRole('student')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.error_create'))
    } finally {
      setCreating(false)
    }
  }

  async function handleStatus(user: AdminUser) {
    setError(null)
    try {
      const next = user.status === 'active' ? 'disabled' : 'active'
      await setUserStatus(user.id, next)
      setNotice(
        next === 'disabled'
          ? t('admin.users.disabled_notice', { name: user.displayName })
          : t('admin.users.enabled_notice', { name: user.displayName }),
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.error_action'))
    }
  }

  async function handleRole(user: AdminUser, nextRole: UserRole) {
    if (nextRole === user.role) return
    setError(null)
    try {
      await setUserRole(user.id, nextRole)
      setNotice(
        t('admin.users.role_changed', {
          name: user.displayName,
          role: t(`admin.roles.${nextRole}`),
        }),
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.error_role'))
    }
  }

  async function handleReset(user: AdminUser) {
    setError(null)
    try {
      await resetPassword(user.id, newPassword)
      setNotice(t('admin.users.password_reset', { name: user.displayName }))
      setResettingId(null)
      setNewPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.error_reset'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.users.title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('admin.users.subtitle')}
          </p>
        </div>
        <div className="flex shrink-0 gap-4 text-sm text-indigo-600 dark:text-indigo-400">
          <Link to="/admin/class-stats" className="hover:underline">
            {t('admin.nav.class_stats')}
          </Link>
          <Link to="/admin/logs" className="hover:underline">
            {t('admin.nav.logs')}
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 创建用户 */}
      <form
        onSubmit={(e) => void handleCreate(e)}
        className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-5"
      >
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('admin.users.username_placeholder')}
          required
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('admin.users.display_name_placeholder')}
          required
          maxLength={64}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('admin.users.initial_password_placeholder')}
          required
          minLength={6}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`admin.roles.${r}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {creating ? t('admin.users.creating') : t('admin.users.create')}
        </button>
      </form>

      {/* 用户列表 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
          {t('admin.common.loading')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {[
                  'username',
                  'display_name',
                  'role',
                  'status',
                  'failed_logins',
                  'created_at',
                  'actions',
                ].map((key) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                  >
                    {t(`admin.users.col_${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2 font-mono">{user.username}</td>
                  <td className="px-3 py-2">{user.displayName}</td>
                  <td className="px-3 py-2">
                    <select
                      value={user.role}
                      onChange={(e) => void handleRole(user, e.target.value as UserRole)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {t(`admin.roles.${r}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        user.status === 'active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {user.status === 'active'
                        ? t('admin.users.status_active')
                        : t('admin.users.status_disabled')}
                    </span>
                  </td>
                  <td className="px-3 py-2">{user.failedLogins}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {formatTime(user.createdAt, language)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleStatus(user)}
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {user.status === 'active'
                          ? t('admin.users.disable')
                          : t('admin.users.enable')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResettingId(resettingId === user.id ? null : user.id)
                          setNewPassword('')
                        }}
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {t('admin.users.reset_password')}
                      </button>
                    </div>
                    {resettingId === user.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={t('admin.users.new_password_placeholder')}
                          minLength={6}
                          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
                        />
                        <button
                          type="button"
                          onClick={() => void handleReset(user)}
                          disabled={newPassword.length < 6}
                          className="text-xs text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
                        >
                          {t('admin.common.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setResettingId(null)}
                          className="text-xs text-gray-500 hover:underline dark:text-gray-400"
                        >
                          {t('admin.common.cancel')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
