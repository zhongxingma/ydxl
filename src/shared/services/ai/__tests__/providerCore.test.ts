// ProviderCore 核心层测试
//
// 覆盖配置与容错分支：
// 1. keyResolver 抛错 / 返回空串 → 按未配置密钥处理并 warn
// 2. 默认模型分级返回 undefined
// 3. 缓存命中统计写入失败 → 仍返回缓存值
// 4. 缓存写入失败 → 仍返回新请求内容
//
// Mock 策略：mock responseCache 与 tokenStats，子类覆盖 callChat 隔离传输层，
// 不发起真实网络请求。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChatMessage } from '../types'

const mocks = vi.hoisted(() => ({
  computeCacheKey: vi.fn(),
  getCached: vi.fn(),
  setCached: vi.fn(),
  recordUsage: vi.fn(),
}))

vi.mock('../responseCache', () => ({
  computeCacheKey: mocks.computeCacheKey,
  getCached: mocks.getCached,
  setCached: mocks.setCached,
}))

vi.mock('../tokenStats', () => ({
  recordUsage: mocks.recordUsage,
  // setup.ts 在 afterEach 中调用 resetStats，此处提供空实现避免被 mock 影响
  resetStats: vi.fn(),
}))

import { ProviderCore, type BaseProviderConfig } from '../providerCore'

// 最小可实例化子类：传输层 callChat 直接返回固定内容
class TestProvider extends ProviderCore {
  constructor(config: BaseProviderConfig = {}) {
    super({ apiKey: 'test-key', ...config })
  }

  providerName(): string {
    return 'test-unknown'
  }

  defaultEndpoint(): string {
    return 'https://example.test/v1/chat'
  }

  protected defaultModel(): string {
    return 'test-model'
  }

  buildRequestBody(messages: ChatMessage[]): unknown {
    return { messages }
  }

  parseContent(): string {
    return ''
  }

  protected async callChat(): Promise<string> {
    return 'fresh-content'
  }

  // 暴露被测的受保护 / 私有成员
  chatCached(
    scenario: string,
    messages: ChatMessage[],
    options: { ttlMs: number; expectArray?: boolean },
  ): Promise<string> {
    return this.callChatCached(scenario, messages, options)
  }

  flashModel(): string | undefined {
    return this.getFlashModel()
  }

  effectiveApiKey(): Promise<string | undefined> {
    return (
      this as unknown as { getEffectiveApiKey: () => Promise<string | undefined> }
    ).getEffectiveApiKey()
  }
}

const CHAT_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'usr' },
]

describe('ProviderCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.computeCacheKey.mockResolvedValue('cache-key')
    mocks.getCached.mockResolvedValue(null)
    mocks.setCached.mockResolvedValue(undefined)
    mocks.recordUsage.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keyResolver 抛错 → 按未配置密钥处理并 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = new TestProvider({
      apiKey: undefined,
      keyResolver: async () => {
        throw new Error('secure storage down')
      },
    })

    await expect(provider.effectiveApiKey()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      '[base-provider] 运行时密钥解析失败，按未配置处理',
      expect.any(Error),
    )
  })

  it('keyResolver 返回空串 → 视为未配置密钥', async () => {
    const provider = new TestProvider({
      apiKey: undefined,
      keyResolver: async () => '',
    })

    await expect(provider.effectiveApiKey()).resolves.toBeUndefined()
  })

  it('显式 apiKey 优先于 keyResolver', async () => {
    const resolver = vi.fn(async () => 'resolved-key')
    const provider = new TestProvider({ apiKey: 'explicit-key', keyResolver: resolver })

    await expect(provider.effectiveApiKey()).resolves.toBe('explicit-key')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('getFlashModel 默认不分级 → 返回 undefined', () => {
    expect(new TestProvider().flashModel()).toBeUndefined()
  })

  it('缓存命中 → 返回缓存值并记录 cacheHit 统计', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    mocks.getCached.mockResolvedValue({ value: 'cached-content', isMemory: true })
    const provider = new TestProvider()

    const result = await provider.chatCached('scenario', CHAT_MESSAGES, { ttlMs: 1000 })

    expect(result).toBe('cached-content')
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      'scenario',
      'test-model',
      { prompt_tokens: 0, completion_tokens: 0 },
      true,
    )
    expect(mocks.setCached).not.toHaveBeenCalled()
    debug.mockRestore()
  })

  it('缓存命中统计写入抛错 → 仍返回缓存值并 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    mocks.getCached.mockResolvedValue({ value: 'cached-content', isMemory: false })
    mocks.recordUsage.mockImplementation(() => {
      throw new Error('stats fail')
    })
    const provider = new TestProvider()

    const result = await provider.chatCached('scenario', CHAT_MESSAGES, { ttlMs: 1000 })

    expect(result).toBe('cached-content')
    expect(warn).toHaveBeenCalledWith(
      '[base-provider] 缓存命中统计失败',
      expect.any(Error),
    )
  })

  it('缓存写入失败 → 仍返回新请求内容并 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.setCached.mockRejectedValue(new Error('cache write fail'))
    const provider = new TestProvider()

    const result = await provider.chatCached('scenario', CHAT_MESSAGES, { ttlMs: 1000 })

    expect(result).toBe('fresh-content')
    expect(warn).toHaveBeenCalledWith('[base-provider] 缓存写入失败', expect.any(Error))
  })

  it('expectArray 场景使用 array 变体缓存 key', async () => {
    const provider = new TestProvider()

    await provider.chatCached('scenario', CHAT_MESSAGES, { ttlMs: 1000, expectArray: true })

    expect(mocks.computeCacheKey).toHaveBeenCalledWith(
      'scenario',
      'test-model',
      'sys',
      'usr',
      'array',
    )
  })
})
