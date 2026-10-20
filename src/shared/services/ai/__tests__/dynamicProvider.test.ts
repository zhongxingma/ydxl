// 动态供应商委托与密钥解析测试
//
// 背景（2026-08-27 修复第三方 API 全业务流程异常）：
// 旧实现 export const aiProvider = createAIProvider() 在模块加载时固化供应商实例，存在：
// 1. 个人中心切换供应商后需刷新页面才生效（业务模块持有旧实例引用）
// 2. localStorage/env 指向 custom 但配置不完整时模块加载即抛错（应用白屏）
// 3. 用户在个人中心保存的 API Key（secureStorage 异步加密存储）无法进入业务单例
//
// 本组测试验证 Proxy 动态委托的即时路由能力、keyResolver 密钥解析链、
// 测试 monkey-patch 兼容性，以及 generateArticle 的字段强化校验
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { aiProvider, getCurrentAIProviderName, setCurrentAIProvider, AIError } from '../index'
import { CustomProvider } from '../customProvider'
import { installFetchMock, restoreFetch, type FetchCall } from '@/test/setup'

// 与 useProfileSettings.ts / index.ts 中的常量保持一致
const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'
const LS_KEY_CUSTOM_ENDPOINT = 'ydxl-ext-ai-custom-endpoint'
const LS_KEY_CUSTOM_MODEL = 'ydxl-ext-ai-custom-model'
const LS_KEY_SECURE_CUSTOM_KEY = 'ydxl-ext-ai-api-key-custom'
const LS_KEY_SECURE_DEEPSEEK_KEY = 'ydxl-ext-ai-api-key-deepseek'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// 配置 localStorage 模拟用户在「个人中心 → AI 设置」保存的完整自定义模型配置
// （API Key 写入 secureStorage 的存储位置；jsdom 无 crypto.subtle 时 secureGetItem
//  按明文降级读取，正好模拟旧明文兼容路径）
function setupCustomConfig(key = 'sk-or-user-saved-key'): void {
  window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'custom')
  window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://openrouter.ai/api/v1')
  window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, 'nvidia/nemotron-3-ultra-550b-a55b:free')
  window.localStorage.setItem(LS_KEY_SECURE_CUSTOM_KEY, key)
}

function teardownCustomConfig(): void {
  window.localStorage.removeItem(LS_KEY_AI_PROVIDER)
  window.localStorage.removeItem(LS_KEY_CUSTOM_ENDPOINT)
  window.localStorage.removeItem(LS_KEY_CUSTOM_MODEL)
  window.localStorage.removeItem(LS_KEY_SECURE_CUSTOM_KEY)
}

describe('供应商选择与自动检测', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LS_KEY_AI_PROVIDER)
  })

  it('localStorage 与 env 均未配置时应默认 deepseek', () => {
    expect(getCurrentAIProviderName()).toBe('deepseek')
  })

  it('setCurrentAIProvider 持久化后 getCurrentAIProviderName 即时反映', () => {
    setCurrentAIProvider('custom')
    expect(getCurrentAIProviderName()).toBe('custom')
    expect(window.localStorage.getItem(LS_KEY_AI_PROVIDER)).toBe('custom')
  })
})

