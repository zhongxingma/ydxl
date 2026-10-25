// enrichSingleWord 单词补全
//
// 成功返回音标 / 词性 / 释义 / 例句，以及 400/401/402/422/429/500 错误场景。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { AIError, type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, installFetchMockSequence, restoreFetch, installImmediateSetTimeout } from '@/test/setup'

describe('enrichSingleWord', () => {
  // 验证返回值字段正确，且请求体包含 response_format / max_tokens / thinking 配置
  it('成功返回单词的音标/词性/释义/例句，且请求体含 jsonMode/maxTokens/thinkingDisabled', async () => {
    const wordHint = {
      phonetic: '/test/',
      pos: 'n.',
      definition: '测试',
      example: 'This is a test.',
    }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(wordHint) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      const result = await provider.enrichSingleWord('test')

      // 验证返回值包含正确的 phonetic/pos/definition/example
      expect(result.phonetic).toBe('/test/')
      expect(result.pos).toBe('n.')
      expect(result.definition).toBe('测试')
      expect(result.example).toBe('This is a test.')
      // enrichSingleWord 会将 word 字段设为输入值（大小写不敏感校验后回填）
      expect(result.word).toBe('test')

      // 验证 fetch 被调用一次
      expect(calls.length).toBe(1)

      // 验证请求体包含 response_format、max_tokens、thinking 三个关键字段
      const body = JSON.parse(calls[0].body) as {
        response_format?: { type: string }
        max_tokens?: number
        thinking?: { type: string }
        messages: ChatMessage[]
      }
      expect(body.response_format).toEqual({ type: 'json_object' })
      // 2026-07-26 修复生词补全失败：512 → 1024（含 0-3 个 phrases 时实际需求 350-600 token，512 处于临界值会截断）
      expect(body.max_tokens).toBe(1024)
      expect(body.thinking).toEqual({ type: 'disabled' })
    } finally {
      restoreFetch()
    }
  })

  // 400：请求体格式错误，不可重试，抛 AIError
  it('400 响应应抛出 AIError 且 message 含"请求体格式错误"', async () => {
    const calls = installFetchMock({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: { error: { message: 'bad request' } },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.enrichSingleWord('test')
      } catch (err) {
        caught = err
      }
      // 4xx 不可重试，仅 1 次 fetch
      expect(calls.length).toBe(1)
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('请求体格式错误')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  // 401：API key 错误，不可重试，抛 AIError
  it('401 响应应抛出 AIError 且 message 含"API key 错误"', async () => {
    const calls = installFetchMock({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: { error: { message: 'unauthorized' } },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.enrichSingleWord('test')
      } catch (err) {
        caught = err
      }
      expect(calls.length).toBe(1)
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('API key 错误')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  // 402：余额不足，不可重试，抛 AIError
  it('402 响应应抛出 AIError 且 message 含"余额不足"', async () => {
    const calls = installFetchMock({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      json: { error: { message: 'insufficient balance' } },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.enrichSingleWord('test')
      } catch (err) {
        caught = err
      }
      expect(calls.length).toBe(1)
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('余额不足')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  // 422：参数错误，不可重试，抛 AIError
  it('422 响应应抛出 AIError 且 message 含"参数错误"', async () => {
    const calls = installFetchMock({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: { error: { message: 'param error' } },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.enrichSingleWord('test')
      } catch (err) {
        caught = err
      }
      expect(calls.length).toBe(1)
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('参数错误')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  // 429：限速，可重试；验证首次 429 后重试成功
  it('429 响应应触发重试，重试后成功返回', async () => {
    const wordHint = {
      phonetic: '/test/',
      pos: 'n.',
      definition: '测试',
      example: 'This is a test.',
    }
    const calls = installFetchMockSequence([
      { ok: false, status: 429, statusText: 'Too Many Requests' },
      { ok: true, json: { choices: [{ message: { content: JSON.stringify(wordHint) } }] } },
    ])
    // 跳过指数退避等待
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      const result = await provider.enrichSingleWord('test')

      // 首次 429 失败 + 1 次重试成功 = 2 次 fetch
      expect(calls.length).toBe(2)
      expect(result.phonetic).toBe('/test/')
      expect(result.definition).toBe('测试')
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })

  // 500：服务器错误，可重试；验证重试 2 次耗尽后抛出 AIError（共 3 次 fetch）
  it('500 响应应重试 2 次后抛出 AIError（共 3 次 fetch）', async () => {
    const calls = installFetchMock({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    // 跳过指数退避等待
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.enrichSingleWord('test')
      } catch (err) {
        caught = err
      }
      // 首次 + 2 次重试 = 3 次 fetch
      expect(calls.length).toBe(3)
      expect(caught instanceof AIError).toBe(true)
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })
})
