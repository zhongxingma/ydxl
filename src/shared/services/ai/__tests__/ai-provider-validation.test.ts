// AI Provider 字段校验与错误处理
//
// 生成结果缺失必填字段的校验与各 HTTP 状态码的错误映射。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { AIError } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'

describe('AI Provider 字段校验与错误处理增强', () => {
  it('generateArticle 缺少 topic 字段应抛出 AIError 且 message 包含字段名', async () => {
    // 缺少 topic / difficulty / lexileRange / highlightedWords
    const article = {
      title: 'Incomplete Article',
      content: 'Some content here.',
      translation: '一些内容。',
      genre: 'narrative',
      wordCount: 3,
    }
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateArticle('2024-01-01')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('缺少必要字段')).toBe(true)
      expect((caught as AIError).message.includes('topic')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 缺少 lexileRange 字段应抛出 AIError 且 message 包含 lexileRange', async () => {
    const article = {
      title: 'Article',
      content: 'Content.',
      translation: '内容。',
      genre: 'narrative',
      wordCount: 1,
      topic: 'campus',
      difficulty: 'easy',
      // 缺少 lexileRange
      highlightedWords: [
        {
          word: 'brave',
          phonetic: '/breɪv/',
          pos: 'adj.',
          definition: '勇敢的',
          example: 'a brave boy',
        },
      ],
    }
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateArticle('2024-01-01')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('lexileRange')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 缺少 highlightedWords 字段应抛出 AIError', async () => {
    const article = {
      title: 'Article',
      content: 'Content.',
      translation: '内容。',
      genre: 'narrative',
      wordCount: 1,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 500, max: 600 },
      // 缺少 highlightedWords
    }
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      let caught: unknown
      try {
        await provider.generateArticle('2024-01-01')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('highlightedWords')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('callChat 4xx 响应含结构化 error.message 应在异常中携带该消息', async () => {
    // 上游返回 4xx + { error: { code, message } } 结构化错误
    // 注：400/401/402/422 现使用 getDeepSeekErrorMessage 返回官方中文提示，
    // 这里使用 403（非预定义 4xx）验证通用路径下结构化 error.message 仍被携带
    installFetchMock({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: { error: { code: 'invalid_api_key', message: 'Invalid API key' } },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('HTTP 403')).toBe(true)
      expect((caught as AIError).message.includes('Invalid API key')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('callChat 4xx 响应为纯文本时应回退到 res.text() 携带文本', async () => {
    // 上游返回 4xx + 非 JSON 文本（模拟 json 解析失败回退 text）
    // 注意：mock 中 json 与 text 独立，json 返回非对象会使 typeof errBody === 'object' 失败
    // 这里让 json 返回一个无 error 字段的对象，触发 else 分支回退到 text
    installFetchMock({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: { message: 'rate limit exceeded' }, // 无 error.message 字段
      text: 'Rate limit exceeded, please retry later',
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('HTTP 429')).toBe(true)
      expect((caught as AIError).message.includes('Rate limit exceeded')).toBe(true)
    } finally {
      restoreFetch()
    }
  })
})
