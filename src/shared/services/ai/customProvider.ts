// 自定义模型供应商实现
//
// 参考 Trae「自定义模型」设计：通过配置 API 格式、请求地址、模型 ID 和鉴权信息，
// 接入任意 OpenAI Chat Completions 兼容的模型服务（如本地 Ollama、One-API 网关、
// 第三方聚合平台等），不受内置供应商列表限制。
//
// 两种工作模式（由 index.ts 工厂按配置来源决策）：
// - 浏览器直连：用户在「个人中心 → AI 设置」填写了自己的请求地址（localStorage）。
//   SSRF 防护：用户端点不经服务端转发，避免任意 URL 引入服务端 SSRF 风险。
// - 服务端代理：生产代理模式（VITE_AI_PROXY_URL）且用户未自填端点、仅使用 env
//   默认配置时，请求路由到服务端 /v1/ai-proxy/custom 上游节点，由服务端转发到
//   部署者在 .env 配置的 CUSTOM_API_ENDPOINT（密钥留服务端，避免 CORS 与密钥泄露）。
//
// 请求地址填写方式（与 Trae 一致）：
// - 完整 URL：以 /chat/completions 结尾（或包含 /chat/completions），直接使用
//   例：https://api.example.com/v1/chat/completions
// - Base URL：不含 /chat/completions 时自动拼接该路径
//   例：https://api.example.com/v1 → https://api.example.com/v1/chat/completions
//
// 模型分级说明：自定义模型无内置轻量模型，getFlashModel 返回 undefined，
// 所有任务统一使用用户配置的模型 ID。
import type { ChatMessage } from './types'
import { BaseAIProvider, type BaseProviderConfig } from './baseProvider'

// 自定义模型配置（在 BaseProviderConfig 基础上增加端点必填项）
export interface CustomProviderConfig extends BaseProviderConfig {
  // OpenAI 兼容请求地址（完整 URL 或 Base URL，见文件头注释）
  endpoint: string
}

/**
 * 规范化自定义端点为完整的 chat/completions URL
 * - 已含 /chat/completions：原样返回（去除尾部斜杠）
 * - 否则视为 Base URL：拼接 /chat/completions
 * @param endpoint 用户输入的端点
 * @returns 规范化后的完整 URL
 */
export function normalizeCustomEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed
  }
  return `${trimmed}/chat/completions`
}

/**
 * 从端点 URL 推断自定义模型接入的实际平台标签
 * 用于 AI 来源徽章展示「从哪个平台调用」（用户诉求：只显示模型 ID 无法判断平台）
 * @param endpoint 自定义端点（完整 URL 或 Base URL）
 * @returns 平台标签：已知平台返回中文名/品牌名，未知平台返回 URL host，解析失败返回 '自定义'
 */
export function inferCustomPlatformLabel(endpoint: string): string {
  const url = endpoint.trim().toLowerCase()
  if (!url) return '自定义'
  if (url.includes('openrouter.ai')) return 'OpenRouter'
  if (url.includes('siliconflow')) return 'SiliconFlow'
  if (url.includes('deepseek')) return 'DeepSeek'
  if (url.includes('dashscope') || url.includes('aliyuncs')) return '阿里云百炼'
  if (url.includes('bigmodel') || url.includes('zhipuai')) return '智谱AI'
  if (url.includes('moonshot')) return 'Kimi'
  if (url.includes('volces') || url.includes('doubao')) return '火山方舟'
  if (url.includes('together.ai')) return 'Together AI'
  if (url.includes('groq.com')) return 'Groq'
  if (url.includes('openai.com')) return 'OpenAI'
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('ollama')) {
    return '本地模型'
  }
  // 未知端点：提取 host 作为平台标识（比「自定义模型」更具诊断价值）
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).host
  } catch {
    return '自定义'
  }
}

// 自定义模型供应商实现
export class CustomProvider extends BaseAIProvider {
  // 规范化后的上游端点
  private readonly endpoint: string

