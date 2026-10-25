// DeepSeekProvider 请求与响应格式
//
// DeepSeek 与 OpenAI 协议兼容：配置校验、请求体构造与响应解析。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { AIError, type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'

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
