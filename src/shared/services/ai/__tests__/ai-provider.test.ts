// AI Provider 单元测试
//
// 已迁移到 vitest 风格（globals 模式）
// fetch mock 工具迁移至 src/test/setup.ts 中统一导出
//
// 测试覆盖：
// - parseJsonResponse：解析与容错（provider 无关的通用工具函数）
// - DeepSeekProvider：配置校验、OpenAI 兼容 API 请求格式、响应解析
// - 超时与重试机制
// - 字段校验与错误处理增强

import { AIError, type ChatMessage } from '../types'
import { parseJsonResponse } from '../jsonParsing'
import { DeepSeekProvider } from '../deepseekProvider'
import {
  questionsPrompt,
  vocabularyPrompt,
  wordEnrichPrompt,
  wordHintPrompt,
  wordBreakdownPrompt,
  mnemonicPrompt,
  emojiHintPrompt,
} from '../prompts'
import {
  installFetchMock,
  installFetchMockSequence,
  restoreFetch,
  installImmediateSetTimeout,
} from '@/test/setup'

// ---------- parseJsonResponse 测试 ----------

describe('parseJsonResponse', () => {
  it('解析纯 JSON 字符串', () => {
    const result = parseJsonResponse<{ a: number; b: string }>('{"a":1,"b":"hi"}')
    expect(result.a).toBe(1)
    expect(result.b).toBe('hi')
  })

  it('解析带 ```json 代码块的字符串', () => {
    const result = parseJsonResponse<{ a: number }>('```json\n{"a":42}\n```')
    expect(result.a).toBe(42)
  })

  it('解析带 ``` 代码块的字符串', () => {
    const result = parseJsonResponse<{ a: number }>('```\n{"a":7}\n```')
    expect(result.a).toBe(7)
  })

  it('解析前后带空白字符的字符串', () => {
    const result = parseJsonResponse<{ a: number }>('  \n\t{"a":99}\n  ')
    expect(result.a).toBe(99)
  })

  it('无效 JSON 抛出 AIError', () => {
    expect(() => parseJsonResponse('not a json')).toThrow(AIError)
    expect(() => parseJsonResponse('```json\n{invalid}\n```')).toThrow(AIError)
  })

  // ---------- 多级容错（第三方模型混杂输出兼容）----------

  it('解析 JSON 前带说明文字的输出（开源模型常见）', () => {
    const result = parseJsonResponse<{ a: number }>(
      '以下是解析结果：\n{"a":123}\n希望有帮助！'
    )
    expect(result.a).toBe(123)
  })

  it('解析 JSON 后带尾随文字的输出', () => {
    const result = parseJsonResponse<{ a: number; b: string }>(
      '{"a":1,"b":"hi"} 以上就是全部内容。'
    )
    expect(result.a).toBe(1)
    expect(result.b).toBe('hi')
  })

  it('字符串值中包含花括号时提取正确的平衡块', () => {
    // 字符串内的 { } 不应干扰括号配对
    const result = parseJsonResponse<{ text: string }>(
      '结果：{"text":"包含 {嵌套} 与 }符号 的内容"}'
    )
    expect(result.text).toBe('包含 {嵌套} 与 }符号 的内容')
  })

  it('字符串值中包含转义引号时提取正确的平衡块', () => {
    const result = parseJsonResponse<{ text: string }>(
      '结果：{"text":"他说：\\"你好\\""}'
    )
    expect(result.text).toBe('他说："你好"')
  })

  it('解析代码块包裹且块内含前后闲聊的输出', () => {
    // 围栏剥离后仍非纯 JSON，应继续走平衡块提取
    const result = parseJsonResponse<{ a: number }>(
      '```json\n好的，结果如下：{"a":8}\n```'
    )
    expect(result.a).toBe(8)
  })

  it('提取首个平衡的数组 JSON 块', () => {
    const result = parseJsonResponse<number[]>('列表：[1, 2, 3] 完毕')
    expect(result).toEqual([1, 2, 3])
  })

  it('括号不闭合（响应截断）时抛出 AIError', () => {
    expect(() => parseJsonResponse('{"a": 1, "b":')).toThrow(AIError)
  })
})

// ---------- DeepSeekProvider 测试 ----------
// DeepSeek 与 OpenAI 协议完全兼容，请求/响应格式一致，仅端点与默认模型不同