describe('aiProvider 动态委托（Proxy）', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LS_KEY_AI_PROVIDER)
    // vitest 已清空 AI 相关 env（见 vitest.config.ts），DeepSeek 密钥需从
    // secureStorage 存储位置写入，模拟用户已在个人中心保存密钥
    window.localStorage.setItem(LS_KEY_SECURE_DEEPSEEK_KEY, 'sk-deepseek-test-key')
  })

  afterEach(() => {
    teardownCustomConfig()
    window.localStorage.removeItem(LS_KEY_SECURE_DEEPSEEK_KEY)
    restoreFetch()
  })

  it('默认应将请求路由到 DeepSeek 官方端点', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: '翻译结果' } }] },
    })
    const result = await aiProvider.generateTranslation('dynamic-route-a')
    expect(result).toBe('翻译结果')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(DEEPSEEK_URL)
  })

  it('切换到 custom 后下一次调用即时路由到自定义端点（免刷新）', async () => {
    setupCustomConfig()
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'openrouter 回复' } }] },
    })
    // 不刷新页面（同一模块实例），切换供应商后立即调用
    const result = await aiProvider.generateTranslation('dynamic-route-b')
    expect(result).toBe('openrouter 回复')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(OPENROUTER_URL)
    // 请求体使用用户配置的模型 ID
    const body = JSON.parse(calls[0].body) as { model: string }
    expect(body.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  it('custom 请求应使用 secureStorage 中用户保存的密钥（Bearer 鉴权）', async () => {
    setupCustomConfig('sk-or-user-saved-key')
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    await aiProvider.generateTranslation('dynamic-route-c')
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-or-user-saved-key')
  })

  it('用户密钥修改后下一次请求使用新密钥（keyResolver 实时解析）', async () => {
    setupCustomConfig('sk-old-key')
    let calls: FetchCall[] = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    await aiProvider.generateTranslation('dynamic-route-d1')
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-old-key')
    restoreFetch()

    // 模拟用户在个人中心修改密钥（secureStorage 写入新值）
    window.localStorage.setItem(LS_KEY_SECURE_CUSTOM_KEY, 'sk-new-key')
    calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    await aiProvider.generateTranslation('dynamic-route-d2')
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-new-key')
  })

  it('切回 deepseek 后恢复官方端点（双向免刷新切换）', async () => {
    setupCustomConfig()
    let calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    await aiProvider.generateTranslation('dynamic-route-e1')
    expect(calls[0].url).toBe(OPENROUTER_URL)
    restoreFetch()

    // 切回 deepseek（清空 custom 选择）
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'deepseek')
    calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    await aiProvider.generateTranslation('dynamic-route-e2')
    expect(calls[0].url).toBe(DEEPSEEK_URL)
  })

  it('custom 配置不完整时自动降级 DeepSeek，补全配置后自动恢复自定义路由', async () => {
    // 仅选择 custom 但未配置端点/模型：降级策略下应自动切到 DeepSeek（本组已配密钥）
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'custom')
    let calls = installFetchMock({
      json: { choices: [{ message: { content: 'deepseek-fallback' } }] },
    })
    const degraded = await aiProvider.generateTranslation('dynamic-route-f1')
    expect(degraded).toBe('deepseek-fallback')
    expect(calls[0].url).toBe(DEEPSEEK_URL)
    restoreFetch()

    // 补全配置后无需刷新即恢复自定义端点路由（配置指纹变化触发实例重建）
    setupCustomConfig()
    calls = installFetchMock({
      json: { choices: [{ message: { content: 'recovered' } }] },
    })
    const result = await aiProvider.generateTranslation('dynamic-route-f2')
    expect(result).toBe('recovered')
    expect(calls[0].url).toBe(OPENROUTER_URL)
  })

  it('custom 配置不完整且 DeepSeek 也无密钥时抛回配置错误（兜底不可用）', async () => {
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'custom')
    // 移除 DeepSeek 密钥，模拟生产环境未配置 DEEPSEEK_API_KEY 的部署
    window.localStorage.removeItem(LS_KEY_SECURE_DEEPSEEK_KEY)
    await expect(
      aiProvider.generateTranslation('dynamic-route-f1b')
    ).rejects.toThrow(/自定义模型未配置完整/)
  })

  it('monkey-patch 赋值优先于动态解析（测试兼容性）', async () => {
    try {
      aiProvider.generateTranslation = async () => 'patched-result'
      await expect(aiProvider.generateTranslation('anything')).resolves.toBe('patched-result')
    } finally {
      // 删除 patch 后动态解析重新生效（而非绑定旧实例的静态恢复）
      delete (aiProvider as unknown as Record<string, unknown>)['generateTranslation']
    }
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'restored' } }] },
    })
    const result = await aiProvider.generateTranslation('dynamic-route-g')
    expect(result).toBe('restored')
    expect(calls[0].url).toBe(DEEPSEEK_URL)
  })
})

describe('generateArticle 字段强化校验（第三方模型兼容）', () => {
  afterEach(() => {
    restoreFetch()
  })

  // 构造完整的文章生成结果（highlightedWords 可覆盖）
  function buildArticleResult(highlightedWords: unknown): string {
    return JSON.stringify({
      title: 'A Test Article',
      content: 'This is a test article content for validation.',
      translation: '这是一篇测试文章。',
      genre: 'narrative',
      wordCount: 220,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
      highlightedWords,
      phrases: [],
    })
  }

  function makeProvider(): CustomProvider {
    return new CustomProvider({
      apiKey: 'sk-test',
      model: 'test-model',
      endpoint: 'https://openrouter.ai/api/v1',
    })
  }

  it('highlightedWords 为空数组时应抛 AIError（降级到兜底素材库的触发条件）', async () => {
    installFetchMock({
      json: { choices: [{ message: { content: buildArticleResult([]) } }] },
    })
    const provider = makeProvider()
    await expect(provider.generateArticle('2026-08-27')).rejects.toThrow(AIError)
    await expect(provider.generateArticle('2026-08-27')).rejects.toThrow(
      /highlightedWords/
    )
  })

  it('highlightedWords 为非数组（null）时应抛 AIError', async () => {
    installFetchMock({
      json: { choices: [{ message: { content: buildArticleResult(null) } }] },
    })
    const provider = makeProvider()
    await expect(provider.generateArticle('2026-08-27')).rejects.toThrow(
      /缺少必要字段/
    )
  })

  it('highlightedWords 非空时正常返回完整结果', async () => {
    const words = [
      {
        word: 'annual',
        phonetic: '/ˈænjuəl/',
        pos: 'adj.',
        definition: '每年的',
        example: 'the annual Sports Day',
      },
    ]
    installFetchMock({
      json: { choices: [{ message: { content: buildArticleResult(words) } }] },
    })
    const provider = makeProvider()
    const result = await provider.generateArticle('2026-08-27')
    expect(result.title).toBe('A Test Article')
    expect(result.highlightedWords).toEqual(words)
  })
})

