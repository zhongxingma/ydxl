// Sentry 可选集成测试（前端）
//
// 覆盖：
// - 未配置 VITE_SENTRY_DSN：initSentry 直接返回、不加载 SDK、不调用 Sentry.init；
//   captureException 为 no-op（不抛错、不上报、不发网络请求）
// - 配置 VITE_SENTRY_DSN：动态加载 @sentry/react 并调用 Sentry.init；
//   captureException 转发 error 与 extra
// - 初始化前 captureException 为 no-op；重复 initSentry 不重复初始化
//
// 通过 vi.mock('@sentry/react') 接住动态 import，断言 SDK 是否被加载/调用，
// 同时杜绝测试中真实 SDK 的网络请求；vi.stubEnv 控制 DSN 配置状态，
// vi.resetModules 保证每个用例拿到全新的 sentry 模块状态
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 动态 import('@sentry/react') 命中此 mock（含 init / captureException 调用记录）
const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}))
vi.mock('@sentry/react', () => sentryMocks)

describe('sentry（可选错误上报）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // ===== 未配置 DSN：零副作用 =====

  it('未配置 DSN：initSentry 直接返回，不加载 SDK、不调用 Sentry.init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initSentry } = await import('../sentry')

    await expect(initSentry()).resolves.toBeUndefined()

    expect(sentryMocks.init).not.toHaveBeenCalled()
  })

  it('未配置 DSN：captureException 为 no-op，不抛错、不上报、不发请求', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { initSentry, captureException } = await import('../sentry')
    await initSentry()

    expect(() =>
      captureException(new Error('测试错误'), { componentStack: '\n    at Throw' })
    ).not.toThrow()

    expect(sentryMocks.captureException).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('未初始化（initSentry 未调用）：captureException 为 no-op 不抛错', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/42')
    const { captureException } = await import('../sentry')

    expect(() => captureException('非 Error 对象')).not.toThrow()
    expect(sentryMocks.captureException).not.toHaveBeenCalled()
    expect(sentryMocks.init).not.toHaveBeenCalled()
  })

  // ===== 配置 DSN：动态加载并上报 =====

  it('配置 DSN：动态加载 SDK 并以 dsn / environment / tracesSampleRate 调用 Sentry.init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/42')
    const { initSentry } = await import('../sentry')

    await initSentry()

    expect(sentryMocks.init).toHaveBeenCalledTimes(1)
    const initOptions = sentryMocks.init.mock.calls[0]?.[0] as
      | { dsn?: string; environment?: string; tracesSampleRate?: number }
      | undefined
    expect(initOptions?.dsn).toBe('https://public@example.com/42')
    expect(typeof initOptions?.environment).toBe('string')
    expect(typeof initOptions?.tracesSampleRate).toBe('number')
  })

  it('初始化后 captureException 转发 error 与 extra 给 Sentry', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/42')
    const { initSentry, captureException } = await import('../sentry')
    await initSentry()
    const error = new Error('渲染失败')

    captureException(error, { componentStack: '\n    at Throw' })

    expect(sentryMocks.captureException).toHaveBeenCalledWith(error, {
      extra: { componentStack: '\n    at Throw' },
    })
  })

  it('初始化后 captureException 无 extra 时正常转发', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/42')
    const { initSentry, captureException } = await import('../sentry')
    await initSentry()
    const error = new Error('无附加信息')

    captureException(error)

    expect(sentryMocks.captureException).toHaveBeenCalledWith(error, undefined)
  })

  it('重复调用 initSentry 不会重复初始化', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/42')
    const { initSentry } = await import('../sentry')

    await initSentry()
    await initSentry()

    expect(sentryMocks.init).toHaveBeenCalledTimes(1)
  })
})
