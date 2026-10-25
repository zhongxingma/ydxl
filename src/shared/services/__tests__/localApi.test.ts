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
