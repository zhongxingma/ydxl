// Sentry 可选集成测试（后端）
//
// 覆盖：
// - 未配置 SENTRY_DSN：initSentry 不加载 SDK、不调用 Sentry.init；
//   captureException 为 no-op（不抛错、不上报）
// - 配置 SENTRY_DSN：动态加载 @sentry/node 并调用 Sentry.init；captureException 转发上报
//
// 通过 vi.mock('@sentry/node') 接住动态 import，断言 SDK 是否被加载/调用，
// 同时杜绝测试中真实 SDK 的网络请求；vi.resetModules 保证每个用例拿到全新的模块状态
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

// 动态 import('@sentry/node') 命中此 mock（含 init / captureException 调用记录）
const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}))
vi.mock('@sentry/node', () => sentryMocks)

describe('sentry（可选错误上报，后端）', () => {
  const originalDsn = process.env.SENTRY_DSN

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (originalDsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = originalDsn
  })

  // ===== 未配置 SENTRY_DSN：零副作用 =====

  it('未配置 SENTRY_DSN：initSentry 直接返回，不加载 SDK、不调用 Sentry.init', async () => {
    delete process.env.SENTRY_DSN
    const { initSentry } = await import('../sentry.js')

    await expect(initSentry()).resolves.toBeUndefined()

    expect(sentryMocks.init).not.toHaveBeenCalled()
  })

  it('未配置 SENTRY_DSN：captureException 为 no-op，不抛错、不上报', async () => {
    delete process.env.SENTRY_DSN
    const { initSentry, captureException } = await import('../sentry.js')
    await initSentry()

    expect(() => captureException(new Error('测试错误'), { route: '/api/words' })).not.toThrow()

    expect(sentryMocks.captureException).not.toHaveBeenCalled()
  })

  it('未初始化（initSentry 未调用）：captureException 为 no-op 不抛错', async () => {
    process.env.SENTRY_DSN = 'https://public@example.com/42'
    const { captureException } = await import('../sentry.js')

    expect(() => captureException('非 Error 对象')).not.toThrow()
    expect(sentryMocks.captureException).not.toHaveBeenCalled()
    expect(sentryMocks.init).not.toHaveBeenCalled()
  })

  // ===== 配置 SENTRY_DSN：动态加载并上报 =====

  it('配置 SENTRY_DSN：动态加载 SDK 并以 dsn / environment / tracesSampleRate 调用 Sentry.init', async () => {
    process.env.SENTRY_DSN = 'https://public@example.com/42'
    const { initSentry } = await import('../sentry.js')

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
    process.env.SENTRY_DSN = 'https://public@example.com/42'
    const { initSentry, captureException } = await import('../sentry.js')
    await initSentry()
    const error = new Error('未捕获错误')

    captureException(error, { route: '/api/words' })

    expect(sentryMocks.captureException).toHaveBeenCalledWith(error, {
      extra: { route: '/api/words' },
    })
  })

  it('重复调用 initSentry 不会重复初始化', async () => {
    process.env.SENTRY_DSN = 'https://public@example.com/42'
    const { initSentry } = await import('../sentry.js')

    await initSentry()
    await initSentry()

    expect(sentryMocks.init).toHaveBeenCalledTimes(1)
  })
})
