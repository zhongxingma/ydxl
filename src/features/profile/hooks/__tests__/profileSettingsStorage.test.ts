// profileSettingsStorage 个人中心扩展设置持久化单元测试
//
// 覆盖场景：
// 1. 通知开关读取 / 写入（含 localStorage 异常兜底）
// 2. AI 供应商读取（运行时工厂 / 异常回退 deepseek）与写入
// 3. API Key 按供应商隔离读取 / 写入；DeepSeek legacy key 一次性迁移
// 4. 模型名读取 / 写入；自定义端点与模型 ID 委托 getCustomModelConfig
// 5. 各写入函数在 localStorage 异常时仅记录警告
//
// Mock 策略：mock AI 运行时配置与 secureStorage，localStorage 使用 jsdom 实现
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getCustomModelConfig,
  getCurrentAIProviderName,
} from '@/shared/services/ai'
import { secureGetItem, secureSetItem } from '@/shared/services/secureStorage'
import {
  readNotificationEnabled,
  writeNotificationEnabled,
  readAIProviderType,
  writeAIProviderType,
  readAIApiKey,
  writeAIApiKey,
  readAIModel,
  writeAIModel,
  readCustomEndpoint,
  readCustomModelId,
  writeCustomConfig,
} from '../profileSettingsStorage'

vi.mock('@/shared/services/ai', () => ({
  getCustomModelConfig: vi.fn(),
  getCurrentAIProviderName: vi.fn(),
}))

vi.mock('@/shared/services/secureStorage', () => ({
  secureGetItem: vi.fn(),
  secureSetItem: vi.fn(),
}))

const getCustomModelConfigMock = vi.mocked(getCustomModelConfig)
const getCurrentAIProviderNameMock = vi.mocked(getCurrentAIProviderName)
const secureGetItemMock = vi.mocked(secureGetItem)
const secureSetItemMock = vi.mocked(secureSetItem)

