// 通义千问（阿里云百炼）供应商实现
//
// Qwen 通过 DashScope 兼容模式提供 OpenAI 兼容的 Chat Completions API，
// 请求/响应结构与 DeepSeek 一致，仅端点与默认模型不同。
// 公共逻辑继承自 BaseAIProvider，仅实现差异化方法。
//
// 协议差异说明：
// - 兼容模式下 thinking / reasoning_effort / response_format 等字段支持程度有限：
//   * qwen3 系列 enable_thinking 默认关闭（兼容模式），thinkingDisabled 无需透传
//   * response_format: json_object 在部分模型/区域可用，由 BaseAIProvider 的
//     supportsJsonMode() 能力探测统一控制（当前 meta 配置为 true，失败时可改为 false 全局降级）
//
// 支持两种模式：
// 1. 直连模式：调用 https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions，Bearer 鉴权
// 2. 代理模式：端点拼接为 `${proxyBaseUrl}/v1/ai-proxy/qwen`，x-user-token 头传令牌
//
// 文档参考：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
import type { ChatMessage } from './types'
import { BaseAIProvider } from './baseProvider'
import { AI_PROVIDER_META } from './types'

// 通义千问 DashScope OpenAI 兼容端点（直连模式）
const QWEN_DEFAULT_ENDPOINT = AI_PROVIDER_META.qwen.endpoint

// 通义千问供应商实现
export class QwenProvider extends BaseAIProvider {
  // 高质量模型（用于复杂任务：文章生成、题目生成、词汇提取）
  // 文档参考：https://help.aliyun.com/zh/model-studio/models
  static readonly PRO_MODEL = 'qwen3-max'

  // 轻量模型（用于简单任务分级，降低成本：翻译、拼读、emoji、例句等）
  static readonly FLASH_MODEL = 'qwen3-turbo'

  /**
   * 返回当前 Provider 名称（用于代理模式请求体的 provider 字段与端点拼接）
   * @returns 固定字符串 'qwen'
   */
  providerName(): 'qwen' {
    return 'qwen'
  }

  /**
   * 返回直连模式默认端点
   * @returns DashScope OpenAI 兼容端点 URL
   */
  defaultEndpoint(): string {
    return QWEN_DEFAULT_ENDPOINT
  }

  // 返回默认模型名（当 config.model 未指定时使用）
  protected defaultModel(): string {
    return QwenProvider.PRO_MODEL
  }

  /**
   * 返回轻量模型名（用于简单任务分级，降低成本）
   * @returns 固定返回 'qwen3-turbo'
   */
  protected getFlashModel(): string {
    return QwenProvider.FLASH_MODEL
  }

  /**
   * 构造上游请求体（OpenAI 兼容协议：{ model, messages, max_tokens? }）
   * @param messages 对话消息数组
   * @param options 可选参数（thinkingDisabled / reasoningEffort 仅接受不透传；modelOverride 用于模型分级）
   * @returns Qwen 请求体对象
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
    // 注：不透传 thinking / reasoning_effort（DeepSeek 私有扩展字段）；
    // qwen3 兼容模式默认非思考输出，无需额外参数即可获得低延迟 JSON 响应
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
