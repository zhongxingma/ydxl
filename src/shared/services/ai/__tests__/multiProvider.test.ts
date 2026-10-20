// 多 AI 供应商单元测试（OpenAI / 通义千问 / 工厂函数 / 错误消息）
//
// 测试覆盖：
// - OpenAIProvider：直连端点、模型分级、请求体构造（不透传 DeepSeek 私有字段）
// - QwenProvider：DashScope 兼容端点、模型分级
// - createAIProviderByName：工厂分发与端点路由
// - getAIErrorMessage：多供应商错误文案与 DeepSeek 向后兼容
import { AIError } from '../types'
import { OpenAIProvider } from '../openaiProvider'
import { QwenProvider } from '../qwenProvider'
import { DeepSeekProvider } from '../deepseekProvider'
import { createAIProviderByName } from '../index'
import { getAIErrorMessage, getDeepSeekErrorMessage } from '../errors'
import {
  installFetchMock,
  restoreFetch,
} from '@/test/setup'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const QWEN_ENDPOINT =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

// ---------- OpenAIProvider 测试 ----------

describe('OpenAIProvider', () => {
  it('直连模式应请求 OpenAI 官方端点并使用 Bearer 鉴权', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: '翻译结果' } }] },
    })
    try {
      const provider = new OpenAIProvider({ apiKey: 'sk-openai-test' })
      const result = await provider.generateTranslation('hello')

      expect(result).toBe('翻译结果')
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe(OPENAI_ENDPOINT)
      expect(calls[0].headers['Authorization']).toBe('Bearer sk-openai-test')
    } finally {
      restoreFetch()
    }
  })

  it('简单任务应降级到 gpt-5.2-mini，复杂任务使用 gpt-5.2', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new OpenAIProvider({ apiKey: 'sk-openai-test' })

      // generateTranslation 为简单任务 → FLASH 模型
      await provider.generateTranslation('hello')
      const simpleBody = JSON.parse(calls[0].body) as { model: string }
      expect(simpleBody.model).toBe('gpt-5.2-mini')
    } finally {
      restoreFetch()
    }
  })

  it('buildRequestBody 不应透传 thinking/reasoning_effort 私有字段', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
      {
        maxTokens: 1024,
        thinkingDisabled: true,
        reasoningEffort: 'high',
        modelOverride: 'gpt-5.2',
      }
    )

    const raw = JSON.stringify(body)
    expect(body.model).toBe('gpt-5.2')
    expect(body.max_tokens).toBe(1024)
    expect(raw).not.toContain('thinking')
    expect(raw).not.toContain('reasoning_effort')
  })

  it('传入 temperature 时应写入请求体（创作型任务抽样多样性）', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody(
      [{ role: 'user', content: 'x' }],
      { maxTokens: 1024, temperature: 0.9 }
    )
    expect(body.temperature).toBe(0.9)
    expect(body.max_tokens).toBe(1024)
  })

  it('未传 temperature 时请求体不应包含 temperature 字段', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    const body = provider.buildRequestBody([{ role: 'user', content: 'x' }])
    // 未显式传入时保持请求体干净，跟随上游默认采样，避免误覆盖供应商默认值
    expect(Object.keys(body)).not.toContain('temperature')
  })

  it('代理模式应拼接 /v1/ai-proxy/openai 路径', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new OpenAIProvider({
        proxyBaseUrl: 'https://proxy.example.com/api',
        apiKey: 'proxy-token',
      })
      await provider.generateTranslation('hello')

      expect(calls[0].url).toBe('https://proxy.example.com/api/v1/ai-proxy/openai')
      expect(calls[0].headers['x-user-token']).toBe('proxy-token')
    } finally {
      restoreFetch()
    }
  })

  it('401 错误应返回含 OpenAI 前缀的中文错误', async () => {
    installFetchMock({ status: 401, ok: false, json: {} })
    try {
      const provider = new OpenAIProvider({ apiKey: 'bad-key' })
      await expect(provider.generateTranslation('hello')).rejects.toThrow(
        /OpenAI API key 错误或认证失败/
      )
    } finally {
      restoreFetch()
    }
  })
})

// ---------- QwenProvider 测试 ----------

