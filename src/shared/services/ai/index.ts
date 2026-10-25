// AI 接口抽象层统一出口
//
// 配置解析（aiConfig.ts）、供应商工厂（providerFactory.ts）与动态单例（aiProviderProxy.ts）
// 分模块实现，本文件仅做对外聚合导出，调用方导入路径不变。
import { getUserSelectedProvider } from './aiConfig'
import type { AIProviderName } from './types'

// 配置读取与用户设置
export {
  getCustomModelConfig,
  shouldCustomUseProxy,
  setCurrentAIProvider,
  setCustomModelConfig,
} from './aiConfig'

// 供应商工厂与动态单例
export { createAIProviderByName } from './providerFactory'
export { aiProvider } from './aiProviderProxy'

/**
 * 获取当前用户选择的 AI 供应商名称
 * 优先级：localStorage > 环境变量 > 默认 deepseek
 * @returns 当前供应商名称
 */
export function getCurrentAIProviderName(): AIProviderName {
  return getUserSelectedProvider()
}

// 统一导出错误类与所有类型
export { AIError } from './types'
// AI 调用来源追踪（各模块展示「来自哪个 AI 接口」）
export {
  recordAIUsage,
  getAIUsage,
  subscribeAIUsage,
  clearAIUsage,
  type AIUsageRecord,
} from './aiUsageTracker'
export {
  AI_STATUS,
  DEEPSEEK_STATUS,
  isRetryableStatus,
  isNonRetryableClientError,
  getAIErrorMessage,
  getDeepSeekErrorMessage,
} from './errors'
// 导出 Provider 类供 useAIConnectionTest 与工厂切换使用
export { DeepSeekProvider } from './deepseekProvider'
export { OpenAIProvider } from './openaiProvider'
export { QwenProvider } from './qwenProvider'
export { CustomProvider, normalizeCustomEndpoint } from './customProvider'
export { FallbackAIProvider, createUnavailableProvider } from './fallbackProvider'
export {
  AI_PROVIDER_META,
  type AIProviderMeta,
  type AIProviderName,
  type AIProvider,
  type ArticleGenerationResult,
  type ChatMessage,
  type Genre,
  type MnemonicResult,
  type QuestionGenerationResult,
  type StreamOptions,
  type VocabularyImportance,
  type VocabularyItem,
  type WordBreakdown,
  type WordHint,
} from './types'
