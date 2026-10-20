// 自定义 AI 模型供应商单元测试
//
// 测试覆盖：
// - normalizeCustomEndpoint：Base URL 自动拼接 /chat/completions、完整 URL 直通、
//   尾斜杠清理、空白字符容错
// - CustomProvider：端点必填校验（fail-fast）、直连请求与 Bearer 鉴权、
//   代理模式路由到服务端 /v1/ai-proxy/custom 节点（信封体 + x-user-token）、
//   请求体按平台透传思考关闭开关（reasoning_effort 仍不透传）、响应内容解析
// - createAIProviderByName('custom')：工厂分发、连接测试传参路径、
//   localStorage/env 配置回退链（含 apiKey env 兜底）、未配置时 fail-fast 抛错
// - getCustomModelConfig / setCustomModelConfig：localStorage 读写往返与 env 默认值
// - shouldCustomUseProxy：代理判定（env 代理地址 + 用户未自填端点 + env 配置完整）
// - 错误消息：custom 供应商标签注册（PROVIDER_LABELS）
import { vi } from 'vitest'
import { CustomProvider, normalizeCustomEndpoint } from '../customProvider'
import {
  createAIProviderByName,
  getCustomModelConfig,
  setCustomModelConfig,
  shouldCustomUseProxy,
} from '../index'
import { AI_PROVIDER_META } from '../types'
import { getAIErrorMessage } from '../errors'
import { installFetchMock, restoreFetch } from '@/test/setup'

const LS_KEY_CUSTOM_ENDPOINT = 'ydxl-ext-ai-custom-endpoint'
const LS_KEY_CUSTOM_MODEL = 'ydxl-ext-ai-custom-model'

afterEach(() => {
  restoreFetch()
  window.localStorage.removeItem(LS_KEY_CUSTOM_ENDPOINT)
  window.localStorage.removeItem(LS_KEY_CUSTOM_MODEL)
})

// ---------- normalizeCustomEndpoint 测试 ----------

describe('normalizeCustomEndpoint', () => {
  it('Base URL 应自动拼接 /chat/completions', () => {
    expect(normalizeCustomEndpoint('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(normalizeCustomEndpoint('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1/chat/completions'
    )
  })

  it('完整 URL（已含 /chat/completions）应原样返回', () => {
    expect(normalizeCustomEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('应清理尾随斜杠后再拼接，避免出现双斜杠', () => {
    expect(normalizeCustomEndpoint('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(normalizeCustomEndpoint('https://api.example.com/v1///')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('应容忍首尾空白字符（粘贴输入常见场景）', () => {
    expect(normalizeCustomEndpoint('  https://api.example.com/v1  ')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })
})

// ---------- CustomProvider 测试 ----------

describe('CustomProvider', () => {
  const ENDPOINT = 'https://gateway.example.com/v1'

  it('未配置端点时构造应立即抛错（fail-fast）', () => {
    expect(() => new CustomProvider({ endpoint: '' })).toThrow(/请求地址/)
    expect(() => new CustomProvider({ endpoint: '   ' })).toThrow(/请求地址/)
    expect(
      () =>
        new CustomProvider({
          endpoint: '',
        } as ConstructorParameters<typeof CustomProvider>[0])
    ).toThrow(/请求地址/)
  })

  it('直连模式应请求用户配置的规范化端点并使用 Bearer 鉴权', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: '翻译结果' } }] },
    })
    try {
      const provider = new CustomProvider({
        apiKey: 'sk-custom',
        model: 'my-model-id',
        endpoint: ENDPOINT,
      })
      const result = await provider.generateTranslation('hello')

      expect(result).toBe('翻译结果')
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe(`${ENDPOINT}/chat/completions`)
      expect(calls[0].headers['Authorization']).toBe('Bearer sk-custom')

      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('my-model-id')
    } finally {
      restoreFetch()
    }
  })

  it('传入 proxyBaseUrl 时应路由到服务端 /v1/ai-proxy/custom 代理节点', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      // 生产代理模式：custom 走服务端代理（规避浏览器直连第三方 API 的 CORS 限制），
      // 服务端 UPSTREAMS.custom 转发到部署者 env 配置的固定端点（无 SSRF）
      const provider = new CustomProvider({
        apiKey: 'proxy-token',
        model: 'my-model-id',
        endpoint: ENDPOINT,
        proxyBaseUrl: '/api',
      })
      await provider.generateTranslation('hello')

      expect(calls[0].url).toBe('/api/v1/ai-proxy/custom')
      // 代理模式：apiKey 作为代理令牌通过 x-user-token 头传递，不使用 Bearer
      expect(calls[0].headers['x-user-token']).toBe('proxy-token')
      expect(calls[0].headers['Authorization']).toBeUndefined()
      // 代理模式请求体为 { provider, body } 信封结构
      const body = JSON.parse(calls[0].body) as { provider: string; body: { model: string } }
      expect(body.provider).toBe('custom')
      expect(body.body.model).toBe('my-model-id')
    } finally {
      restoreFetch()
    }
  })

  it('buildRequestBody 按平台透传关闭思考参数，且始终不透传 reasoning_effort', () => {
    const build = (endpoint: string) => {
      const raw = JSON.stringify(
        new CustomProvider({
          apiKey: 'sk-test',
          model: 'my-model-id',
          endpoint,
        }).buildRequestBody(
          [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
          { maxTokens: 1024, thinkingDisabled: true, reasoningEffort: 'high', modelOverride: 'my-model-id' }
        )
      )
      const body = JSON.parse(raw) as Record<string, unknown>
      expect(body.model).toBe('my-model-id')
      expect(body.max_tokens).toBe(1024)
      expect(raw).not.toContain('reasoning_effort')
      return body
    }

    // SiliconFlow → enable_thinking: false
    const sf = build('https://api.siliconflow.cn/v1')
    expect(sf.enable_thinking).toBe(false)
    expect(sf.thinking).toBeUndefined()
    // 阿里云百炼 → enable_thinking: false
    const ds = build('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(ds.enable_thinking).toBe(false)
    expect(ds.thinking).toBeUndefined()
    // 未知网关 → thinking: { type: 'disabled' }（DeepSeek 官方惯例）
    const gw = build(ENDPOINT)
    expect(gw.thinking).toEqual({ type: 'disabled' })
    expect(gw.enable_thinking).toBeUndefined()
    // OpenAI 官方端点 → 不附加任何思考字段（无 thinking 语义，避免 400）
    const oa = build('https://api.openai.com/v1')
    expect(oa.thinking).toBeUndefined()
    expect(oa.enable_thinking).toBeUndefined()
  })

  it('thinkingDisabled 未开启时不附加任何思考字段', () => {
    const body = new CustomProvider({
      apiKey: 'sk-test',
      model: 'my-model-id',
      endpoint: ENDPOINT,
    }).buildRequestBody([{ role: 'user', content: 'hi' }], { maxTokens: 512 })
    expect(body).toEqual({
      model: 'my-model-id',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 512,
    })
  })

  it('parseContent 应提取 choices[0].message.content，缺失时返回空串', () => {
    const provider = new CustomProvider({
      apiKey: 'sk-test',
      model: 'm',
      endpoint: ENDPOINT,
    })
    expect(provider.parseContent({ choices: [{ message: { content: 'hi' } }] })).toBe('hi')
    expect(provider.parseContent({ choices: [] })).toBe('')
    expect(provider.parseContent({})).toBe('')
    expect(provider.parseContent(null)).toBe('')
  })
})

