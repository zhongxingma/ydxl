// secureStorage 读写测试
// 1. 加密可用：值以 enc:v1: 密文写入 localStorage，可正确解密读回
// 2. 加密不可用（IndexedDB 缺失）：仅保存在内存，绝不写明文到 localStorage
import { describe, it, expect, afterEach, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  localStorage.clear()
})

describe('secureStorage', () => {
  it('加密可用时写入密文并可解密读回', async () => {
    vi.resetModules()
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-key-1', 'api-key-secret')

    const raw = localStorage.getItem('secure-key-1')
    expect(raw?.startsWith('enc:v1:')).toBe(true)
    expect(raw).not.toContain('api-key-secret')
    expect(await secureGetItem('secure-key-1')).toBe('api-key-secret')
  })

  it('IndexedDB 不可用时仅内存保存，不落明文', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined)
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-key-2', 'plain-secret')

    expect(localStorage.getItem('secure-key-2')).toBeNull()
    expect(await secureGetItem('secure-key-2')).toBe('plain-secret')
  })
})
