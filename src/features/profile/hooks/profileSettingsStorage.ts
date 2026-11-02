// 个人中心本地扩展设置的持久化读写（通知 / AI 供应商 / API Key / 模型与自定义端点）
//
// - API Key 使用 secureStorage 加密存储，并按供应商隔离
// - 通知开关、模型名、自定义端点与模型 ID 为 localStorage 明文
import { logger } from '../../../shared/utils/logger'
import {
  getCustomModelConfig,
  getCurrentAIProviderName,
  type AIProviderName,
} from '@/shared/services/ai'
import { secureGetItem, secureSetItem } from '@/shared/services/secureStorage'

// localStorage keys
const LS_KEY_NOTIFICATION_ENABLED = 'ydxl-ext-notification-enabled'
const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'
const LS_KEY_AI_API_KEY_LEGACY = 'ydxl-ext-ai-api-key'
// 新版按供应商隔离的 API Key 存储
const LS_KEY_AI_API_KEY_DEEPSEEK = 'ydxl-ext-ai-api-key-deepseek'
const LS_KEY_AI_API_KEY_OPENAI = 'ydxl-ext-ai-api-key-openai'
const LS_KEY_AI_API_KEY_QWEN = 'ydxl-ext-ai-api-key-qwen'
const LS_KEY_AI_API_KEY_CUSTOM = 'ydxl-ext-ai-api-key-custom'
// 可选模型名覆盖（内置供应商）
const LS_KEY_AI_MODEL = 'ydxl-ext-ai-model'
// 自定义模型配置：请求地址与模型 ID（localStorage 明文，非敏感信息）
const LS_KEY_CUSTOM_ENDPOINT = 'ydxl-ext-ai-custom-endpoint'
const LS_KEY_CUSTOM_MODEL = 'ydxl-ext-ai-custom-model'

// AI 供应商类型（与 ai/types.ts 的 AIProviderName 统一，沿用 AIProviderType 别名以减少改动）
export type AIProviderType = AIProviderName

export function readNotificationEnabled(): boolean {
  try {
    return window.localStorage.getItem(LS_KEY_NOTIFICATION_ENABLED) === '1'
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 读取通知开关失败', err)
    return false
  }
}

// 读取 AI 供应商选择：委托给运行时工厂 getCurrentAIProviderName（localStorage > env 自动检测 > deepseek），
// 确保表单初始值与业务实际生效的供应商完全一致——修复「界面显示 deepseek、实际走 custom」的不一致（根因 2）
export function readAIProviderType(): AIProviderType {
  try {
    return getCurrentAIProviderName()
  } catch {
    // 模块初始化极端异常时回退默认供应商
    return 'deepseek'
  }
}

// 根据供应商返回对应的 secureStorage key（按供应商隔离，避免切换时互相覆盖）
function apiKeyStorageKey(provider: AIProviderType): string {
  switch (provider) {
    case 'openai':
      return LS_KEY_AI_API_KEY_OPENAI
    case 'qwen':
      return LS_KEY_AI_API_KEY_QWEN
    case 'custom':
      return LS_KEY_AI_API_KEY_CUSTOM
    case 'deepseek':
    default:
      return LS_KEY_AI_API_KEY_DEEPSEEK
  }
}

// 异步读取 AI API Key（使用 secureStorage 解密）
// - secureStorage 在不支持 IndexedDB 的环境（如 jsdom 测试）降级为明文读取
// - DeepSeek 供应商首次读取时若新 key 不存在，尝试从旧版 legacy key 迁移
export async function readAIApiKey(provider: AIProviderType): Promise<string> {
  try {
    const key = apiKeyStorageKey(provider)
    const stored = await secureGetItem(key)
    if (stored) return stored
    // 一次性迁移：旧版 DeepSeek 用户在 ydxl-ext-ai-api-key 中存有 Key
    // 仅当供应商为 deepseek 且 legacy key 存在时迁移
    if (provider === 'deepseek') {
      const legacy = await secureGetItem(LS_KEY_AI_API_KEY_LEGACY)
      if (legacy) {
        // 写入新隔离 key 后立即清除 legacy（幂等：迁移完成再次进入时 legacy 已为空）
        await secureSetItem(LS_KEY_AI_API_KEY_DEEPSEEK, legacy)
        try {
          window.localStorage.removeItem(LS_KEY_AI_API_KEY_LEGACY)
        } catch {
          // localStorage 不可用时忽略
        }
        return legacy
      }
    }
    return ''
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 读取 AI API Key 失败', err)
    return ''
  }
}

// 同步读取可选模型名覆盖（localStorage 明文，未配置返回空串）
export function readAIModel(): string {
  try {
    return window.localStorage.getItem(LS_KEY_AI_MODEL) ?? ''
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 读取 AI 模型名失败', err)
    return ''
  }
}

// 同步读取自定义模型请求地址（localStorage > env 默认值，与运行时配置一致）
// 复用 getCustomModelConfig 保证表单初始值与工厂实际生效值完全一致：
// 部署者在 .env 预填的端点会直接显示在输入框中，用户修改后以 localStorage 为准
export function readCustomEndpoint(): string {
  return getCustomModelConfig().endpoint
}

// 同步读取自定义模型 ID（localStorage > env 默认值，与运行时配置一致）
export function readCustomModelId(): string {
  return getCustomModelConfig().model
}

export function writeNotificationEnabled(v: boolean) {
  try {
    window.localStorage.setItem(LS_KEY_NOTIFICATION_ENABLED, v ? '1' : '0')
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 写入通知开关失败', err)
  }
}

export function writeAIProviderType(v: AIProviderType) {
  try {
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, v)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 写入 AI 供应商失败', err)
  }
}

// 异步写入 AI API Key（使用 secureStorage 加密后持久化）
// - secureStorage 在不支持 IndexedDB 的环境降级为明文存储
// - 按供应商隔离，避免切换时互相覆盖
export async function writeAIApiKey(provider: AIProviderType, v: string): Promise<void> {
  try {
    await secureSetItem(apiKeyStorageKey(provider), v)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 写入 AI API Key 失败', err)
  }
}

export function writeAIModel(v: string) {
  try {
    window.localStorage.setItem(LS_KEY_AI_MODEL, v)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 写入 AI 模型名失败', err)
  }
}

// 写入自定义模型请求地址与模型 ID（localStorage 明文）
export function writeCustomConfig(endpoint: string, modelId: string) {
  try {
    window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, endpoint)
    window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, modelId)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[ProfilePage] 写入自定义模型配置失败', err)
  }
}