describe('CustomProvider 全业务流（OpenRouter 风格响应）', () => {
  afterEach(() => {
    restoreFetch()
  })

  function makeProvider(): CustomProvider {
    return new CustomProvider({
      apiKey: 'sk-or-test',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      endpoint: 'https://openrouter.ai/api/v1',
    })
  }

  it('题目生成：markdown 围栏包裹的 JSON 应正确解析', async () => {
    const questions = [
      {
        id: '2026-08-27-1',
        type: 'detail',
        stem: 'What is the article mainly about?',
        options: ['A. Sports', 'B. Music', 'C. Science', 'D. Art'],
        correctIndex: 0,
        explanation: '第一段明确提到运动会。',
        locationClue: 'Para 1',
      },
    ]
    // 模拟第三方模型输出：```json ... ``` 围栏包裹
    const wrapped = '```json\n' + JSON.stringify(questions) + '\n```'
    const calls = installFetchMock({
      json: { choices: [{ message: { content: wrapped } }] },
    })
    const provider = makeProvider()
    const result = await provider.generateQuestions('2026-08-27', 'article content')
    expect(result).toEqual(questions)
    // 请求路由到 OpenRouter 端点且使用配置的模型
    expect(calls[0].url).toBe(OPENROUTER_URL)
    const body = JSON.parse(calls[0].body) as { model: string }
    expect(body.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  it('词汇提取：混杂说明文字中的 JSON 应正确提取', async () => {
    const vocab = [
      {
        word: 'annual',
        phonetic: '/ˈænjuəl/',
        pos: 'adj.',
        definition: '每年的',
        example: 'annual Sports Day',
        importance: 'high' as const,
      },
    ]
    // 模拟开源小模型在 JSON 前后附加说明文字
    const noisy = '以下是提取的词汇结果：\n' + JSON.stringify(vocab) + '\n希望有帮助！'
    installFetchMock({
      json: { choices: [{ message: { content: noisy } }] },
    })
    const provider = makeProvider()
    const result = await provider.extractVocabulary('article content')
    expect(result).toEqual(vocab)
  })

  it('题目生成：json_object 模式下对象包装的数组应自动解包（第三方模型根因修复）', async () => {
    const questions = [
      {
        id: '2026-08-28-1',
        type: 'detail',
        stem: 'What did Tom win?',
        options: ['A. The 100-meter race', 'B. The high jump', 'C. Swimming', 'D. Chess'],
        correctIndex: 0,
        explanation: '原文明确提到 Tom won the 100-meter race。',
        locationClue: 'Para 1',
      },
    ]
    // 模拟免费模型严格服从 json_object 语义：把顶层数组包装成单字段对象
    // （response_format: json_object 要求顶层为 object，违背 prompt 的数组指令）
    const wrapped = JSON.stringify({ questions })
    installFetchMock({
      json: { choices: [{ message: { content: wrapped } }] },
    })
    const provider = makeProvider()
    const result = await provider.generateQuestions('2026-08-28', 'article content')
    expect(result).toEqual(questions)
  })

  it('短语提取：对象包装 {"phrases": [...]} 应自动解包', async () => {
    const phrases = [
      {
        phrase: 'take part in',
        meaning: '参加',
        example: 'take part in the Sports Day',
        exampleTranslation: '参加运动会',
      },
    ]
    installFetchMock({
      json: { choices: [{ message: { content: JSON.stringify({ phrases }) } }] },
    })
    const provider = makeProvider()
    const result = await provider.extractArticlePhrases('article content')
    expect(result).toEqual(phrases)
  })

  it('对象包装含多个数组字段（歧义）时应抛 AIError', async () => {
    // 两个数组字段无法判断提取哪个，应报错而非静默取错
    const ambiguous = JSON.stringify({
      questions: [{ id: 'q1' }, { id: 'q2' }],
      options: [{ a: 1 }],
    })
    installFetchMock({
      json: { choices: [{ message: { content: ambiguous } }] },
    })
    const provider = makeProvider()
    await expect(provider.generateQuestions('2026-08-28', 'content')).rejects.toThrow(
      AIError
    )
  })

  it('裸的单个题目对象（唯一数组是 options 字符串数组）不应被误解包', async () => {
    // 实测免费模型偶发返回单个题目对象而非数组；其唯一数组字段 options
    // 元素是字符串，不满足「元素为对象」约束，应报错而非返回选项字符串数组
    const singleQuestion = JSON.stringify({
      stem: 'What did Tom win?',
      options: ['A. The 100-meter race', 'B. The high jump', 'C. Swimming', 'D. Chess'],
      correctIndex: 0,
      explanation: '原文明确提到。',
    })
    installFetchMock({
      json: { choices: [{ message: { content: singleQuestion } }] },
    })
    const provider = makeProvider()
    await expect(provider.generateQuestions('2026-08-28', 'content')).rejects.toThrow(
      AIError
    )
  })
})
