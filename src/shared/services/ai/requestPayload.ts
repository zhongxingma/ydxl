// 传输层请求构造：请求头、请求体信封与错误响应解析
import { logger } from '../../utils/logger'
import type { ChatMessage } from './types'
import type {
  ChatRequestOptions,
  ProviderRequestContext,
} from './requestTypes'
import { getToken } from '../authService'

// 构造请求头：代理模式带会话令牌，直连模式带 Authorization
export function buildHeaders(
  ctx: ProviderRequestContext,
  effectiveApiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (ctx.getProxyBaseUrl()) {
    // 代理模式：携带登录会话令牌（多用户服务端认证门校验）；
    // 未登录（如测试环境无会话）回退到 apiKey 占位（历史兼容）
    const sessionToken = getToken()
    if (sessionToken) {
      headers['x-user-token'] = sessionToken
    } else {
      const apiKey = ctx.getApiKey()
      if (apiKey) {
        headers['x-user-token'] = apiKey
      }
    }
  } else if (effectiveApiKey) {
    // 直连模式：使用 Authorization 头携带 apiKey
    headers.Authorization = `Bearer ${effectiveApiKey}`
  }
  return headers
}

// 构造最终请求体：JSON 能力门控 + 流式字段 + 代理信封
export function buildRequest(
  ctx: ProviderRequestContext,
  messages: ChatMessage[],
  options: ChatRequestOptions,
  stream: boolean,
): { effectiveModel: string; requestBody: Record<string, unknown> } {
  const proxyBaseUrl = ctx.getProxyBaseUrl()
  // 实际使用的模型：优先 modelOverride（模型分级），其次实例配置
  const effectiveModel = options.modelOverride ?? ctx.getModel()

  // 构造上游请求体：调用子类 buildRequestBody，传入 maxTokens / thinkingDisabled /
  // modelOverride / reasoningEffort / temperature
  const buildOptions =
    options.maxTokens !== undefined ||
    options.thinkingDisabled !== undefined ||
    options.modelOverride !== undefined ||
    options.reasoningEffort !== undefined ||
    options.temperature !== undefined
      ? {
          maxTokens: options.maxTokens,
          thinkingDisabled: options.thinkingDisabled,
          modelOverride: options.modelOverride,
          reasoningEffort: options.reasoningEffort,
          temperature: options.temperature,
        }
      : undefined
  const baseBody = ctx.buildRequestBody(messages, buildOptions) as Record<string, unknown>
  // 若 jsonMode 为 true 且供应商支持，则附加 response_format 字段启用 JSON Output 模式
  // 不支持的供应商（meta.supportsJsonMode=false）静默跳过，仅靠 prompt 约束输出
  // expectArray 数组场景与 json_object 模式语义冲突时（第三方严格服从「顶层必须是
  // object」，见 jsonModeSupportsArray 注释）同样跳过，避免数组退化为单对象
  const useJsonMode =
    options.jsonMode === true &&
    ctx.supportsJsonMode() &&
    !(options.expectArray === true && !ctx.jsonModeSupportsArray())
  const upstreamBody: Record<string, unknown> = useJsonMode
    ? { ...baseBody, response_format: { type: 'json_object' } }
    : baseBody
  if (stream && !proxyBaseUrl) {
    // 直连模式附加 stream + stream_options；代理模式由服务端路由强制附加
    upstreamBody.stream = true
    upstreamBody.stream_options = { include_usage: true }
  }
  // 直连模式使用原始 body，代理模式包装为 { provider, body } 信封结构
  const requestBody = proxyBaseUrl
    ? { provider: ctx.providerName(), body: upstreamBody }
    : upstreamBody
  return { effectiveModel, requestBody }
}

// 读取非 2xx 响应体：提取 { error: { message } } 与 429 建议等待时间
export async function readErrorResponse(
  res: Response,
): Promise<{ message: string; retryAfterMs: number | null }> {
  let errorMessage = ''
  let retryAfterMs: number | null = null
  try {
    const errBody = await res.json()
    if (
      errBody &&
      typeof errBody === 'object' &&
      'error' in errBody &&
      errBody.error &&
      typeof errBody.error === 'object' &&
      'message' in errBody.error
    ) {
      errorMessage = String((errBody.error as { message: unknown }).message)
    } else {
      // json 解析成功但无 error.message 字段，回退到 res.text()
      errorMessage = await res.text().catch(() => '')
    }
    // 解析 429 限速响应中的建议等待时长（单位：秒，需乘以 1000 转毫秒）
    // 兼容两种约定：DeepSeek 的 body 内 retry_after 数字字段，
    // 以及 OpenAI/Cloudflare 等网关的 Retry-After 响应头（数字秒数）
    const bodyRetryAfter = errBody as { retry_after?: unknown }
    if (typeof bodyRetryAfter?.retry_after === 'number') {
      retryAfterMs = bodyRetryAfter.retry_after * 1000
    } else {
      const headerValue = res.headers.get('Retry-After')
      const headerSeconds = headerValue ? Number(headerValue) : NaN
      if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
        retryAfterMs = headerSeconds * 1000
      }
    }
  } catch (err) {
    // json 解析失败，回退到 res.text()
    if (import.meta.env.DEV)
      logger.warn('[base-provider] 错误响应 JSON 解析失败，回退到 text()', err)
    errorMessage = await res.text().catch(() => '')
  }
  return { message: errorMessage, retryAfterMs }
}
