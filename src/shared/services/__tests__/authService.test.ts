// authService 单元测试
// 覆盖：登录成功/失败、换账号清空本地缓存、登出清理、authHeaders、isInternalApiUrl
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  login,
  logout,
  getToken,
  getCurrentUser,
  clearSession,
  authHeaders,
  isInternalApiUrl,
  listSessions,
  revokeSession,
  logoutAll,
  changePassword,
} from '../authService'
import { db } from '../db'
import { installFetchMock } from '@/test/setup'

const LOGIN_OK_BODY = {
  token: 'session-token-abc',
  user: { id: 'u-alice', username: 'alice', displayName: '爱丽丝', role: 'student' },
}

function seedWord() {
  return db.words.put({
    id: 'apple',
    word: 'apple',
    phonetic: '',
    pos: '',
    definition: '苹果',
    example: '',
    mastery: 1,
    nextReview: 0,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: Date.now(),
    updated_at: Date.now(),
  })
}

describe('authService', () => {
  beforeEach(async () => {
    clearSession()
    localStorage.clear()
    await Promise.allSettled([db.words.clear(), db.articles.clear(), db.aiCache.clear()])
  })

  afterEach(() => {
    clearSession()
  })

  describe('login', () => {
    it('登录成功：写入 sessionStorage 会话并返回用户', async () => {
      const calls = installFetchMock({ json: LOGIN_OK_BODY })
      const user = await login('alice', 'pass-123')
      expect(user.id).toBe('u-alice')
      expect(getToken()).toBe('session-token-abc')
      expect(getCurrentUser()?.displayName).toBe('爱丽丝')
      // 请求体包含用户名密码
      expect(calls[0].url).toContain('/api/auth/login')
      expect(JSON.parse(calls[0].body)).toEqual({ username: 'alice', password: 'pass-123' })
    })

    it('登录成功：记录本地缓存归属为当前用户', async () => {
      installFetchMock({ json: LOGIN_OK_BODY })
      await login('alice', 'pass-123')
      expect(localStorage.getItem('ydxl-cache-owner')).toBe('u-alice')
    })

    it('换账号登录：清空上个账号的 Dexie 业务缓存', async () => {
      await seedWord()
      localStorage.setItem('ydxl-cache-owner', 'u-old')
      installFetchMock({ json: LOGIN_OK_BODY })
      await login('alice', 'pass-123')
      expect(await db.words.count()).toBe(0)
      expect(localStorage.getItem('ydxl-cache-owner')).toBe('u-alice')
    })

    it('换账号登录：清空 AI 缓存与用量记录', async () => {
      await db.aiCache.put({
        id: 'cache-entry-1',
        scenario: 'article',
        updatedAt: Date.now(),
      } as never)
      localStorage.setItem('ydxl-ai-usage', '[]')
      localStorage.setItem('ydxl-cache-owner', 'u-old')

      installFetchMock({ json: LOGIN_OK_BODY })
      await login('alice', 'pass-123')

      expect(await db.aiCache.count()).toBe(0)
      expect(localStorage.getItem('ydxl-ai-usage')).toBeNull()
    })

    it('同账号登录：保留本地缓存', async () => {
      await seedWord()
      localStorage.setItem('ydxl-cache-owner', 'u-alice')
      installFetchMock({ json: LOGIN_OK_BODY })
      await login('alice', 'pass-123')
      expect(await db.words.count()).toBe(1)
    })

    it('登录失败（401）：抛出服务端错误文案，不写入会话', async () => {
      installFetchMock({
        ok: false,
        status: 401,
        json: { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } },
      })
      await expect(login('alice', 'wrong')).rejects.toThrow('用户名或密码错误')
      expect(getToken()).toBeNull()
    })
  })

  describe('logout', () => {
    it('登出：吊销服务端会话 + 清空本地会话', async () => {
      installFetchMock({ json: LOGIN_OK_BODY })
      await login('alice', 'pass-123')
      const calls = installFetchMock({ status: 204, json: undefined })
      await logout()
      expect(calls[0].url).toContain('/api/auth/logout')
      expect(calls[0].headers['x-user-token']).toBe('session-token-abc')
      expect(getToken()).toBeNull()
      expect(getCurrentUser()).toBeNull()
    })

    it('服务端不可达时仍完成本地登出', async () => {
      installFetchMock({ json: LOGIN_OK_BODY })
      await login('alice', 'pass-123')
      // 模拟网络错误（fetch 直接抛异常）
      globalThis.fetch = (async () => {
        throw new Error('network down')
      }) as typeof fetch
      await logout()
      expect(getToken()).toBeNull()
    })
  })

  describe('authHeaders / isInternalApiUrl', () => {
    it('有会话时返回 x-user-token 头，无会话时返回空对象', () => {
      expect(authHeaders()).toEqual({})
      sessionStorage.setItem('ydxl-auth-token', 'tok-1')
      expect(authHeaders()).toEqual({ 'x-user-token': 'tok-1' })
    })

    it('相对路径与同源 URL 判定为内部 API，第三方域名为否', () => {
      expect(isInternalApiUrl('/api/words')).toBe(true)
      expect(isInternalApiUrl(`${window.location.origin}/api/words`)).toBe(true)
      expect(isInternalApiUrl('https://api.deepseek.com/chat/completions')).toBe(false)
      expect(isInternalApiUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(false)
    })
  })

  describe('session management (多用户 P3)', () => {
    it('listSessions：GET 我的设备并附带令牌头', async () => {
      sessionStorage.setItem('ydxl-auth-token', 'tok-1')
      const items = [
        {
          sessionId: 42,
          tokenFingerprint: '6f9c0d8e…a1b2',
          ip: '203.0.113.10',
          userAgent: 'Mozilla/5.0',
          createdAt: 1,
          expiresAt: 2,
          current: true,
        },
      ]
      const calls = installFetchMock({ json: { items } })
      const result = await listSessions()
      expect(calls[0].url).toContain('/api/auth/sessions')
      expect(calls[0].method).toBe('GET')
      expect(calls[0].headers['x-user-token']).toBe('tok-1')
      expect(result).toEqual(items)
    })

    it('listSessions：非 2xx 抛出服务端错误文案', async () => {
      installFetchMock({
        ok: false,
        status: 401,
        json: { error: { message: 'Authentication required' } },
      })
      await expect(listSessions()).rejects.toThrow('Authentication required')
    })

    it('revokeSession：DELETE 指定会话并附带令牌头', async () => {
      sessionStorage.setItem('ydxl-auth-token', 'tok-1')
      const calls = installFetchMock({ status: 204, json: undefined })
      await revokeSession(42)
      expect(calls[0].url).toContain('/api/auth/sessions/42')
      expect(calls[0].method).toBe('DELETE')
      expect(calls[0].headers['x-user-token']).toBe('tok-1')
    })

    it('revokeSession：非 2xx 抛出服务端错误文案', async () => {
      installFetchMock({
        ok: false,
        status: 404,
        json: { error: { message: '会话不存在或已过期' } },
      })
      await expect(revokeSession(42)).rejects.toThrow('会话不存在或已过期')
    })

    it('logoutAll：全端下线后清空本地会话与业务缓存', async () => {
      await seedWord()
      sessionStorage.setItem('ydxl-auth-token', 'tok-1')
      localStorage.setItem('ydxl-cache-owner', 'u-alice')
      const calls = installFetchMock({ status: 204, json: undefined })
      await logoutAll()
      expect(calls[0].url).toContain('/api/auth/sessions')
      expect(calls[0].method).toBe('DELETE')
      expect(calls[0].headers['x-user-token']).toBe('tok-1')
      expect(getToken()).toBeNull()
      expect(localStorage.getItem('ydxl-cache-owner')).toBeNull()
      expect(await db.words.count()).toBe(0)
    })

    it('logoutAll：非 2xx 抛出服务端错误文案', async () => {
      installFetchMock({
        ok: false,
        status: 500,
        json: { error: { message: '下线失败' } },
      })

      await expect(logoutAll()).rejects.toThrow('下线失败')
    })

    it('logoutAll：非 2xx 且无错误体时回退状态码文案', async () => {
      installFetchMock({ ok: false, status: 503, json: {} })

      await expect(logoutAll()).rejects.toThrow('全端下线失败（503）')
    })

    it('changePassword：成功后不抛错并携带令牌与新旧密码', async () => {
      sessionStorage.setItem('ydxl-auth-token', 'tok-change')
      const calls = installFetchMock({ status: 204, json: undefined })

      await expect(changePassword('old-pass', 'new-pass')).resolves.toBeUndefined()

      expect(calls[0].url).toContain('/api/auth/change-password')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].headers['x-user-token']).toBe('tok-change')
      expect(JSON.parse(calls[0].body)).toEqual({
        oldPassword: 'old-pass',
        newPassword: 'new-pass',
      })
    })

    it('changePassword：失败时透传服务端消息或回退状态码', async () => {
      installFetchMock({
        ok: false,
        status: 400,
        json: { error: { message: '原密码错误' } },
      })
      await expect(changePassword('bad', 'new')).rejects.toThrow('原密码错误')

      installFetchMock({ ok: false, status: 500, json: {} })
      await expect(changePassword('bad', 'new')).rejects.toThrow('修改密码失败（500）')
    })
  })

  describe('存储异常兜底', () => {
    it('sessionStorage 读取抛错时 getToken / getCurrentUser 返回 null', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })
      try {
        expect(getToken()).toBeNull()
        expect(getCurrentUser()).toBeNull()
      } finally {
        spy.mockRestore()
      }
    })

    it('用户信息 JSON 损坏时 getCurrentUser 返回 null', () => {
      sessionStorage.setItem('ydxl-auth-user', '{broken')
      expect(getCurrentUser()).toBeNull()
    })

    it('登录请求网络失败时抛出登录请求失败', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))

      await expect(login('alice', 'pass')).rejects.toThrow(/登录请求失败: network down/)
      expect(getToken()).toBeNull()
    })

    it('缓存归属读取失败时仍完成登录', async () => {
      const originalGetItem = Storage.prototype.getItem
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
        this: Storage,
        key: string,
      ) {
        if (key === 'ydxl-cache-owner') throw new Error('storage broken')
        return originalGetItem.call(this, key)
      })
      installFetchMock({ json: LOGIN_OK_BODY })

      try {
        const user = await login('alice', 'pass-123')
        expect(user.id).toBe('u-alice')
        expect(getToken()).toBe('session-token-abc')
      } finally {
        spy.mockRestore()
      }
    })
  })
})
