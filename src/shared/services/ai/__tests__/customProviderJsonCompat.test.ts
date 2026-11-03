// 第三方模型数组场景 JSON 兼容性测试
//
// 覆盖（修复「练习题生成失败：无法从对象包装中提取唯一数组字段」）：
// 1. expectArray 门控：CustomProvider（第三方端点）数组类场景不发 response_format
//    （json_object 的「顶层必须是 object」语义会把数组退化为单个对象，实测
//    SiliconFlow deepseek-ai/DeepSeek-V4-Flash 带 json_object 只返回第 1 题）
// 2. DeepSeekProvider 数组类场景保持 response_format（官方模型可弱化 schema 约束输出数组）
// 3. 对象类场景（文章生成）CustomProvider 仍发 response_format（与 json_object 语义兼容）
// 4. 平台推断：inferCustomPlatformLabel 按端点映射平台标签
// 5. AI 使用记录：custom 调用后记录携带按端点推断的 platform 字段
import { DeepSeekProvider } from '../deepseekProvider'
import { CustomProvider, inferCustomPlatformLabel } from '../customProvider'
import { clearAIUsage, getAIUsage } from '../aiUsageTracker'
import { installFetchMock, restoreFetch } from '@/test/setup'

// 合法题目数组响应（结构与 QuestionGenerationResult 一致）
const QUESTIONS_CONTENT = JSON.stringify([
  {
    id: 'q1',
    type: 'detail',
    stem: 'What does Tom love?',
    options: ['Basketball', 'Football', 'Swimming', 'Running'],
    correctIndex: 0,
    explanation: '原文第一句指出 Tom loves basketball',
    locationClue: 'He loves basketball.',
  },
])

const ARTICLE_CONTENT = JSON.stringify({
  title: 'A Story',
  content: 'Tom is a student. He loves basketball very much. Every day he plays with friends.',
  translation: '汤姆是一名学生。他非常喜欢篮球。每天他都和朋友一起打球。',
  genre: 'narrative',
  wordCount: 120,
  topic: 'campus',
  difficulty: 'medium',
  lexileRange: '600L-700L',
  highlightedWords: ['basketball'],
})

describe('第三方模型数组场景 JSON 兼容性', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    clearAIUsage()
  })

  afterEach(() => {
    restoreFetch()
    clearAIUsage()
    localStorage.clear()
  })

  it('CustomProvider 数组场景（generateQuestions）不发 response_format', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: QUESTIONS_CONTENT } }] },
    })
    try {
      const provider = new CustomProvider({
        endpoint: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        apiKey: 'test-key',
      })
      const result = await provider.generateQuestions('2024-01-01', 'Tom loves basketball.')
      expect(result.length).toBe(1)
      // 核心断言：第三方供应商数组场景跳过 json_object（避免数组退化为单对象）
      const body = JSON.parse(calls[0].body) as {
        response_format?: { type: string }
      }
      expect(body.response_format).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  it('DeepSeekProvider 数组场景（generateQuestions）保持 response_format（官方行为不变）', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: QUESTIONS_CONTENT } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
        model: 'deepseek-v4-pro',
      })
      await provider.generateQuestions('2024-01-01', 'Tom loves basketball.')
      const body = JSON.parse(calls[0].body) as {
        body: { response_format?: { type: string } }
      }
      expect(body.body.response_format?.type).toBe('json_object')
    } finally {
      restoreFetch()
    }
  })

  it('CustomProvider 对象场景（generateArticle）仍发 response_format（语义兼容）', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: ARTICLE_CONTENT } }] },
    })
    try {
      const provider = new CustomProvider({
        endpoint: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        apiKey: 'test-key',
      })
      const result = await provider.generateArticle('2024-01-01')
      expect(result.title).toBe('A Story')
      // 对象场景与 json_object 语义兼容，保持发送
      const body = JSON.parse(calls[0].body) as {
        response_format?: { type: string }
      }
      expect(body.response_format?.type).toBe('json_object')
    } finally {
      restoreFetch()
    }
  })

  it('inferCustomPlatformLabel：按端点推断平台', () => {
    expect(inferCustomPlatformLabel('https://api.siliconflow.cn/v1')).toBe('SiliconFlow')
    expect(inferCustomPlatformLabel('https://openrouter.ai/api/v1/chat/completions')).toBe('OpenRouter')
    expect(inferCustomPlatformLabel('https://api.deepseek.com/chat/completions')).toBe('DeepSeek')
    expect(inferCustomPlatformLabel('https://api.openai.com/v1')).toBe('OpenAI')
    expect(inferCustomPlatformLabel('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('阿里云百炼')
    expect(inferCustomPlatformLabel('http://localhost:11434/v1')).toBe('本地模型')
    expect(inferCustomPlatformLabel('https://api.example.com/v1')).toBe('api.example.com')
    expect(inferCustomPlatformLabel('')).toBe('自定义')
  })

  it('AI 使用记录：custom 调用后 platform 字段按端点推断（SiliconFlow）', async () => {
    installFetchMock({
      json: { choices: [{ message: { content: QUESTIONS_CONTENT } }] },
    })
    try {
      const provider = new CustomProvider({
        endpoint: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        apiKey: 'test-key',
      })
      await provider.generateQuestions('2024-02-02', 'Tom loves basketball.')
      const record = getAIUsage('questions')
      expect(record).toBeDefined()
      expect(record?.platform).toBe('SiliconFlow')
      expect(record?.provider).toBe('custom')
      expect(record?.model).toBe('deepseek-ai/DeepSeek-V4-Flash')
      expect(record?.success).toBe(true)
    } finally {
      restoreFetch()
    }
  })
})
