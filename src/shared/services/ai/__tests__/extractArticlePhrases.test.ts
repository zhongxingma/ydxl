//
// 1. 正常返回：mock callChatCached 返回合法 JSON 数组，验证返回 ArticlePhrase[] 且每项含 phrase/meaning
// 2. 空数组：mock 返回 []，验证返回空数组不抛错
// 3. AI 失败：mock callChatCached 抛 AIError，验证 extractArticlePhrases 抛出 AIError
// 4. 缓存配置：验证 callChatCached 被调用时传入 ttlMs = Infinity（永久缓存）
//
// Mock 策略：spyOn DeepSeekProvider 实例的 callChatCached 方法（protected，需用类型断言访问）
// 参考 ai-provider.test.ts 的 mock 模式，但因测试聚焦 extractArticlePhrases 行为而非端到端 fetch 流程，
// 这里直接 mock callChatCached 隔离下游依赖

import { describe, it, expect, vi, afterEach } from 'vitest'
import { AIError } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import type { ArticlePhrase } from '@/shared/types'
import type { ChatMessage } from '../types'

// callChatCached 是 BaseAIProvider 的 protected 方法，需通过类型断言访问
// 这里定义内部方法的签名，便于 spyOn 时类型推断
interface CallChatCachedOptions {
  jsonMode?: boolean
  maxTokens?: number
  thinkingDisabled?: boolean
  modelOverride?: string
  reasoningEffort?: 'high' | 'max'
  ttlMs: number
}

type CallChatCachedFn = (
  scenario: string,
  messages: ChatMessage[],
  options: CallChatCachedOptions
) => Promise<string>

// 通过 as unknown as 获取 protected 方法的引用，避免 TS 报错
function getInternals(provider: DeepSeekProvider): { callChatCached: CallChatCachedFn } {
  return provider as unknown as { callChatCached: CallChatCachedFn }
}

// 创建带 apiKey 的 provider 实例（避免构造函数 warning 干扰测试输出）
function makeProvider(): DeepSeekProvider {
  return new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
}

describe('extractArticlePhrases', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 1. 正常返回
  it('正常返回：解析合法 JSON 数组并返回 ArticlePhrase[]', async () => {
    const provider = makeProvider()
    const phrases: ArticlePhrase[] = [
      {
        phrase: 'take care of',
        meaning: '照顾',
        example: 'She takes care of her little brother.',
        exampleTranslation: '她照顾她的小弟弟。',
      },
      {
        phrase: 'look forward to',
        meaning: '期待',
        example: 'I look forward to seeing you again.',
        exampleTranslation: '我期待再次见到你。',
      },
    ]
    vi.spyOn(getInternals(provider), 'callChatCached').mockResolvedValue(
      JSON.stringify(phrases)
    )

    const result = await provider.extractArticlePhrases('article content here')

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
    // 每项含 phrase / meaning
    expect(result[0].phrase).toBe('take care of')
    expect(result[0].meaning).toBe('照顾')
    expect(result[1].phrase).toBe('look forward to')
    expect(result[1].meaning).toBe('期待')
    // 例句与翻译字段也透传
    expect(result[0].example).toBe('She takes care of her little brother.')
    expect(result[0].exampleTranslation).toBe('她照顾她的小弟弟。')
  })

  // 2. 空数组
  it('空数组：mock 返回 [] 时返回空数组不抛错', async () => {
    const provider = makeProvider()
    vi.spyOn(getInternals(provider), 'callChatCached').mockResolvedValue('[]')

    const result = await provider.extractArticlePhrases('article content')

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })

  // 3. AI 失败
  it('AI 失败：callChatCached 抛 AIError 时 extractArticlePhrases 透传 AIError', async () => {
    const provider = makeProvider()
    vi.spyOn(getInternals(provider), 'callChatCached').mockRejectedValue(
      new AIError('AI 服务不可用')
    )

    await expect(provider.extractArticlePhrases('article content')).rejects.toThrow(AIError)
  })

  // 4. 缓存配置：验证 callChatCached 传入 ttlMs = Infinity（永久缓存）
  it('缓存配置：callChatCached 调用时传入 ttlMs = Infinity（永久缓存）', async () => {
    const provider = makeProvider()
    const spy = vi
      .spyOn(getInternals(provider), 'callChatCached')
      .mockResolvedValue('[]')

    await provider.extractArticlePhrases('article content')

    expect(spy).toHaveBeenCalledTimes(1)
    const callArgs = spy.mock.calls[0]
    // callChatCached(scenario, messages, options)
    expect(callArgs[0]).toBe('articlePhrases') // scenario 标识
    expect(callArgs[2].ttlMs).toBe(Infinity) // 永久缓存
    // 同时校验其他配置（jsonMode / thinkingDisabled / maxTokens / modelOverride）
    expect(callArgs[2].jsonMode).toBe(true)
    expect(callArgs[2].thinkingDisabled).toBe(true)
    expect(callArgs[2].maxTokens).toBe(1536)
    expect(callArgs[2].modelOverride).toBe('deepseek-v4-flash') // 模型分级降级
  })
})