describe('DeepSeekProvider', () => {
  it('未配置 apiKey 且无 proxyBaseUrl 时调用方法应抛出 AIError', async () => {
    const provider = new DeepSeekProvider({})
    await expect(provider.generateArticle('2024-01-01')).rejects.toThrow(AIError)
  })

  it('直连模式应正确构造 OpenAI 兼容请求', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: '翻译结果' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek-key',
        model: 'deepseek-v4-pro',
      })
      const result = await provider.generateTranslation('hello')

      expect(result).toBe('翻译结果')

      // 验证请求 URL（直连模式应为 DeepSeek 端点）
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
      expect(calls[0].method).toBe('POST')

      // 验证请求头（直连模式应使用 Authorization: Bearer）
      expect(calls[0].headers['Content-Type']).toBe('application/json')
      expect(calls[0].headers['Authorization']).toBe('Bearer sk-deepseek-key')
      expect(calls[0].headers['x-user-token']).toBeUndefined()

      // 验证请求体结构（OpenAI 兼容：{ model, messages }）
      // 注：generateTranslation 为简单任务，使用模型分级降级到 deepseek-v4-flash（覆盖 config.model）
      const body = JSON.parse(calls[0].body) as {
        model: string
        messages: ChatMessage[]
      }
      expect(body.model).toBe('deepseek-v4-flash')
      expect(Array.isArray(body.messages)).toBe(true)
      expect(body.messages.length).toBe(2)
      expect(body.messages[0].role).toBe('system')
      expect(body.messages[1].role).toBe('user')
    } finally {
      restoreFetch()
    }
  })

  // 简单任务应使用 deepseek-v4-flash，复杂任务应使用 deepseek-v4-pro（或用户显式配置的模型）
  it('generateArticle 应使用 deepseek-v4-pro 模型（复杂任务不降级）', async () => {
    const article = {
      title: 'Test',
      content: 'Test content for article generation.',
      translation: '测试',
      genre: 'narrative',
      wordCount: 5,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
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
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateArticle('2024-01-01')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('deepseek-v4-pro')
    } finally {
      restoreFetch()
    }
  })

  it('generateQuestions 应使用 deepseek-v4-pro 模型', async () => {
    const questions = [
      {
        id: 'q-1',
        type: 'main_idea',
        stem: '题干',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '解析',
        locationClue: '线索',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(questions) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateQuestions('q', 'article content')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('deepseek-v4-pro')
    } finally {
      restoreFetch()
    }
  })

  it('generateWordBreakdown 应使用 deepseek-v4-flash 模型（简单任务降级）', async () => {
    const breakdown = { phonics: ['ap', 'ple'], syllables: 2 }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(breakdown) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateWordBreakdown('apple')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('deepseek-v4-flash')
    } finally {
      restoreFetch()
    }
  })

  it('generateEmojiHint 应使用 deepseek-v4-flash 模型', async () => {
    const emojis = ['🍎']
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(emojis) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateEmojiHint('apple', '苹果')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('deepseek-v4-flash')
    } finally {
      restoreFetch()
    }
  })

  it('enrichSingleWord 应使用 deepseek-v4-flash 模型', async () => {
    const wordInfo = {
      word: 'apple',
      phonetic: '/ˈæpl/',
      pos: 'n.',
      definition: '苹果',
      example: 'I like apple.',
      exampleTranslation: '我喜欢苹果。',
      phrases: [],
    }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(wordInfo) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.enrichSingleWord('apple')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('deepseek-v4-flash')
    } finally {
      restoreFetch()
    }
  })

  it('代理模式应使用代理地址并通过 x-user-token 传递令牌', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: 'https://proxy.example.com/api/',
        apiKey: 'proxy-token',
      })
      await provider.generateTranslation('hello')

      expect(calls[0].url).toBe('https://proxy.example.com/api/v1/ai-proxy/deepseek')
      expect(calls[0].headers['x-user-token']).toBe('proxy-token')
      expect(calls[0].headers['Authorization']).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 应正确解析响应（含 topic/difficulty/lexileRange/highlightedWords）', async () => {
    const article = {
      title: 'The Brave Boy',
      content: 'Once there was a brave boy who saved a cat from a tall tree.',
      translation: '从前有一个勇敢的男孩，从高高的树上救下了一只猫。',
      genre: 'narrative',
      wordCount: 14,
      topic: 'biography',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
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
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      const result = await provider.generateArticle(
        '2024-09-01',
        'narrative',
        'biography',
        'easy'
      )

      expect(result.title).toBe('The Brave Boy')
      expect(result.topic).toBe('biography')
      expect(result.difficulty).toBe('easy')
      expect(result.lexileRange.min).toBe(600)
      expect(result.lexileRange.max).toBe(700)
      expect(Array.isArray(result.highlightedWords)).toBe(true)
      expect(result.highlightedWords.length).toBe(1)
      expect(result.highlightedWords[0].word).toBe('brave')

      // 验证 user 消息包含 topic 与 difficulty 参数
      const body = JSON.parse(calls[0].body) as { messages: ChatMessage[] }
      expect(body.messages[1].content.includes('biography')).toBe(true)
      expect(body.messages[1].content.includes('easy')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('generateMnemonic 应正确解析助记口诀', async () => {
    const mnemonic = {
      mnemonic: 'big elephants can always understand small elephants',
      explanation: 'because 拼写：B-E-C-A-U-S-E 首字母组合',
    }
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(mnemonic) } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      const result = await provider.generateMnemonic('because', '因为')

      expect(result.mnemonic).toBe('big elephants can always understand small elephants')
      expect(result.explanation !== undefined).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('generateMnemonic 缺少 mnemonic 字段应抛出 AIError', async () => {
    installFetchMock({
      json: {
        choices: [{ message: { content: '{"explanation":"缺少口诀字段"}' } }],
      },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      await expect(provider.generateMnemonic('family', '家庭')).rejects.toThrow(AIError)
    } finally {
      restoreFetch()
    }
  })

  it('generateEmojiHint 应正确解析 emoji 数组', async () => {
    const emojis = ['🌟', '✨', '💫']
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(emojis) } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      const result = await provider.generateEmojiHint('star', '星星')

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)
      expect(result[0]).toBe('🌟')
    } finally {
      restoreFetch()
    }
  })

  it('generateExampleSentence 应正确解析纯文本例句', async () => {
    const sentence = 'The star shines brightly in the night sky.'
    installFetchMock({
      json: { choices: [{ message: { content: sentence } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      const result = await provider.generateExampleSentence('star', '星星')
      expect(result).toBe(sentence)
    } finally {
      restoreFetch()
    }
  })

  it('generateExampleSentence 应正确解析 JSON 对象例句', async () => {
    const obj = { sentence: 'The star is very bright.' }
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(obj) } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-pro',
      })
      const result = await provider.generateExampleSentence('star', '星星')
      expect(result).toBe('The star is very bright.')
    } finally {
      restoreFetch()
    }
  })
})