// ---------- 工厂函数与配置读写测试 ----------

describe('createAIProviderByName custom 分发', () => {
  it('应返回 CustomProvider 实例', () => {
    const provider = createAIProviderByName('custom', {
      apiKey: 'k',
      endpoint: 'https://api.example.com/v1',
      model: 'm',
    })
    expect(provider).toBeInstanceOf(CustomProvider)
  })

  it('连接测试路径：显式传入的端点/模型/密钥应生效', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = createAIProviderByName('custom', {
        apiKey: 'sk-live',
        model: 'gpt-4o',
        endpoint: 'https://openrouter.ai/api/v1',
      })
      await provider.generateTranslation('hello')

      expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(calls[0].headers['Authorization']).toBe('Bearer sk-live')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('gpt-4o')
    } finally {
      restoreFetch()
    }
  })

  it('model 未显式传入时应回退到 localStorage 配置', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://ls.example.com/v1')
      window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, 'llama3-local')

      const provider = createAIProviderByName('custom', { apiKey: 'sk-ls' })
      await provider.generateTranslation('hello')

      expect(calls[0].url).toBe('https://ls.example.com/v1/chat/completions')
      const body = JSON.parse(calls[0].body) as { model: string }
      expect(body.model).toBe('llama3-local')
    } finally {
      restoreFetch()
    }
  })

  it('apiKey 未显式传入时应回退到 env 默认值（VITE_CUSTOM_API_KEY）', async () => {
    // 模拟部署者在 .env 预填默认 Key 的场景：用户未填写 Key 时连接测试仍可用
    vi.stubEnv('VITE_CUSTOM_API_KEY', 'sk-from-env-default')

    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://env.example.com/v1')

      const provider = createAIProviderByName('custom', {})
      await provider.generateTranslation('hello')

      expect(calls[0].headers['Authorization']).toBe('Bearer sk-from-env-default')
    } finally {
      restoreFetch()
      vi.unstubAllEnvs()
    }
  })

  it('显式传入的 apiKey 应优先于 env 默认值（个人中心 > .env）', async () => {
    vi.stubEnv('VITE_CUSTOM_API_KEY', 'sk-from-env-default')

    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://env.example.com/v1')

      const provider = createAIProviderByName('custom', { apiKey: 'sk-user-input' })
      await provider.generateTranslation('hello')

      expect(calls[0].headers['Authorization']).toBe('Bearer sk-user-input')
    } finally {
      restoreFetch()
      vi.unstubAllEnvs()
    }
  })

  it('getCustomModelConfig 应返回 env 默认值（localStorage 为空时）', () => {
    vi.stubEnv('VITE_CUSTOM_API_ENDPOINT', 'https://default.example.com/v1')
    vi.stubEnv('VITE_CUSTOM_MODEL', 'gpt-4o-mini')
    vi.stubEnv('VITE_CUSTOM_API_KEY', 'sk-env-key')
    try {
      const config = getCustomModelConfig()
      expect(config.endpoint).toBe('https://default.example.com/v1')
      expect(config.model).toBe('gpt-4o-mini')
      expect(config.apiKey).toBe('sk-env-key')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('完全未配置时应在工厂调用时同步抛出明确提示（fail-fast）', () => {
    // 端点缺失：CustomProvider 构造函数立即校验，不等到实际请求才失败
    expect(() => createAIProviderByName('custom', {})).toThrow(/请求地址/)
    expect(() => createAIProviderByName('custom', { model: 'only-model' })).toThrow(
      /请求地址/
    )
  })
})

describe('getCustomModelConfig / setCustomModelConfig', () => {
  it('写入后读取应返回相同值（localStorage 往返）', () => {
    setCustomModelConfig({
      endpoint: 'https://roundtrip.example.com/v1',
      model: 'qwen-max',
    })
    const config = getCustomModelConfig()
    expect(config.endpoint).toBe('https://roundtrip.example.com/v1')
    expect(config.model).toBe('qwen-max')
  })

  it('空串写入表示清除该项，读取回退到空串', () => {
    setCustomModelConfig({ endpoint: 'https://a.com/v1', model: 'm1' })
    setCustomModelConfig({ endpoint: '', model: '' })
    const config = getCustomModelConfig()
    expect(config.endpoint).toBe('')
    expect(config.model).toBe('')
  })

  it('部分更新不应影响未指定的另一项', () => {
    setCustomModelConfig({ endpoint: 'https://keep.example.com/v1', model: 'keep-model' })
    setCustomModelConfig({ model: 'only-model-changed' })
    const config = getCustomModelConfig()
    expect(config.endpoint).toBe('https://keep.example.com/v1')
    expect(config.model).toBe('only-model-changed')
  })
})

// ---------- shouldCustomUseProxy 代理判定测试 ----------

describe('shouldCustomUseProxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.localStorage.removeItem(LS_KEY_CUSTOM_ENDPOINT)
  })

  it('代理地址 + env 配置完整 + 用户未自填端点 → 走服务端代理', () => {
    vi.stubEnv('VITE_AI_PROXY_URL', '/api')
    vi.stubEnv('VITE_CUSTOM_API_ENDPOINT', 'https://gateway.example.com/v1')
    vi.stubEnv('VITE_CUSTOM_MODEL', 'my-model')
    expect(shouldCustomUseProxy()).toBe(true)
  })

  it('无代理地址（开发直连模式）→ 不走代理', () => {
    vi.stubEnv('VITE_AI_PROXY_URL', '')
    vi.stubEnv('VITE_CUSTOM_API_ENDPOINT', 'https://gateway.example.com/v1')
    vi.stubEnv('VITE_CUSTOM_MODEL', 'my-model')
    expect(shouldCustomUseProxy()).toBe(false)
  })

  it('用户在个人中心自填端点（localStorage）→ 保持浏览器直连（SSRF 防护）', () => {
    vi.stubEnv('VITE_AI_PROXY_URL', '/api')
    vi.stubEnv('VITE_CUSTOM_API_ENDPOINT', 'https://gateway.example.com/v1')
    vi.stubEnv('VITE_CUSTOM_MODEL', 'my-model')
    window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, 'https://user-own.example.com/v1')
    expect(shouldCustomUseProxy()).toBe(false)
  })

  it('env 自定义配置不完整 → 不走代理', () => {
    vi.stubEnv('VITE_AI_PROXY_URL', '/api')
    vi.stubEnv('VITE_CUSTOM_API_ENDPOINT', 'https://gateway.example.com/v1')
    vi.stubEnv('VITE_CUSTOM_MODEL', '')
    expect(shouldCustomUseProxy()).toBe(false)
  })
})

// ---------- 元数据与错误消息测试 ----------

describe('自定义模型元数据注册', () => {
  it('AI_PROVIDER_META 应包含 custom 条目', () => {
    expect(AI_PROVIDER_META.custom).toBeDefined()
    expect(AI_PROVIDER_META.custom.label).toBe('自定义模型')
    expect(AI_PROVIDER_META.custom.flashModel).toBeNull()
  })

  it('getAIErrorMessage 应识别 custom 供应商标签', () => {
    expect(getAIErrorMessage(401, 'custom')).toContain('自定义模型')
  })
})
