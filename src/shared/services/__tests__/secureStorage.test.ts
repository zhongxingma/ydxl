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

  it('未写入时读取返回空字符串', async () => {
    vi.resetModules()
    const { secureGetItem } = await import('../secureStorage')

    expect(await secureGetItem('secure-missing')).toBe('')
  })

  it('旧明文值直接返回（向后兼容）', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined)
    localStorage.setItem('secure-legacy', 'legacy-plain')
    const { secureGetItem } = await import('../secureStorage')

    expect(await secureGetItem('secure-legacy')).toBe('legacy-plain')
  })

  it('加密不可用时读取密文返回去除前缀的内容', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined)
    localStorage.setItem('secure-enc', 'enc:v1:abc:def')
    const { secureGetItem } = await import('../secureStorage')

    expect(await secureGetItem('secure-enc')).toBe('abc:def')
  })

  it('密文缺少分隔符时返回空字符串', async () => {
    vi.resetModules()
    localStorage.setItem('secure-malformed', 'enc:v1:no-separator')
    const { secureGetItem } = await import('../secureStorage')

    expect(await secureGetItem('secure-malformed')).toBe('')
  })

  it('密文解密失败时返回空字符串', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const iv = btoa('123456789012')
    const ciphertext = btoa('not-a-valid-cipher')
    localStorage.setItem('secure-broken', `enc:v1:${iv}:${ciphertext}`)
    const { secureGetItem } = await import('../secureStorage')

    expect(await secureGetItem('secure-broken')).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('localStorage 写入失败时不抛出', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
    vi.resetModules()
    const { secureSetItem } = await import('../secureStorage')

    await expect(secureSetItem('secure-quota', 'value')).resolves.toBeUndefined()

    setItem.mockRestore()
    warn.mockRestore()
  })

  it('内存降级值优先于 localStorage 旧值', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined)
    const { secureSetItem, secureGetItem } = await import('../secureStorage')

    await secureSetItem('secure-priority', 'memory-value')
    localStorage.setItem('secure-priority', 'legacy-value')

    expect(await secureGetItem('secure-priority')).toBe('memory-value')
  })
})
