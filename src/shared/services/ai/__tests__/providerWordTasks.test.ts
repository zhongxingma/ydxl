// providerWordTasks 单词类任务单元测试
//
// 覆盖场景：
// 1. generateWordHint：成功返回、缺字段抛错、chat 失败包装
// 2. generateWordBreakdown：成功、phonics/syllables 字段非法抛错
// 3. generateMnemonic / generateExampleSentence / generateEmojiHint：成功透传
// 4. enrichSingleWord：返回 word 大小写不一致时回填输入值
// 5. testConnection：成功、空内容抛错、底层失败包装
//
// Mock 策略：通过类型断言访问 protected 的 callChat / callChatCached 并 spy，
// 避免真实网络请求；prompt 使用真实实现。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIError, type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'

interface CallOptions {
  jsonMode?: boolean
  maxTokens?: number
  thinkingDisabled?: boolean
  modelOverride?: string
  ttlMs?: number
  scenario?: string
  expectArray?: boolean
}

interface Internals {
  callChat: (messages: ChatMessage[], options?: CallOptions) => Promise<string>
  callChatCached: (
    scenario: string,
    messages: ChatMessage[],
    options: CallOptions,
  ) => Promise<string>
}

function getInternals(provider: DeepSeekProvider): Internals {
  return provider as unknown as Internals
}

function makeProvider(): DeepSeekProvider {
  return new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
}

describe('WordTaskProvider', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generateWordHint', () => {
    it('成功返回图片联想与助记', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({ imageAssociation: '一个苹果', mnemonic: 'a-pple 阿婆' }),
      )

      const result = await provider.generateWordHint('apple', '苹果')

      expect(result.imageAssociation).toBe('一个苹果')
      expect(result.mnemonic).toBe('a-pple 阿婆')
    })

    it('缺少必要字段时抛出明确错误', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({ imageAssociation: '只有一个字段' }),
      )

      await expect(provider.generateWordHint('apple', '苹果')).rejects.toThrow(
        /单词提示结果缺少必要字段/,
      )
    })

    it('底层 chat 失败时包装为生成失败', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockRejectedValue(new Error('network down'))

      await expect(provider.generateWordHint('apple', '苹果')).rejects.toThrow(
        /生成单词提示失败：network down/,
      )
    })
  })

  describe('generateWordBreakdown', () => {
    it('成功返回音素与音节数', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({ phonics: ['æ', 'p', 'l'], syllables: 2 }),
      )

      const result = await provider.generateWordBreakdown('apple')

      expect(result.phonics).toEqual(['æ', 'p', 'l'])
      expect(result.syllables).toBe(2)
    })

    it('phonics 非数组时抛出明确错误', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({ phonics: 'bad', syllables: 2 }),
      )

      await expect(provider.generateWordBreakdown('apple')).rejects.toThrow(
        /拼读分解结果缺少必要字段/,
      )
    })

    it('syllables 非数字时抛出明确错误', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({ phonics: ['æ'], syllables: 'two' }),
      )

      await expect(provider.generateWordBreakdown('apple')).rejects.toThrow(
        /拼读分解结果缺少必要字段/,
      )
    })
  })

  describe('其他单词任务', () => {
    it('generateMnemonic 成功返回口诀', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({ mnemonic: '阿婆吃苹果' }),
      )

      expect(await provider.generateMnemonic('apple', '苹果')).toEqual({
        mnemonic: '阿婆吃苹果',
      })
    })

    it('generateExampleSentence 解析纯文本例句', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        'The apple is red.',
      )

      expect(await provider.generateExampleSentence('apple', '苹果')).toBe(
        'The apple is red.',
      )
    })

    it('generateEmojiHint 解析 emoji 数组', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify(['🍎', '😊']),
      )

      expect(await provider.generateEmojiHint('apple', '苹果')).toEqual(['🍎', '😊'])
    })

    it('enrichSingleWord 大小写一致时保留返回写法', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({
          word: 'Apple',
          phonetic: '/ˈæpl/',
          pos: 'n.',
          definition: '苹果',
          example: 'an apple',
          importance: 'high',
        }),
      )

      const result = await provider.enrichSingleWord('apple')

      expect(result.word).toBe('Apple')
      expect(result.definition).toBe('苹果')
    })

    it('enrichSingleWord 返回不同单词时回填输入值', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChatCached').mockResolvedValue(
        JSON.stringify({
          word: 'apples',
          phonetic: '/ˈæplz/',
          pos: 'n.',
          definition: '苹果（复数）',
          example: 'two apples',
          importance: 'high',
        }),
      )

      const result = await provider.enrichSingleWord('apple')

      expect(result.word).toBe('apple')
    })
  })

  describe('testConnection', () => {
    it('成功返回时 resolves', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      const chatSpy = vi.spyOn(internals, 'callChat').mockResolvedValue('OK')

      await expect(provider.testConnection()).resolves.toBeUndefined()
      expect(chatSpy).toHaveBeenCalledWith(expect.any(Array), {
        maxTokens: 512,
        scenario: 'connection_test',
      })
    })

    it('返回空内容时抛出明确错误', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChat').mockResolvedValue('   ')

      await expect(provider.testConnection()).rejects.toThrow(
        /接口连通但返回内容为空/,
      )
    })

    it('底层失败时包装为连接测试失败', async () => {
      const provider = makeProvider()
      const internals = getInternals(provider)
      vi.spyOn(internals, 'callChat').mockRejectedValue(new AIError('未配置 apiKey'))

      await expect(provider.testConnection()).rejects.toThrow(/未配置 apiKey/)
    })
  })
})