// ---------- 超时与重试测试 ----------
// 验证 AbortController 超时控制与 retryWithBackoff 指数退避重试机制

describe('AI Provider 超时与重试', () => {
  it('callChat 超时应抛出 AIError 且 message 包含"超时"', async () => {
    // mock fetch 永不 resolve，依赖 AbortController 触发拒绝
    installFetchMock({ neverResolve: true })
    // 将所有 setTimeout 降为 0ms，避免真等 30s 超时与指数退避
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('超时')).toBe(true)
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })

  it('5xx 响应应重试 2 次后抛出 AIError（共 3 次 fetch）', async () => {
    // mock fetch 始终返回 500
    const calls = installFetchMock({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    // 跳过指数退避等待（1s/2s）
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      // 首次 + 2 次重试 = 3 次 fetch
      expect(calls.length).toBe(3)
      expect(caught instanceof AIError).toBe(true)
      expect((caught as AIError).message.includes('HTTP 500')).toBe(true)
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })

  it('4xx 响应不重试，立即抛出 AIError（仅 1 次 fetch）', async () => {
    // mock fetch 返回 401
    const calls = installFetchMock({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      let caught: unknown
      try {
        await provider.generateTranslation('hello')
      } catch (err) {
        caught = err
      }
      // 4xx 不重试，立即抛出
      expect(calls.length).toBe(1)
      expect(caught instanceof AIError).toBe(true)
      // 401 现使用 getDeepSeekErrorMessage 返回官方中文提示（含"认证失败"）
      expect((caught as AIError).message.includes('认证失败')).toBe(true)
    } finally {
      restoreFetch()
    }
  })

  it('5xx 后重试成功：第 2 次 fetch 返回 200，应返回正常内容', async () => {
    // mock fetch 第一次返回 500，第二次返回 200 + 有效内容
    const calls = installFetchMockSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error' },
      { ok: true, json: { choices: [{ message: { content: '重试成功' } }] } },
    ])
    // 跳过指数退避等待
    const restoreSetTimeout = installImmediateSetTimeout()
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' })
      const result = await provider.generateTranslation('hello')
      // 首次失败 + 1 次重试 = 2 次 fetch
      expect(calls.length).toBe(2)
      expect(result).toBe('重试成功')
    } finally {
      restoreSetTimeout()
      restoreFetch()
    }
  })
})

