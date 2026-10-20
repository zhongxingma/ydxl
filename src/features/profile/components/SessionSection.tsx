// 登录设备管理（多用户 P3）
// - 列出当前用户的全部有效会话（我的设备），标记当前设备
// - 移除单个设备（吊销指定会话）
// - 全端下线（吊销全部会话含当前设备，成功后跳转登录页）
// 安全：服务端响应不含完整令牌，前端仅展示脱敏指纹；全端下线复用服务端审计留痕
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import SettingsSection from './SettingsSection'
import { ClockIcon } from '@/shared/components/icons'
import { useTranslation } from '@/shared/i18n/useTranslation'
import {
  getCurrentUser,
  listSessions,
  logoutAll,
  revokeSession,
  type SessionInfo,
} from '@/shared/services/authService'

export default function SessionSection() {
  const { t } = useTranslation()
  const user = getCurrentUser()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listSessions())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sessions.failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const handleRevoke = async (session: SessionInfo) => {
    if (!window.confirm(t('sessions.confirm_revoke'))) return
    setPending(true)
    try {
      await revokeSession(session.sessionId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sessions.failed'))
    } finally {
      setPending(false)
    }
  }

  const handleLogoutAll = async () => {
    if (!window.confirm(t('sessions.confirm_logout_all'))) return
    setPending(true)
    try {
      await logoutAll()
      window.location.assign('/login')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sessions.failed'))
      setPending(false)
    }
  }

  const body: ReactNode = loading ? (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500 dark:border-gray-600" />
      {t('sessions.loading')}
    </div>
  ) : sessions.length === 0 ? (
    <p className="text-sm text-gray-500 dark:text-gray-400">{t('sessions.loading')}</p>
  ) : (
    <div className="space-y-2">
      {sessions.map((s) => (
        <div
          key={s.sessionId}
          className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-700/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
                {s.tokenFingerprint}
              </span>
              {s.current && (
                <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                  {t('sessions.current_device')}
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
              {s.ip ?? '—'}
              {s.userAgent ? ` · ${s.userAgent}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleRevoke(s)}
            disabled={s.current || pending}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {t('sessions.revoke')}
          </button>
        </div>
      ))}
      <div className="pt-1">
        <button
          type="button"
          onClick={handleLogoutAll}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/50 dark:bg-gray-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
        >
          <ClockIcon className="h-4 w-4" />
          {t('sessions.logout_all')}
        </button>
      </div>
    </div>
  )

  return (
    <SettingsSection
      title={t('settings.sessions')}
      description={t('settings.sessions_desc')}
      icon={<ClockIcon className="h-5 w-5" />}
    >
      {body}
      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </SettingsSection>
  )
}
