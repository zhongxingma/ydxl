// OpenAI 供应商实现
//
// OpenAI Chat Completions API 为行业事实标准协议，请求/响应结构与 DeepSeek 一致，
// 仅端点与默认模型不同。公共逻辑继承自 BaseAIProvider，仅实现差异化方法。
//
// 与 DeepSeek 的协议差异处理：
// - thinking / reasoning_effort 为 DeepSeek 私有字段，OpenAI 上游会忽略未知字段，
//   但为保持请求体干净，本类不附加这两个字段（thinkingDisabled 静默接受）
//
// 支持两种模式：
// 1. 直连模式：直接调用 https://api.openai.com/v1/chat/completions，Bearer 鉴权
// 2. 代理模式：端点拼接为 `${proxyBaseUrl}/v1/ai-proxy/openai`，x-user-token 头传令牌
import type { ChatMessage } from './types'
import { BaseAIProvider } from './baseProvider'
import { AI_PROVIDER_META } from './types'

// OpenAI Chat Completions 默认端点（直连模式）
// 文档参考：https://platform.openai.com/docs/api-reference/chat
const OPENAI_DEFAULT_ENDPOINT = AI_PROVIDER_META.openai.endpoint

// OpenAI 供应商实现
export class OpenAIProvider extends BaseAIProvider {
  // 高质量模型（用于复杂任务：文章生成、题目生成、词汇提取）
  // 文档参考：https://platform.openai.com/docs/models
  static readonly PRO_MODEL = 'gpt-5.2'

  // 轻量模型（用于简单任务分级，降低成本）
  static readonly FLASH_MODEL = 'gpt-5.2-mini'

  /**
   * 返回当前 Provider 名称（用于代理模式请求体的 provider 字段与端点拼接）
   * @returns 固定字符串 'openai'
   */
  providerName(): 'openai' {
    return 'openai'
  }

  /**
   * 返回直连模式默认端点
   * @returns OpenAI Chat Completions 端点 URL
   */
  defaultEndpoint(): string {
    return OPENAI_DEFAULT_ENDPOINT
  }

  // 返回默认模型名（当 config.model 未指定时使用）
  protected defaultModel(): string {
    return OpenAIProvider.PRO_MODEL
  }

  /**
   * 返回轻量模型名（用于简单任务分级，降低成本）
   * @returns 固定返回 'gpt-5.2-mini'
   */
  protected getFlashModel(): string {
    return OpenAIProvider.FLASH_MODEL
  }

  /**
   * 构造上游请求体（标准 OpenAI 协议：{ model, messages, max_tokens? }）
   * @param messages 对话消息数组
   * @param options 可选参数（thinkingDisabled 仅接受不透传；modelOverride 用于模型分级）
   * @returns OpenAI 请求体对象
   */
  buildRequestBody(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number
      thinkingDisabled?: boolean
      modelOverride?: string
      reasoningEffort?: 'high' | 'max'
      temperature?: number
    }
  ): {
    model: string
    messages: ChatMessage[]
    max_tokens?: number
    temperature?: number
  } {
    const body: {
      model: string
      messages: ChatMessage[]
      max_tokens?: number
      temperature?: number
    } = {
      // 优先使用 modelOverride（模型分级），其次使用实例配置的 this.model
      model: options?.modelOverride ?? this.model,
      messages,
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens
    }
    // 采样温度：创作型任务（文章生成）显式传入以打破模板化；未传时跟随上游默认
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    // 注：不透传 thinking / reasoning_effort（DeepSeek 私有扩展字段），
    // OpenAI 官方 API 对未知字段容忍但保持请求体干净更利于排查问题
    return body
  }

  /**
   * 从响应中提取助手消息内容（choices[0].message.content）
   * @param data 上游响应数据
   * @returns 助手消息内容字符串；无效内容时返回空字符串
   */
  parseContent(data: unknown): string {
    return (
      (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message
        ?.content ?? ''
    )
  }
}