// ---------- 字段校验与错误处理增强测试 ----------

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

// 覆盖 enrichSingleWord 的成功场景与各类错误场景（400/401/402/422/429/500）
// enrichSingleWord 调用 callChat({ jsonMode: true, maxTokens: 1024, thinkingDisabled: true })
// 返回 VocabularyItem 类型 { word, phonetic, pos, definition, example, importance }

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

// ---------- 缓存与去重测试 ----------
// 验证 callChatCached 的二级缓存命中与 inflight 请求去重机制

describe('AI Provider 缓存与去重', () => {
  it('generateWordBreakdown 第二次调用同 word 不发 fetch（缓存命中）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [{ message: { content: JSON.stringify({ phonics: ['ap', 'ple'], syllables: 2 }) } }],
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 第一次调用：发起 fetch
      const result1 = await provider.generateWordBreakdown('apple')
      expect(result1.phonics).toEqual(['ap', 'ple'])
      expect(calls.length).toBe(1)
      // 第二次调用同 word：应命中缓存，不发起 fetch
      const result2 = await provider.generateWordBreakdown('apple')
      expect(result2.phonics).toEqual(['ap', 'ple'])
      expect(calls.length).toBe(1) // 仍为 1
    } finally {
      restoreFetch()
    }
  })

  it('generateEmojiHint 并发两次同 word 只发一次 fetch（inflight 去重）', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(['🍎']) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      // 并发两次调用同 word+definition
      const [result1, result2] = await Promise.all([
        provider.generateEmojiHint('apple', '苹果'),
        provider.generateEmojiHint('apple', '苹果'),
      ])
      expect(result1).toEqual(['🍎'])
      expect(result2).toEqual(['🍎'])
      // inflight 去重：应只发一次 fetch
      expect(calls.length).toBe(1)
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 两次调用应发两次 fetch（不缓存）', async () => {
    const article = {
      title: 'Test',
      content: 'Test content.',
      translation: '测试',
      genre: 'narrative',
      wordCount: 2,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
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
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateArticle('2024-01-01')
      await provider.generateArticle('2024-01-01')
      // 文章生成不缓存，应发两次 fetch
      expect(calls.length).toBe(2)
    } finally {
      restoreFetch()
    }
  })

  it('不同 word 的 generateWordBreakdown 应分别发 fetch（不同 cacheKey）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [{ message: { content: JSON.stringify({ phonics: ['a'], syllables: 1 }) } }],
      },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateWordBreakdown('apple')
      await provider.generateWordBreakdown('banana')
      // 不同 word 不同 cacheKey，应发两次 fetch
      expect(calls.length).toBe(2)
    } finally {
      restoreFetch()
    }
  })
})

