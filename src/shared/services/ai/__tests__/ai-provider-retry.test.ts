// AI Provider 超时与重试
//
// AbortController 超时控制与指数退避重试（5xx 重试 / 4xx 直接失败）。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { AIError } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, installFetchMockSequence, restoreFetch, installImmediateSetTimeout } from '@/test/setup'

describe('AI Provider 超时与重试', () => {
  it('callChat 超时应抛出 AIError 且 message 包含"超时"', async () => {
    // mock fetch 永不 resolve，依赖 AbortController 触发拒绝
    installFetchMock({ neverResolve: true })
    // 将所有 setTimeout 降为 0ms，避免真等 30s 超时与指数退避
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('超时')).toBe(true)
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })

  it('5xx 响应应重试 2 次后抛出 AIError（共 3 次 fetch）', async () => {
    // mock fetch 始终返回 500
    const calls = installFetchMock({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    // 跳过指数退避等待（1s/2s）
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      // 首次 + 2 次重试 = 3 次 fetch
      expect(calls.length).toBe(3)
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('HTTP 500')).toBe(true)
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })

  it('4xx 响应不重试，立即抛出 AIError（仅 1 次 fetch）', async () => {
    // mock fetch 返回 401
    const calls = installFetchMock({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      // 4xx 不重试，立即抛出
      expect(calls.length).toBe(1)
      expect(caught instanceof AIError).toBe(true)
      // 401 现使用 getDeepSeekErrorMessage 返回官方中文提示（含"认证失败"）
      expect((caught as AIError).message.includes('认证失败')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('5xx 后重试成功：第 2 次 fetch 返回 200，应返回正常内容', async () => {
    // mock fetch 第一次返回 500，第二次返回 200 + 有效内容
    const calls = installFetchMockSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error' },
      { ok: true, json: { choices: [{ message: { content: '重试成功' } }] } },
    ])
    // 跳过指数退避等待
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      const result = await provider.generateTranslation('hello')
      // 首次失败 + 1 次重试 = 2 次 fetch
      expect(calls.length).toBe(2)
      expect(result).toBe('重试成功')
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })
})