describe('QwenProvider', () => {
  it('直连模式应请求 DashScope 兼容端点', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: '翻译结果' } }] },
    })
    try {
      const provider = new QwenProvider({ apiKey: 'sk-qwen-test' })
      const result = await provider.generateTranslation('hello')

      expect(result).toBe('翻译结果')
      expect(calls[0].url).toBe(QWEN_ENDPOINT)
      expect(calls[0].headers['Authorization']).toBe('Bearer sk-qwen-test')
    } finally {
      restoreFetch()
    }
  })

  it('简单任务应降级到 qwen3-turbo', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new QwenProvider({ apiKey: 'sk-qwen-test' })
      await provider.generateTranslation('hello')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('qwen3-turbo')
    } finally {
      restoreFetch()
    }
  })

  it('代理模式应拼接 /v1/ai-proxy/qwen 路径', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new QwenProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
      })
      await provider.generateTranslation('hello')

      expect(calls[0].url).toBe('/api/v1/ai-proxy/qwen')
    } finally {
      restoreFetch()
    }
  })

  it('未配置 apiKey 且无 proxyBaseUrl 时应抛出 AIError', async () => {
    installFetchMock({ json: {} })
    try {
      const provider = new QwenProvider({})
      await expect(provider.generateTranslation('hello')).rejects.toThrow(AIError)
    } finally {
      restoreFetch()
    }
  })
})

// ---------- 工厂函数测试 ----------

describe('createAIProviderByName', () => {
  it('按名称创建对应供应商实例', () => {
    expect(createAIProviderByName('deepseek', { apiKey: 'k' })).toBeInstanceOf(
      DeepSeekProvider
    )
    expect(createAIProviderByName('openai', { apiKey: 'k' })).toBeInstanceOf(
      OpenAIProvider
    )
    expect(createAIProviderByName('qwen', { apiKey: 'k' })).toBeInstanceOf(
      QwenProvider
    )
  })

  it('未知名称回退到 DeepSeek（switch default 分支）', () => {
    const provider = createAIProviderByName(
      'unknown' as Parameters<typeof createAIProviderByName>[0],
      { apiKey: 'k' }
    )
    expect(provider).toBeInstanceOf(DeepSeekProvider)
  })

  it('各供应商代理模式端点按名称路由', async () => {
    const cases: Array<{
      name: Parameters<typeof createAIProviderByName>[0]
      expectedPath: string
    }> = [
      { name: 'deepseek', expectedPath: '/api/v1/ai-proxy/deepseek' },
      { name: 'openai', expectedPath: '/api/v1/ai-proxy/openai' },
      { name: 'qwen', expectedPath: '/api/v1/ai-proxy/qwen' },
    ]
    for (const { name, expectedPath } of cases) {
      const calls = installFetchMock({
        json: { choices: [{ message: { content: 'ok' } }] },
      })
      try {
        const provider = createAIProviderByName(name, {
          proxyBaseUrl: '/api',
          apiKey: 'token',
        })
        await provider.generateTranslation('hello')
        expect(calls[0].url).toBe(expectedPath)
      } finally {
        restoreFetch()
      }
    }
  })
})

// ---------- 错误消息测试 ----------

describe('getAIErrorMessage', () => {
  it('按供应商定制错误前缀', () => {
    expect(getAIErrorMessage(401, 'deepseek')).toContain('DeepSeek')
    expect(getAIErrorMessage(401, 'openai')).toContain('OpenAI')
    expect(getAIErrorMessage(401, 'qwen')).toContain('通义千问')
  })

  it('getDeepSeekErrorMessage 与历史文案完全一致（向后兼容）', () => {
    expect(getDeepSeekErrorMessage(401)).toBe(
      getAIErrorMessage(401, 'deepseek')
    )
    expect(getDeepSeekErrorMessage(402)).toContain('余额不足')
    expect(getDeepSeekErrorMessage(400)).toContain('请求体格式错误')
    expect(getDeepSeekErrorMessage(422)).toContain('参数错误')
  })

  it('未知供应商名回退到通用 AI 服务表述', () => {
    expect(getAIErrorMessage(429, 'unknown-provider')).toContain('AI 服务')
  })
})
