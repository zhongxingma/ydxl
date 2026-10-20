// adminService 单元测试
// 覆盖：用户列表/创建/禁用/改角色的请求构造、401 清会话广播、403 无权限文案、204 静默成功
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  listUsers,
  createUser,
  setUserStatus,
  setUserRole,
  resetPassword,
  listAuditLogs,
  getClassStats,
} from '../adminService'
import { installFetchMock, restoreFetch } from '@/test/setup'

const TOKEN = 'admin-session-token'
const SAMPLE_USER = {
  id: 'u-1',
  username: 'alice',
  displayName: '爱丽丝',
  role: 'student',
  status: 'active',
  failedLogins: 0,
  lockedUntil: null,
  createdAt: 1700000000000,
}

function seedSession(): void {
  sessionStorage.setItem('ydxl-auth-token', TOKEN)
  sessionStorage.setItem(
    'ydxl-auth-user',
    JSON.stringify({ id: 'u-admin', username: 'boss', displayName: '管理员', role: 'admin' }),
  )
}

describe('adminService', () => {
  beforeEach(() => {
    seedSession()
  })

  afterEach(() => {
    restoreFetch()
    sessionStorage.clear()
  })

  it('listUsers：请求 /api/admin/users 并携带会话令牌', async () => {
    const calls = installFetchMock({ json: { items: [SAMPLE_USER] } })
    const users = await listUsers()
    expect(users).toEqual([SAMPLE_USER])
    expect(calls[0].url).toContain('/api/admin/users')
    expect(calls[0].headers['x-user-token']).toBe(TOKEN)
  })

  it('createUser：POST 请求体含用户名/显示名/密码/角色', async () => {
    const calls = installFetchMock({
      status: 201,
      ok: true,
      json: { user: { ...SAMPLE_USER, role: 'teacher' } },
    })
    const user = await createUser({
      username: 'bob',
      displayName: '鲍勃',
      password: 'pass-123',
      role: 'teacher',
    })
    expect(user.role).toBe('teacher')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body)).toEqual({
      username: 'bob',
      displayName: '鲍勃',
      password: 'pass-123',
      role: 'teacher',
    })
  })

  it('401 会话失效：清除本地会话并广播 ydxl:unauthorized', async () => {
    installFetchMock({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } })
    const events: Event[] = []
    const handler = (e: Event) => events.push(e)
    window.addEventListener('ydxl:unauthorized', handler)
    try {
      await expect(listUsers()).rejects.toThrow('会话已失效，请重新登录')
      // 本地会话已清除
      expect(sessionStorage.getItem('ydxl-auth-token')).toBeNull()
      expect(events.length).toBe(1)
    } finally {
      window.removeEventListener('ydxl:unauthorized', handler)
    }
  })

  it('403 无权限：抛出统一文案', async () => {
    installFetchMock({
      status: 403,
      ok: false,
      json: { error: { code: 'FORBIDDEN', message: '缺少权限：users:manage' } },
    })
    await expect(listUsers()).rejects.toThrow('无权限执行该操作')
  })

  it('setUserStatus：PUT /users/:id/status', async () => {
    const calls = installFetchMock({ json: { user: { ...SAMPLE_USER, status: 'disabled' } } })
    const user = await setUserStatus('u-1', 'disabled')
    expect(user.status).toBe('disabled')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toContain('/api/admin/users/u-1/status')
    expect(JSON.parse(calls[0].body)).toEqual({ status: 'disabled' })
  })

  it('setUserRole：PUT /users/:id/role', async () => {
    const calls = installFetchMock({ json: { user: { ...SAMPLE_USER, role: 'teacher' } } })
    const user = await setUserRole('u-1', 'teacher')
    expect(user.role).toBe('teacher')
    expect(calls[0].url).toContain('/api/admin/users/u-1/role')
    expect(JSON.parse(calls[0].body)).toEqual({ role: 'teacher' })
  })

  it('resetPassword：POST 成功返回 204 时不解析 JSON', async () => {
    const calls = installFetchMock({ status: 204, ok: true })
    await expect(resetPassword('u-1', 'new-pass-1')).resolves.toBeUndefined()
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toContain('/api/admin/users/u-1/reset-password')
    expect(JSON.parse(calls[0].body)).toEqual({ newPassword: 'new-pass-1' })
  })

  it('listAuditLogs：GET /api/admin/logs 并透传过滤参数', async () => {
    const LOG = {
      id: 'log-1',
      userId: 'u-1',
      username: 'alice',
      action: 'words.create',
      resource: 'words',
      resourceId: 'apple',
      result: 'success',
      detail: null,
      ip: '127.0.0.1',
      createdAt: 1700000000000,
    }
    const calls = installFetchMock({ json: { items: [LOG], total: 1, limit: 50, offset: 0 } })
    const result = await listAuditLogs({ action: 'words.create', userId: 'u-1', limit: 50 })
    expect(result.total).toBe(1)
    expect(result.items[0].action).toBe('words.create')
    expect(calls[0].url).toContain('/api/admin/logs?')
    expect(calls[0].url).toContain('action=words.create')
    expect(calls[0].url).toContain('userId=u-1')
    expect(calls[0].url).toContain('limit=50')
  })

  it('getClassStats：GET /api/admin/class-stats?days=N 并携带会话令牌', async () => {
    const RESULT = {
      days: 7,
      from: '2026-10-14',
      to: '2026-10-20',
      summary: {
        studentCount: 1,
        activeStudentCount: 1,
        totalArticlesRead: 2,
        totalWordsLearned: 3,
        totalWordsReviewed: 4,
        avgArticlesRead: 2,
        avgCorrectRate: 0.75,
        totalReadingDurationSec: 600,
        totalSessions: 2,
      },
      students: [
        {
          userId: 'u-2',
          username: 'bob',
          displayName: '鲍勃',
          articlesRead: 2,
          wordsLearned: 3,
          wordsReviewed: 4,
          wordsMastered: 1,
          activeDays: 2,
          streak: 2,
          lastActiveDate: '2026-10-20',
          correctRate: 0.75,
        },
      ],
    }
    const calls = installFetchMock({ json: RESULT })
    const result = await getClassStats(7)
    expect(result.summary.totalArticlesRead).toBe(2)
    expect(result.students[0]!.displayName).toBe('鲍勃')
    expect(calls[0].url).toContain('/api/admin/class-stats?days=7')
    expect(calls[0].headers['x-user-token']).toBe(TOKEN)
  })

  it('getClassStats：403 时抛出统一无权限文案', async () => {
    installFetchMock({ ok: false, status: 403, json: { error: { code: 'FORBIDDEN' } } })
    await expect(getClassStats(30)).rejects.toThrow('无权限执行该操作')
  })
})
