// providerFactory 供应商工厂单元测试
//
// 覆盖场景：
// 1. buildFallbackProvider：默认 deepseek、openai / qwen 选择、custom 非法回退、模型覆盖
// 2. createAIProvider：内置供应商分支、自定义模型配置不完整时的不可用兜底
// 3. createAIProvider：代理模式（proxyBaseUrl）与直连模式（keyResolver 复合密钥）
// 4. createAIProviderByName：各供应商显式配置、custom 端点回退与密钥解析
//
// Mock 策略：mock ../aiConfig 以可控环境配置驱动工厂分支，
// Provider 类使用真实实现（构造仅保存配置，不发请求）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AIProviderName } from '../types'

const aiConfigMock = vi.hoisted(() => ({
  AI_ENV: {
    VITE_FALLBACK_AI_PROVIDER: '',
    VITE_FALLBACK_MODEL: '',
    VITE_AI_PROXY_URL: '',
    VITE_CUSTOM_API_KEY: '',
  } as Record<string, string | undefined>,
  buildBaseConfig: vi.fn(),
  getCustomModelConfig: vi.fn(),
  getUserSelectedProvider: vi.fn(),
  makeKeyResolver: vi.fn(),
  parseProviderName: vi.fn(),
  shouldCustomUseProxy: vi.fn(),
}))

vi.mock('../aiConfig', () => ({
  AI_ENV: aiConfigMock.AI_ENV,
  buildBaseConfig: aiConfigMock.buildBaseConfig,
  getCustomModelConfig: aiConfigMock.getCustomModelConfig,
  getUserSelectedProvider: aiConfigMock.getUserSelectedProvider,
  makeKeyResolver: aiConfigMock.makeKeyResolver,
  parseProviderName: aiConfigMock.parseProviderName,
  shouldCustomUseProxy: aiConfigMock.shouldCustomUseProxy,
}))

import {
  buildFallbackProvider,
  createAIProvider,
  createAIProviderByName,
} from '../providerFactory'
import { DeepSeekProvider } from '../deepseekProvider'
import { OpenAIProvider } from '../openaiProvider'
import { QwenProvider } from '../qwenProvider'
import { CustomProvider } from '../customProvider'
import { FallbackAIProvider } from '../fallbackProvider'

const VALID_NAMES: AIProviderName[] = ['deepseek', 'openai', 'qwen', 'custom']