describe('profileSettingsStorage 个人中心扩展设置', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    window.localStorage.clear()
    getCurrentAIProviderNameMock.mockReturnValue('deepseek')
    getCustomModelConfigMock.mockReturnValue({ endpoint: '', model: '' })
    secureGetItemMock.mockResolvedValue('')
    secureSetItemMock.mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('读取通知开关：仅 "1" 视为开启', () => {
    expect(readNotificationEnabled()).toBe(false)

    window.localStorage.setItem('ydxl-ext-notification-enabled', '1')
    expect(readNotificationEnabled()).toBe(true)

    window.localStorage.setItem('ydxl-ext-notification-enabled', '0')
    expect(readNotificationEnabled()).toBe(false)
  })

  it('读取通知开关异常时记录警告并返回 false', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key === 'ydxl-ext-notification-enabled') throw new Error('denied')
      return null
    })

    expect(readNotificationEnabled()).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith('[ProfilePage] 读取通知开关失败', expect.any(Error))
  })

  it('读取 AI 供应商：委托运行时工厂，异常回退 deepseek', () => {
    getCurrentAIProviderNameMock.mockReturnValue('custom')
    expect(readAIProviderType()).toBe('custom')

    getCurrentAIProviderNameMock.mockImplementation(() => {
      throw new Error('factory broken')
    })
    expect(readAIProviderType()).toBe('deepseek')
  })

  it('读取 API Key 按供应商使用独立的存储 key', async () => {
    secureGetItemMock.mockResolvedValue('sk-test')

    await expect(readAIApiKey('openai')).resolves.toBe('sk-test')
    expect(secureGetItem).toHaveBeenLastCalledWith('ydxl-ext-ai-api-key-openai')

    await expect(readAIApiKey('qwen')).resolves.toBe('sk-test')
    expect(secureGetItem).toHaveBeenLastCalledWith('ydxl-ext-ai-api-key-qwen')

    await expect(readAIApiKey('custom')).resolves.toBe('sk-test')
    expect(secureGetItem).toHaveBeenLastCalledWith('ydxl-ext-ai-api-key-custom')

    await expect(readAIApiKey('deepseek')).resolves.toBe('sk-test')
    expect(secureGetItem).toHaveBeenLastCalledWith('ydxl-ext-ai-api-key-deepseek')
  })

  it('DeepSeek 新 key 为空时从 legacy key 迁移并清除旧值', async () => {
    secureGetItemMock.mockImplementation(async (key: string) =>
      key === 'ydxl-ext-ai-api-key' ? 'legacy-key' : ''
    )
    window.localStorage.setItem('ydxl-ext-ai-api-key', 'legacy-key')

    await expect(readAIApiKey('deepseek')).resolves.toBe('legacy-key')

    expect(secureSetItem).toHaveBeenCalledWith('ydxl-ext-ai-api-key-deepseek', 'legacy-key')
    expect(window.localStorage.getItem('ydxl-ext-ai-api-key')).toBeNull()
  })

  it('非 DeepSeek 供应商不读取 legacy key', async () => {
    await expect(readAIApiKey('openai')).resolves.toBe('')

    expect(secureGetItem).toHaveBeenCalledTimes(1)
    expect(secureGetItem).toHaveBeenCalledWith('ydxl-ext-ai-api-key-openai')
    expect(secureSetItem).not.toHaveBeenCalled()
  })

  it('读取 API Key 异常时记录警告并返回空串', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    secureGetItemMock.mockRejectedValue(new Error('decrypt failed'))

    await expect(readAIApiKey('deepseek')).resolves.toBe('')
    expect(warnSpy).toHaveBeenCalledWith('[ProfilePage] 读取 AI API Key 失败', expect.any(Error))
  })

  it('读取模型名：未配置返回空串，异常时记录警告', () => {
    expect(readAIModel()).toBe('')

    window.localStorage.setItem('ydxl-ext-ai-model', 'deepseek-v4-pro')
    expect(readAIModel()).toBe('deepseek-v4-pro')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key === 'ydxl-ext-ai-model') throw new Error('denied')
      return null
    })
    expect(readAIModel()).toBe('')
    expect(warnSpy).toHaveBeenCalledWith('[ProfilePage] 读取 AI 模型名失败', expect.any(Error))
  })

  it('自定义端点与模型 ID 委托 getCustomModelConfig', () => {
    getCustomModelConfigMock.mockReturnValue({
      endpoint: 'https://api.example.com/v1',
      model: 'custom-model',
    })

    expect(readCustomEndpoint()).toBe('https://api.example.com/v1')
    expect(readCustomModelId()).toBe('custom-model')
  })

  it('写入通知开关与 AI 供应商', () => {
    writeNotificationEnabled(true)
    expect(window.localStorage.getItem('ydxl-ext-notification-enabled')).toBe('1')
    writeNotificationEnabled(false)
    expect(window.localStorage.getItem('ydxl-ext-notification-enabled')).toBe('0')

    writeAIProviderType('qwen')
    expect(window.localStorage.getItem('ydxl-ext-ai-provider')).toBe('qwen')
  })

  it('写入通知开关 / AI 供应商异常时记录警告', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    writeNotificationEnabled(true)
    expect(warnSpy).toHaveBeenCalledWith(
      '[ProfilePage] 写入通知开关失败',
      expect.any(Error)
    )

    writeAIProviderType('openai')
    expect(warnSpy).toHaveBeenCalledWith(
      '[ProfilePage] 写入 AI 供应商失败',
      expect.any(Error)
    )
  })

  it('写入 API Key 按供应商隔离，异常时记录警告', async () => {
    await writeAIApiKey('deepseek', 'sk-deepseek')
    expect(secureSetItem).toHaveBeenLastCalledWith('ydxl-ext-ai-api-key-deepseek', 'sk-deepseek')

    await writeAIApiKey('openai', 'sk-openai')
    expect(secureSetItem).toHaveBeenLastCalledWith('ydxl-ext-ai-api-key-openai', 'sk-openai')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    secureSetItemMock.mockRejectedValue(new Error('encrypt failed'))
    await writeAIApiKey('qwen', 'sk-qwen')
    expect(warnSpy).toHaveBeenCalledWith(
      '[ProfilePage] 写入 AI API Key 失败',
      expect.any(Error)
    )
  })

  it('写入模型名与自定义配置', () => {
    writeAIModel('deepseek-v4-pro')
    expect(window.localStorage.getItem('ydxl-ext-ai-model')).toBe('deepseek-v4-pro')

    writeCustomConfig('https://api.example.com/v1', 'custom-model')
    expect(window.localStorage.getItem('ydxl-ext-ai-custom-endpoint')).toBe(
      'https://api.example.com/v1'
    )
    expect(window.localStorage.getItem('ydxl-ext-ai-custom-model')).toBe('custom-model')
  })

  it('写入模型名 / 自定义配置异常时记录警告', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    writeAIModel('m')
    expect(warnSpy).toHaveBeenCalledWith(
      '[ProfilePage] 写入 AI 模型名失败',
      expect.any(Error)
    )

    writeCustomConfig('e', 'm')
    expect(warnSpy).toHaveBeenCalledWith(
      '[ProfilePage] 写入自定义模型配置失败',
      expect.any(Error)
    )
  })
})
