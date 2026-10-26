// localApi 请求封装测试
// 覆盖：
// 1. 服务端标准错误体 { error: { message } } 能被正确透出（旧实现读取扁平 message 导致信息丢失）
// 2. 非 JSON 错误体回退到 statusText
// 3. 请求超时（15s）中止并给出明确错误
// 4. 外部 signal 取消与超时区分
import { describe, it, expect, afterEach, vi } from 'vitest'
import { localApi } from '../localApi'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('localApi 错误处理', () => {
  it('解析嵌套错误体 { error: { message } }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { code: 'INTERNAL_ERROR', message: '服务器繁忙' } }),
      }),
    )

    await expect(localApi.get('/articles')).rejects.toThrow('服务器繁忙')
  })

  it('错误体非 JSON 时回退到 statusText', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => {
          throw new SyntaxError('not json')
        },
      }),
    )

    await expect(localApi.get('/articles')).rejects.toThrow('Bad Gateway')
  })
})

describe('localApi 超时与取消', () => {
  function mockHangingFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        })
      }),
    )
  }

  it('15 秒无响应时中止并提示超时', async () => {
    vi.useFakeTimers()
    mockHangingFetch()

    const promise = localApi.get('/slow')
    const assertion = expect(promise).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })

  it('外部 signal 取消时提示已取消', async () => {
    mockHangingFetch()
    const controller = new AbortController()

    const promise = localApi.get('/slow', { signal: controller.signal })
    const assertion = expect(promise).rejects.toThrow('请求已取消')
    controller.abort()
    await assertion
  })
})

describe('localApi 会话失效与写请求', () => {
  it('401 清空会话并广播 unauthorized 事件', async () => {
    sessionStorage.setItem('ydxl-auth-token', 'expired-token')
    const listener = vi.fn()
    window.addEventListener('ydxl:unauthorized', listener)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({}),
      }),
    )

    try {
      await expect(localApi.get('/words')).rejects.toThrow('401 会话已失效')
      expect(sessionStorage.getItem('ydxl-auth-token')).toBeNull()
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('ydxl:unauthorized', listener)
    }
  })

  it('204 无内容响应返回 undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: async () => undefined,
      }),
    )

    await expect(localApi.get('/words')).resolves.toBeUndefined()
  })

  it('post / put / del 使用正确的路径、方法与请求体', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await localApi.post('/words', { word: 'apple' })
    await localApi.put('/words', 'apple', { word: 'apples' })
    await localApi.del('/words', 'apple')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/words',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ word: 'apple' }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/words/apple',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ word: 'apples' }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/words/apple',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
