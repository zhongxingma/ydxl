// 传输层公共类型：请求选项、流式选项与供应商上下文
import type { ChatMessage } from './types'

export type ReasoningEffort = 'high' | 'max'

export interface RequestBodyOptions {
  maxTokens?: number
  thinkingDisabled?: boolean
  modelOverride?: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
}

export interface ChatRequestOptions extends RequestBodyOptions {
  jsonMode?: boolean
  scenario?: string
  expectArray?: boolean
}

export interface ChatStreamRequestOptions extends ChatRequestOptions {
  signal?: AbortSignal
  onChunk?: (delta: string, fullText: string) => void
}

// 供应商能力与差异逻辑（由 BaseAIProvider 注入）
export interface ProviderRequestContext {
  providerName: () => string
  getModel: () => string
  getProxyBaseUrl: () => string | undefined
  getApiKey: () => string | undefined
  getEffectiveApiKey: () => Promise<string | undefined>
  resolveEndpoint: () => string
  defaultEndpoint: () => string
  getFetchTimeoutMs: () => number
  buildRequestBody: (messages: ChatMessage[], options?: RequestBodyOptions) => unknown
  parseContent: (data: unknown) => string
  supportsJsonMode: () => boolean
  jsonModeSupportsArray: () => boolean
  usagePlatformLabel: () => string
}
