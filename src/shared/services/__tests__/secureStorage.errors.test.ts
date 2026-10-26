// secureStorage 密钥加载错误路径测试
//
// 覆盖 loadOrCreateKey 的四类失败场景（均降级为内存存储，绝不落明文）：
// 1. indexedDB.open 同步抛错
// 2. indexedDB.open 请求 onerror
// 3. 已存在密钥但 crypto.subtle.importKey 失败
// 4. 无已存在密钥且 crypto.subtle.generateKey 失败
//
// 说明：jsdom 默认由 fake-indexeddb 提供 IndexedDB，本文件通过 stubGlobal 注入
// 可控的伪 IndexedDB 请求对象（onnext handler 赋值后以微任务触发），配合
// vi.resetModules 让模块级密钥缓存失效，从而进入各错误分支。
import { describe, it, expect, afterEach, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
})

// 构造自动触发指定回调的 IDBRequest 伪对象：
// 业务代码同步为 onsuccess/onerror 赋值后，微任务里调用预先声明的结果回调。
function makeAutoRequest(result: unknown, outcome: 'onsuccess' | 'onerror'): IDBRequest {
  const target: Record<string, unknown> = {
    result,
    error: new Error('idb request error'),
  }
  let scheduled = false
  return new Proxy(target, {
    set(obj, prop, value) {
      obj[prop as string] = value
      if (!scheduled && (prop === 'onsuccess' || prop === 'onerror')) {
        scheduled = true
        queueMicrotask(() => {
          const handler = obj[outcome] as (() => void) | undefined
          if (typeof handler === 'function') handler()
        })
      }
      return true
    },
  }) as unknown as IDBRequest
}

// 伪造 IDBDatabase：仅实现 readKeyFromDB 使用的 transaction().objectStore().get()
function makeFakeDb(getRequest: IDBRequest): IDBDatabase {
  return {
    objectStoreNames: { contains: () => true },
    close: vi.fn(),
    transaction: () => ({
      objectStore: () => ({ get: () => getRequest }),
      oncomplete: null,
      onerror: null,
    }),
  } as unknown as IDBDatabase
}

describe('secureStorage 密钥加载错误路径', () => {
  it('indexedDB.open 同步抛错 → warn 并降级内存存储', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('indexeddb blocked')
      },
    })
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-sync-fail', 'secret-value')

    expect(warn).toHaveBeenCalledWith(
      '[secureStorage] IndexedDB 异常，降级明文存储',
      expect.any(Error),
    )
    // 绝不落明文：仅当前会话内存可读
    expect(localStorage.getItem('secure-sync-fail')).toBeNull()
    expect(await secureGetItem('secure-sync-fail')).toBe('secret-value')
  })

  it('indexedDB.open 请求 onerror → warn 并降级内存存储', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    vi.stubGlobal('indexedDB', { open: () => makeAutoRequest(undefined, 'onerror') })
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-open-fail', 'secret-value')

    expect(warn).toHaveBeenCalledWith(
      '[secureStorage] 打开 IndexedDB 失败，降级明文存储',
    )
    expect(localStorage.getItem('secure-open-fail')).toBeNull()
    expect(await secureGetItem('secure-open-fail')).toBe('secret-value')
  })

  it('已存在密钥但 importKey 失败 → warn 并降级内存存储', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const getRequest = makeAutoRequest(new ArrayBuffer(16), 'onsuccess')
    const openRequest = makeAutoRequest(makeFakeDb(getRequest), 'onsuccess')
    vi.stubGlobal('indexedDB', { open: () => openRequest })
    const importKey = vi
      .spyOn(crypto.subtle, 'importKey')
      .mockRejectedValue(new Error('import-key-failed'))
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-import-fail', 'secret-value')

    expect(importKey).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[secureStorage] 密钥加载失败，降级明文存储',
      expect.any(Error),
    )
    expect(localStorage.getItem('secure-import-fail')).toBeNull()
    expect(await secureGetItem('secure-import-fail')).toBe('secret-value')
  })

  it('无已存在密钥且 generateKey 失败 → warn 并降级内存存储', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const getRequest = makeAutoRequest(undefined, 'onsuccess')
    const openRequest = makeAutoRequest(makeFakeDb(getRequest), 'onsuccess')
    vi.stubGlobal('indexedDB', { open: () => openRequest })
    const generateKey = vi
      .spyOn(crypto.subtle, 'generateKey')
      .mockRejectedValue(new Error('generate-key-failed'))
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-generate-fail', 'secret-value')

    expect(generateKey).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[secureStorage] 密钥加载失败，降级明文存储',
      expect.any(Error),
    )
    expect(localStorage.getItem('secure-generate-fail')).toBeNull()
    expect(await secureGetItem('secure-generate-fail')).toBe('secret-value')
  })
})