// 验证各 prompt 返回的 user message 中 JSON schema 样例已精简：
// - 删除枚举值字符串（如 main_idea|detail|inference|word_guess、high|medium|low）
// - 字段值为空字符串或 0 占位
// - 字段名与结构保持完整
describe('JSON Schema 样例精简', () => {
  describe('questionsPrompt', () => {
    it('user message 中 JSON 样例不含 type 枚举值字符串', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).not.toContain('main_idea|detail|inference|word_guess')
    })

    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).toContain('"id":""')
      expect(user).toContain('"type":""')
      expect(user).toContain('"stem":""')
      expect(user).toContain('"explanation":""')
      expect(user).toContain('"locationClue":""')
      // options 为 4 个空字符串占位
      expect(user).toContain('"options":["","","",""]')
      // correctIndex 为 0 占位
      expect(user).toContain('"correctIndex":0')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).not.toContain('"文章id-1"')
      expect(user).not.toContain('"题干"')
      expect(user).not.toContain('"选项A"')
      expect(user).not.toContain('"解析"')
      expect(user).not.toContain('"原文线索"')
    })

    it('user message 中 JSON 样例保留字段名与结构', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).toContain('"id"')
      expect(user).toContain('"type"')
      expect(user).toContain('"stem"')
      expect(user).toContain('"options"')
      expect(user).toContain('"correctIndex"')
      expect(user).toContain('"explanation"')
      expect(user).toContain('"locationClue"')
    })
  })

  describe('vocabularyPrompt', () => {
    it('user message 中 JSON 样例不含 importance 枚举值字符串', () => {
      const { user } = vocabularyPrompt('article content')
      expect(user).not.toContain('high|medium|low')
    })

    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = vocabularyPrompt('article content')
      expect(user).toContain('"word":""')
      expect(user).toContain('"phonetic":""')
      expect(user).toContain('"pos":""')
      expect(user).toContain('"definition":""')
      expect(user).toContain('"example":""')
      expect(user).toContain('"exampleTranslation":""')
      expect(user).toContain('"importance":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = vocabularyPrompt('article content')
      expect(user).not.toContain('"单词"')
      expect(user).not.toContain('"音标"')
      expect(user).not.toContain('"词性"')
      expect(user).not.toContain('"释义"')
      expect(user).not.toContain('"例句"')
      expect(user).not.toContain('"例句翻译"')
    })
  })

  describe('wordEnrichPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = wordEnrichPrompt('apple')
      expect(user).toContain('"word":""')
      expect(user).toContain('"phonetic":""')
      expect(user).toContain('"pos":""')
      expect(user).toContain('"definition":""')
      expect(user).toContain('"example":""')
      expect(user).toContain('"exampleTranslation":""')
      // phrases 数组中的字段也为空字符串占位
      expect(user).toContain('"phrase":""')
      expect(user).toContain('"meaning":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = wordEnrichPrompt('apple')
      expect(user).not.toContain('"短语"')
      expect(user).not.toContain('"短语释义"')
      expect(user).not.toContain('"短语例句"')
    })
  })

  describe('wordHintPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = wordHintPrompt('apple', '苹果')
      expect(user).toContain('"imageAssociation":""')
      expect(user).toContain('"mnemonic":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = wordHintPrompt('apple', '苹果')
      expect(user).not.toContain('"图像联想描述"')
      expect(user).not.toContain('"记忆口诀"')
    })
  })

  describe('wordBreakdownPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串与 0 占位', () => {
      const { user } = wordBreakdownPrompt('apple')
      expect(user).toContain('"phonics":["",""]')
      expect(user).toContain('"syllables":0')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = wordBreakdownPrompt('apple')
      // 旧样例中 phonics 数组值为 "音节1"/"音节2"，精简后应为空字符串
      expect(user).not.toContain('"音节1"')
      expect(user).not.toContain('"音节2"')
      // 旧样例 syllables 字段值为 "音节数" 文本占位（非合法 JSON 数字），精简后为 0
      // 注：user message 上文仍含 "该单词的音节数（正整数）" 语义说明，需用 schema 上下文区分
      expect(user).not.toContain('"syllables":音节数')
    })
  })

  describe('mnemonicPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = mnemonicPrompt('because', '因为')
      expect(user).toContain('"mnemonic":""')
      expect(user).toContain('"explanation":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = mnemonicPrompt('because', '因为')
      expect(user).not.toContain('"助记口诀"')
      expect(user).not.toContain('"口诀解释"')
    })
  })

  describe('emojiHintPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = emojiHintPrompt('sun', '太阳')
      // 旧样例为 ["emoji1","emoji2"]，精简后为 ["",""]
      expect(user).toContain('["",""]')
    })

    it('user message 中 JSON 样例不再含 emoji1/emoji2 占位符', () => {
      const { user } = emojiHintPrompt('sun', '太阳')
      expect(user).not.toContain('"emoji1"')
      expect(user).not.toContain('"emoji2"')
    })
  })
})

