// AI 供应商错误码常量与分类工具（OpenAI 兼容协议通用）
//
// DeepSeek / OpenAI / 通义千问等 OpenAI 兼容上游共用同一套 HTTP 错误码语义：
// https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
//
// 错误码分类：
// - 客户端错误（4xx）：400/401/402/422，不可重试，需用户介入
// - 限速错误（429）：可重试，需等待 Retry-After 指示的时间
// - 服务端错误（5xx）：500/502/503，可重试，指数退避

// 上游错误码常量（DeepSeek/OpenAI/Qwen 语义一致）
// 文档参考：https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
// 历史名称 DEEPSEEK_STATUS 保留导出别名，避免破坏既有引用
export const AI_STATUS = {
  BAD_REQUEST: 400, // 请求体格式错误
  UNAUTHORIZED: 401, // API key 错误，认证失败
  INSUFFICIENT_BALANCE: 402, // 账号余额不足
  PARAM_ERROR: 422, // 请求体参数错误
  RATE_LIMITED: 429, // 请求速率达到上限
  SERVER_ERROR: 500, // 服务器内部故障
  BAD_GATEWAY: 502, // 网关错误
  SERVER_BUSY: 503, // 服务器负载过高
  GATEWAY_TIMEOUT: 504, // 网关超时（服务端代理上游超时返回，暂时性错误）
} as const

// 向后兼容别名：历史代码与测试通过 DEEPSEEK_STATUS 引用
export const DEEPSEEK_STATUS = AI_STATUS

// 可重试的状态码集合（官方文档：429/500/502/503 为暂时性错误）
// 429：请求速率达到上限，等待后可重试
// 500：服务器内部故障，等待后可重试
// 502：网关错误，等待后可重试
// 503：服务器负载过高，等待后可重试
// 504：网关超时——服务端代理在上游 45s 超时时返回（语法填空等长响应偶发超时），
//      属暂时性错误，前端重试会触发服务端重新向上游发起请求（修复
//      语法填空生成偶发失败：SiliconFlow 长响应偶超 45s，旧逻辑 504 不重试直接失败）
const RETRYABLE_STATUSES = new Set<number>([
  AI_STATUS.RATE_LIMITED,
  AI_STATUS.SERVER_ERROR,
  AI_STATUS.BAD_GATEWAY,
  AI_STATUS.SERVER_BUSY,
  AI_STATUS.GATEWAY_TIMEOUT,
])

// 不可重试的客户端错误状态码集合
// 400：请求体格式错误，重试无意义，需修正请求
// 401：API key 错误，重试无意义，需修正配置
// 402：余额不足，重试无意义，需充值
// 422：参数错误，重试无意义，需修正请求参数
const NON_RETRYABLE_CLIENT_ERRORS = new Set<number>([
  AI_STATUS.BAD_REQUEST,
  AI_STATUS.UNAUTHORIZED,
  AI_STATUS.INSUFFICIENT_BALANCE,
  AI_STATUS.PARAM_ERROR,
])

/**
 * 判断 HTTP 状态码是否可重试
 * 可重试：429（限速）、500（服务器故障）、502（网关错误）、503（服务器繁忙）
 * 不可重试：400/401/402/422（客户端错误）与其他 4xx
 *
 * @param status HTTP 状态码
 * @returns true 表示该错误可重试
 */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

/**
 * 判断 HTTP 状态码是否为不可重试的客户端错误
 * 不可重试：400（格式错误）、401（鉴权失败）、402（余额不足）、422（参数错误）
 *
 * @param status HTTP 状态码
 * @returns true 表示该错误为客户端错误，不可重试
 */
export function isNonRetryableClientError(status: number): boolean {
  return NON_RETRYABLE_CLIENT_ERRORS.has(status)
}

// 导出统一错误类，供前端统一处理
export class AIError extends Error {
  constructor(
    public message: string,
    public status?: number,
    public code?: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'AIError'
  }
}

// 供应商显示名映射（用于错误消息本地化）
const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  qwen: '通义千问',
  custom: '自定义模型',
}

/**
 * 获取错误码对应的中文提示消息（按供应商名定制）
 * 基于 OpenAI 兼容协议各上游的通用错误码描述
 *
 * @param status HTTP 状态码
 * @param providerName 供应商名称（缺省时使用通用"AI 服务商"表述）
 * @returns 中文错误提示消息
 */
export function getAIErrorMessage(status: number, providerName?: string): string {
  const label =
    (providerName && PROVIDER_LABELS[providerName]) || 'AI 服务'
  switch (status) {
    case AI_STATUS.BAD_REQUEST:
      return `${label} 请求体格式错误，请检查请求参数`
    case AI_STATUS.UNAUTHORIZED:
      return `${label} API key 错误或认证失败，请检查配置`
    case AI_STATUS.INSUFFICIENT_BALANCE:
      return `${label} 账号余额不足，请充值`
    case AI_STATUS.PARAM_ERROR:
      return `${label} 请求体参数错误，请检查参数配置`
    case AI_STATUS.RATE_LIMITED:
      return `${label} 请求被限速，请稍后重试`
    case AI_STATUS.SERVER_ERROR:
      return `${label} 服务器内部故障，请稍后重试`
    case AI_STATUS.BAD_GATEWAY:
      return `${label} 网关错误，请稍后重试`
    case AI_STATUS.SERVER_BUSY:
      return `${label} 服务器繁忙，请稍后重试`
    default:
      return `${label} API 返回错误：HTTP ${status}`
  }
}

/**
 * 兼容旧接口：DeepSeek 错误码中文提示
 * 内部转发 getAIErrorMessage(status, 'deepseek')，消息文案与历史版本完全一致
 *
 * @param status HTTP 状态码
 * @returns 中文错误提示消息
 */
export function getDeepSeekErrorMessage(status: number): string {
  return getAIErrorMessage(status, 'deepseek')
}
