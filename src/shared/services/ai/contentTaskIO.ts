// 内容类任务执行上下文
//
// ProviderCore 的传输能力（callChat / callChatCached / callChatStream / withAIError /
// getFlashModel）为 protected，任务实现拆分到独立模块后无法直接访问；
// ContentTaskProvider 以闭包形式构造本上下文，既完成文件拆分，也不放宽封装边界。
import type { ChatMessage } from './types'
import type { ChatRequestOptions, ChatStreamRequestOptions } from './requestRunner'

export interface ContentTaskIO {
  callChat(messages: ChatMessage[], options?: ChatRequestOptions): Promise<string>
  callChatCached(
    scenario: string,
    messages: ChatMessage[],
    options: {
      jsonMode?: boolean
      maxTokens?: number
      thinkingDisabled?: boolean
      modelOverride?: string
      reasoningEffort?: 'high' | 'max'
      ttlMs: number
      expectArray?: boolean
    },
  ): Promise<string>
  callChatStream(messages: ChatMessage[], options: ChatStreamRequestOptions): Promise<string>
  withAIError<T>(fn: () => Promise<T>, fallbackMsg: string): Promise<T>
  getFlashModel(): string | undefined
}