describe('providerFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiConfigMock.AI_ENV.VITE_FALLBACK_AI_PROVIDER = ''
    aiConfigMock.AI_ENV.VITE_FALLBACK_MODEL = ''
    aiConfigMock.AI_ENV.VITE_AI_PROXY_URL = ''
    aiConfigMock.AI_ENV.VITE_CUSTOM_API_KEY = ''
    aiConfigMock.parseProviderName.mockImplementation((value: string | null | undefined) =>
      VALID_NAMES.includes(value as AIProviderName) ? (value as AIProviderName) : null,
    )
    aiConfigMock.buildBaseConfig.mockImplementation((name: string) => ({
      apiKey: `key-${name}`,
      model: `model-${name}`,
    }))
    aiConfigMock.getCustomModelConfig.mockReturnValue({ endpoint: '', model: '' })
    aiConfigMock.getUserSelectedProvider.mockReturnValue('deepseek')
    aiConfigMock.makeKeyResolver.mockReturnValue(async () => 'resolved-key')
    aiConfigMock.shouldCustomUseProxy.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildFallbackProvider', () => {
    it('未配置兜底供应商时使用 deepseek', () => {
      expect(buildFallbackProvider()).toBeInstanceOf(DeepSeekProvider)
    })

    it('配置 openai / qwen 时实例化对应供应商', () => {
      aiConfigMock.AI_ENV.VITE_FALLBACK_AI_PROVIDER = 'openai'
      expect(buildFallbackProvider()).toBeInstanceOf(OpenAIProvider)

      aiConfigMock.AI_ENV.VITE_FALLBACK_AI_PROVIDER = 'qwen'
      expect(buildFallbackProvider()).toBeInstanceOf(QwenProvider)
    })

    it('配置 custom 时回退 deepseek', () => {
      aiConfigMock.AI_ENV.VITE_FALLBACK_AI_PROVIDER = 'custom'
      expect(buildFallbackProvider()).toBeInstanceOf(DeepSeekProvider)
    })

    it('VITE_FALLBACK_MODEL 覆盖兜底模型', () => {
      aiConfigMock.AI_ENV.VITE_FALLBACK_AI_PROVIDER = 'openai'
      aiConfigMock.AI_ENV.VITE_FALLBACK_MODEL = 'gpt-fallback'

      const provider = buildFallbackProvider() as DeepSeekProvider

      expect(provider.getBaseConfig().model).toBe('gpt-fallback')
    })
  })

  describe('createAIProvider', () => {
    it('按名称实例化内置供应商', () => {
      expect(createAIProvider('openai')).toBeInstanceOf(OpenAIProvider)
      expect(createAIProvider('qwen')).toBeInstanceOf(QwenProvider)
      expect(createAIProvider('deepseek')).toBeInstanceOf(DeepSeekProvider)
    })

    it('未指定名称时使用当前选择', () => {
      aiConfigMock.getUserSelectedProvider.mockReturnValue('qwen')

      expect(createAIProvider()).toBeInstanceOf(QwenProvider)
      expect(aiConfigMock.getUserSelectedProvider).toHaveBeenCalled()
    })

    it('自定义配置不完整时返回不可用主供应商 + 兜底组合', () => {
      aiConfigMock.getCustomModelConfig.mockReturnValue({ endpoint: '', model: '' })

      const provider = createAIProvider('custom')

      expect(provider).toBeInstanceOf(FallbackAIProvider)
      expect(aiConfigMock.getCustomModelConfig).toHaveBeenCalled()
    })

    it('代理模式：CustomProvider 携带 proxyBaseUrl 并由兜底包装', () => {
      aiConfigMock.AI_ENV.VITE_AI_PROXY_URL = '/api'
      aiConfigMock.getCustomModelConfig.mockReturnValue({
        endpoint: 'https://api.example.com/v1',
        model: 'custom-model',
      })
      aiConfigMock.shouldCustomUseProxy.mockReturnValue(true)

      const provider = createAIProvider('custom') as unknown as { primary: CustomProvider }

      expect(provider).toBeInstanceOf(FallbackAIProvider)
      expect(provider.primary).toBeInstanceOf(CustomProvider)
      expect(provider.primary.getBaseConfig().proxyBaseUrl).toBe('/api')
    })

    it('直连模式：keyResolver 优先用户密钥，其次 env 默认密钥', async () => {
      aiConfigMock.getCustomModelConfig.mockReturnValue({
        endpoint: 'https://api.example.com/v1',
        model: 'custom-model',
      })
      aiConfigMock.AI_ENV.VITE_CUSTOM_API_KEY = 'env-key'

      const provider = createAIProvider('custom') as unknown as { primary: CustomProvider }
      const baseConfig = provider.primary.getBaseConfig()

      expect(baseConfig.proxyBaseUrl).toBeUndefined()
      expect(baseConfig.apiKey).toBeUndefined()
      // 用户密钥存在时优先返回用户密钥
      await expect(baseConfig.keyResolver?.()).resolves.toBe('resolved-key')

      // 用户密钥为空时回退 env 默认密钥
      aiConfigMock.makeKeyResolver.mockReturnValue(async () => '')
      const provider2 = createAIProvider('custom') as unknown as { primary: CustomProvider }
      await expect(provider2.primary.getBaseConfig().keyResolver?.()).resolves.toBe('env-key')
    })
  })

  describe('createAIProviderByName', () => {
    it('内置供应商透传 apiKey / model / proxyBaseUrl', () => {
      const openai = createAIProviderByName('openai', {
        apiKey: 'sk-openai',
        model: 'gpt-x',
        proxyBaseUrl: '/api',
      }) as OpenAIProvider
      expect(openai).toBeInstanceOf(OpenAIProvider)
      expect(openai.getBaseConfig()).toEqual({
        apiKey: 'sk-openai',
        model: 'gpt-x',
        proxyBaseUrl: '/api',
        keyResolver: undefined,
      })

      expect(createAIProviderByName('qwen', { apiKey: 'sk-qwen' })).toBeInstanceOf(QwenProvider)
      expect(createAIProviderByName('deepseek', { apiKey: 'sk-ds' })).toBeInstanceOf(
        DeepSeekProvider,
      )
    })

    it('custom 未传端点与模型时回退当前配置', () => {
      aiConfigMock.getCustomModelConfig.mockReturnValue({
        endpoint: 'https://fallback.example.com/v1',
        model: 'fallback-model',
      })

      const provider = createAIProviderByName('custom', {}) as CustomProvider

      expect(provider).toBeInstanceOf(CustomProvider)
      expect(provider.getBaseConfig().model).toBe('fallback-model')
    })

    it('custom 显式传入 apiKey 时不设置 keyResolver', () => {
      const provider = createAIProviderByName('custom', {
        endpoint: 'https://api.example.com/v1',
        apiKey: 'sk-custom',
        model: 'm1',
      }) as CustomProvider

      const config = provider.getBaseConfig()
      expect(config.apiKey).toBe('sk-custom')
      expect(config.keyResolver).toBeUndefined()
    })
  })
})