// ---------- Phase 2 优化测试 ----------
describe('Phase 2: reasoning_effort 与 thinkingDisabled 与 max_tokens fine-tune', () => {
  // 静默 baseProvider.ts 中的 console.debug 请求/响应日志，避免测试输出噪音
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })


  it('extractVocabulary 请求体应包含 thinking: { type: "disabled" }（机械任务关闭思考）', async () => {
    const vocabulary = [
      {
        word: 'adventure',
        phonetic: '/ədˈventʃər/',
        pos: 'n.',
        definition: '冒险',
        example: 'an adventure story',
        exampleTranslation: '一个冒险故事',
        importance: 'high',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(vocabulary) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.extractVocabulary('Some article content with adventure word.')
      const body = JSON.parse(calls[0].body) as {
        thinking?: { type: string }
        reasoning_effort?: string
      }
      expect(body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort
      expect(body.reasoning_effort).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  it('generateArticle 请求体应包含 thinking: { type: "disabled" }（Phase 2 关闭思考）', async () => {
    const article = {
      title: 'T',
      content: 'C',
      translation: 'T',
      genre: 'narrative',
      wordCount: 10,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
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
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateArticle('2026-07-26')
      const body = JSON.parse(calls[0].body) as {
        thinking?: { type: string }
        reasoning_effort?: string
      }
      expect(body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort
      expect(body.reasoning_effort).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  it('generateQuestions 请求体应包含 thinking: { type: "disabled" } 且不包含 reasoning_effort（2026-07-26 改进）', async () => {
    const questions = [
      {
        id: 'q-1',
        type: 'main_idea',
        stem: '题干',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '解析',
        locationClue: '线索',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(questions) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateQuestions('art-1', 'article content')
      const body = JSON.parse(calls[0].body) as {
        thinking?: { type: string }
        reasoning_effort?: string
      }
      // 思考模式 + JSON Output 模式存在内容截断与空 content 问题，
      // 改为禁用思考以保证稳定性（与 generateArticle / extractVocabulary 一致策略）
      expect(body.thinking).toEqual({ type: 'disabled' })
      // thinking 禁用时不附加 reasoning_effort（互斥语义）
      expect(body.reasoning_effort).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })


  it('generateArticle 请求体 max_tokens === 3072（Phase 2 fine-tune）', async () => {
    const article = {
      title: 'T',
      content: 'C',
      translation: 'T',
      genre: 'narrative',
      wordCount: 10,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
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
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(article) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateArticle('2026-07-26')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      expect(body.max_tokens).toBe(3072)
    } finally {
      restoreFetch()
    }
  })

  it('generateQuestions 请求体 max_tokens === 3072（2026-07-26 修复练习题生成失败）', async () => {
    const questions = [
      {
        id: 'q-1',
        type: 'main_idea',
        stem: '题干',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '解析',
        locationClue: '线索',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(questions) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateQuestions('art-1', 'article content')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      // 思考模式禁用后，3072 足以覆盖 5 题完整 JSON（典型 ~1500 token，1.5x 上限 3072）
      expect(body.max_tokens).toBe(3072)
    } finally {
      restoreFetch()
    }
  })

  it('extractVocabulary 请求体 max_tokens === 1536（Phase 2 fine-tune）', async () => {
    const vocabulary = [
      {
        word: 'adventure',
        phonetic: '/ədˈventʃər/',
        pos: 'n.',
        definition: '冒险',
        example: 'an adventure story',
        exampleTranslation: '一个冒险故事',
        importance: 'high',
      },
    ]
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(vocabulary) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.extractVocabulary('Some article content with adventure word.')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      expect(body.max_tokens).toBe(1536)
    } finally {
      restoreFetch()
    }
  })

  it('generateWordBreakdown 请求体 max_tokens === 128（Phase 2 fine-tune）', async () => {
    const breakdown = { phonics: ['ap', 'ple'], syllables: 2 }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify(breakdown) } }] },
    })
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
      await provider.generateWordBreakdown('apple')
      const body = JSON.parse(calls[0].body) as { max_tokens?: number }
      expect(body.max_tokens).toBe(128)
    } finally {
      restoreFetch()
    }
  })


  it('buildRequestBody 传入 reasoningEffort: "high" 时请求体包含 reasoning_effort: "high"', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'hi' }],
      { reasoningEffort: 'high' }
    ) as { reasoning_effort?: string; thinking?: { type: string } }
    expect(body.reasoning_effort).toBe('high')
    // 未传 thinkingDisabled 时不应附加 thinking 字段
    expect(body.thinking).toBeUndefined()
  })

  it('buildRequestBody 传入 reasoningEffort: "max" 时请求体包含 reasoning_effort: "max"', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'hi' }],
      { reasoningEffort: 'max' }
    ) as { reasoning_effort?: string }
    expect(body.reasoning_effort).toBe('max')
  })

  it('buildRequestBody 同时传入 thinkingDisabled: true 与 reasoningEffort: "high" 时仅含 thinking: { type: "disabled" }，不含 reasoning_effort', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'hi' }],
      { thinkingDisabled: true, reasoningEffort: 'high' }
    ) as { reasoning_effort?: string; thinking?: { type: string } }
    // thinking 禁用优先：附加 thinking 字段
    expect(body.thinking).toEqual({ type: 'disabled' })
    // thinking 禁用时忽略 reasoning_effort
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('buildRequestBody 未传 reasoningEffort 时不附加 reasoning_effort 字段', () => {
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody([{ role: 'user', content: 'hi' }]) as {
      reasoning_effort?: string
    }
    expect(body.reasoning_effort).toBeUndefined()
  })
})
