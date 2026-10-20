// DeepSeek（深度求索）供应商实现
//
// DeepSeek 提供 OpenAI 兼容的 Chat Completions API，请求/响应格式与 OpenAI 完全一致，
// 仅端点与默认模型不同。公共逻辑继承自 BaseAIProvider，仅实现差异化方法。
//
// 支持两种模式：
// 1. 直连模式：直接调用 https://api.deepseek.com/chat/completions，使用 Authorization: Bearer 鉴权
// 2. 代理模式：通过 Serverless Function 转发，端点拼接为 `${proxyBaseUrl}/v1/ai-proxy/deepseek`，
//    使用 x-user-token 头传递代理令牌
import type { ChatMessage } from './types'
import { BaseAIProvider } from './baseProvider'
import { AI_PROVIDER_META } from './types'

// DeepSeek 供应商实现
// 仅实现差异化方法：providerName / defaultEndpoint / defaultModel / buildRequestBody / parseContent
export class DeepSeekProvider extends BaseAIProvider {
  // 高质量模型（用于复杂任务：文章生成、题目生成、词汇提取）
  // 文档参考：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  // 与 AI_PROVIDER_META.deepseek.defaultModel 保持一致
  static readonly PRO_MODEL = 'deepseek-v4-pro'

  // 轻量模型（用于简单任务降级：翻译、拼读、emoji、例句、单词补全等）
  // 成本约为 PRO_MODEL 的 1/3，质量足够简单任务使用
  static readonly FLASH_MODEL = 'deepseek-v4-flash'

  /**
   * 返回当前 Provider 名称（用于代理模式请求体的 provider 字段）
   * @returns 固定字符串 'deepseek'
   */
  providerName(): 'deepseek' {
    return 'deepseek'
  }

  /**
   * 返回直连模式默认端点
   * @returns DeepSeek Chat Completions 端点 URL
   */
  defaultEndpoint(): string {
    return AI_PROVIDER_META.deepseek.endpoint
  }

  // 返回默认模型名（当 config.model 未指定时使用）
  // 注：deepseek-chat 与 deepseek-reasoner 将于 2026/07/24 23:59 弃用
  // 推荐使用 deepseek-v4-pro（高质量）或 deepseek-v4-flash（同 chat 非思考模式，更便宜）
  // 文档参考：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  protected defaultModel(): string {
    return DeepSeekProvider.PRO_MODEL
  }

  /**
   * 返回轻量模型名（用于简单任务分级，降低成本）
   * DeepSeek 提供 deepseek-v4-flash 作为轻量模型，成本约为 v4-pro 的 1/3
   * @returns 固定返回 'deepseek-v4-flash'
   */
  protected getFlashModel(): string {
    return DeepSeekProvider.FLASH_MODEL
  }

  /**
   * 构造上游请求体（DeepSeek 与 OpenAI 协议完全兼容，结构为 { model, messages, max_tokens?, thinking?, reasoning_effort? }）
   * options.maxTokens: 设置 max_tokens 防止 JSON 字符串被中途截断（DeepSeek JSON Output 官方要求）
   * options.thinkingDisabled: 禁用思考模式以降低延迟（简单 JSON 任务无需推理，~15s → ~2s）
   * options.modelOverride: 单次请求模型覆盖（用于模型分级，简单任务降级到 deepseek-v4-flash 节省成本）
   * options.reasoningEffort: 控制思考强度（'high' | 'max'），仅在 thinking 未禁用时生效
   *   官方文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
   *   语义：thinkingDisabled=true 时忽略 reasoningEffort；否则按指定强度发起思考
   * 文档参考：https://api-docs.deepseek.com/zh-cn/guides/json_mode 与 /guides/thinking_mode
   * @param messages 对话消息数组
   * @param options 可选参数：maxTokens / thinkingDisabled / modelOverride / reasoningEffort
   * @returns DeepSeek 请求体对象
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
    thinking?: { type: string }
    reasoning_effort?: string
    temperature?: number
  } {
    const body: {
      model: string
      messages: ChatMessage[]
      max_tokens?: number
      thinking?: { type: string }
      reasoning_effort?: string
      temperature?: number
    } = {
      // 优先使用 modelOverride（模型分级），其次使用实例配置的 this.model
      model: options?.modelOverride ?? this.model,
      messages,
    }

    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens
    }
    if (options?.thinkingDisabled === true) {
      body.thinking = { type: 'disabled' }
    }
    // 仅在思考未禁用且显式提供 reasoningEffort 时附加字段
    // 官方文档：thinking disabled 与 reasoning_effort 互斥，同时传 reason_effort 会被忽略或报错
    if (options?.reasoningEffort && options.thinkingDisabled !== true) {
      body.reasoning_effort = options.reasoningEffort
    }
    // 采样温度：创作型任务（文章生成）显式传入以打破模板化；未传时跟随上游默认
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    return body
  }

  /**
   * 从响应中提取助手消息内容（DeepSeek 响应结构与 OpenAI 完全一致：choices[0].message.content）
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