  constructor(config: CustomProviderConfig) {
    super(config)
    // 端点必填校验：自定义模型没有官方默认端点，缺失时立即暴露问题
    // （连接测试场景下 createAIProviderByName 会传入空串触发此错误）
    if (!config.endpoint || !config.endpoint.trim()) {
      throw new Error('自定义模型未配置请求地址，请在设置中填写 API 端点')
    }
    this.endpoint = normalizeCustomEndpoint(config.endpoint)
  }

  /**
   * 返回当前 Provider 名称（代理模式请求体 provider 字段与端点拼接用）
   */
  providerName(): 'custom' {
    return 'custom'
  }

  /**
   * 数组类场景与 json_object 模式不兼容（见基类 jsonModeSupportsArray 注释）：
   * 第三方 OpenAI 兼容端点严格服从「顶层必须是 object」语义，会把数组退化为
   * 单个对象（丢失数组括号、只剩第 1 条数据），因此 expectArray 场景跳过 response_format
   */
  protected jsonModeSupportsArray(): boolean {
    return false
  }

  /**
   * AI 来源徽章的平台标签：按端点 URL 推断实际平台（SiliconFlow/OpenRouter/...）
   * 用户仅凭模型 ID 无法判断调用的是哪个平台，端点是最可靠的平台信号
   */
  protected usagePlatformLabel(): string {
    return inferCustomPlatformLabel(this.endpoint)
  }

  /**
   * 返回直连模式端点（用户配置的规范化 URL）
   */
  defaultEndpoint(): string {
    return this.endpoint
  }

  // 返回默认模型名；自定义模型必须由用户显式提供模型 ID，
  // 未提供时抛错提示（构造后首次调用时暴露）
  protected defaultModel(): string {
    return ''
  }

  // 自定义模型无内置轻量模型，不分级（继承基类默认 undefined 行为）
  // 显式覆盖仅为文档化意图
  protected getFlashModel(): string | undefined {
    return undefined
  }

  /**
   * 构造上游请求体（标准 OpenAI 协议：{ model, messages, max_tokens?, enable_thinking? | thinking? }）
   *
   * 思考开关（2026-08-30 修复「文章生成长期走兜底」根因）：
   * 基类对结构化 JSON 任务（generateArticle / generateQuestions / 词汇短语等）传入
   * thinkingDisabled: true，本类此前丢弃该参数 → SiliconFlow 等平台的 DeepSeek V4 模型
   * 默认深度思考：单篇作文实测多耗 4000+ 思考 token、耗时 85s（逼近服务端 150s 超时线），
   * 偶发超时被 FallbackAIProvider 判为「自定义异常」，切换到 DeepSeek 官方兜底。
   * 现按平台透传对应的关闭思考参数名（第三方 OpenAI 兼容网关互不兼容）：
   * - SiliconFlow / 阿里云百炼（DashScope compatible-mode）→ enable_thinking: false
   * - 其余（DeepSeek 官方、OpenRouter、未知网关）→ thinking: { type: 'disabled' }
   *   （DeepSeek 官方惯例；个别不认识该字段的网关会忽略或 400，由 FallbackAIProvider
   *   与兜底素材库接住，最坏退化为旧行为）
   * - OpenAI 官方端点不附加（无 thinking 字段语义，避免 400）
   * reasoningEffort 仍不透传：自定义无内置分级语义，且与关闭思考互斥。
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
    enable_thinking?: boolean
    thinking?: { type: string }
    temperature?: number
  } {
    const body: {
      model: string
      messages: ChatMessage[]
      max_tokens?: number
      enable_thinking?: boolean
      thinking?: { type: string }
      temperature?: number
    } = {
      // modelOverride 仅在同实例内有效（自定义无内置分级表），
      // 正常情况下等于 this.model
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
    if (options?.thinkingDisabled === true) {
      const platform = inferCustomPlatformLabel(this.endpoint)
      if (platform === 'SiliconFlow' || platform === '阿里云百炼') {
        body.enable_thinking = false
      } else if (platform !== 'OpenAI') {
        body.thinking = { type: 'disabled' }
      }
    }
    return body
  }

  /**
   * 从响应中提取助手消息内容（choices[0].message.content）
   */
  parseContent(data: unknown): string {
    return (
      (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message
        ?.content ?? ''
    )
  }
}
