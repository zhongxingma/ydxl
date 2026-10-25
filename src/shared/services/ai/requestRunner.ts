// Provider 传输层
//
// 从 BaseAIProvider 抽离与业务无关的请求执行细节：
// - 客户端并发节流（信号量，上限 5）
// - 网络错误/超时/5xx 的指数退避重试
// - callChat / callChatStream 的端点、请求头、请求体信封、fetch、SSE 解析与错误映射
// - Token 用量统计与 AI 来源追踪
//
// 供应商差异化逻辑（端点解析、请求体构造、响应内容解析、JSON 能力）通过
// ProviderRequestContext 注入，BaseAIProvider 仅保留同名 protected 方法委托。
import { AIError, type ChatMessage } from './types'
import {
  isRetryableStatus,
  isNonRetryableClientError,
  getAIErrorMessage,
  AI_STATUS,
} from './errors'
import * as tokenStats from './tokenStats'
import { recordAIUsage } from './aiUsageTracker'
import { getToken } from '../authService'

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

// 内部错误标记：可重试的 AIError（5xx、网络错误、超时）
class RetryableAIError extends AIError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'RetryableAIError'
  }
}

// 判断错误是否可重试
// 可重试：网络错误（非 AIError 或包含"网络错误"）、超时（包含"超时"）、上游 5xx
// 不可重试：4xx 客户端错误、响应解析错误、内容缺失错误、外部中断 AbortError
function isRetryableError(err: unknown): boolean {
  // 0. 外部中断（AbortError）不重试
  // callChat 中超时 AbortError 已被转为 RetryableAIError，不会到达此处；
  // callChatStream 中外部 signal 触发的 AbortError 是原始 Error，需在此拦截不重试
  if (err instanceof Error && err.name === 'AbortError') return false
  // 1. 非 AIError 的原始错误（fetch 抛出的 TypeError 等）→ 可重试
  if (!(err instanceof AIError)) return true
  // 2. RetryableAIError（5xx、网络错误、超时）→ 可重试
  if (err instanceof RetryableAIError) return true
  // 3. 兜底兼容：message 包含 "网络错误" → 可重试
  if (err.message.includes('网络错误')) return true
  // 4. 其他 AIError（4xx、解析错误等）→ 不重试
  return false
}

// 指数退避重试：第 1 次重试等待 1000ms，第 2 次重试等待 2000ms
// 仅对网络错误、超时、上游 5xx 重试；4xx 与解析错误立即抛出
// nextDelayMs 回调用于在捕获错误时动态计算退避时间（如 429 的 retry_after）：
//   - 返回非 null 值时使用该值作为退避时间
//   - 返回 null 或未提供时回退到指数退避 1000 * Math.pow(2, attempt)
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  nextDelayMs?: (attempt: number, err: unknown) => number | null,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRetryableError(err) || attempt === maxRetries) {
        throw err
      }
      // 优先使用 nextDelayMs 返回的动态退避时间（如 429 的 retry_after）
      // 若返回 null 或未提供回调，回退到指数退避：attempt=0 → 1000ms，attempt=1 → 2000ms
      const dynamicDelay = nextDelayMs?.(attempt, err) ?? null
      const delay = dynamicDelay != null ? dynamicDelay : 1000 * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  // 理论上不可达（循环内必定 return 或 throw），TS 不够聪明需要这行
  throw lastError
}

// 客户端并发限流：保守上限 5（远低于 deepseek-v4-pro 的 500 上限，避免突发流量触发 429）
class ConcurrencyLimiter {
  private inflightCount = 0
  private readonly waitQueue: Array<() => void> = []

  constructor(private readonly maxConcurrent: number) {}

  // 获取并发槽位：超过上限时排队等待
  // @returns 释放函数，须在 finally 中调用
  async acquire(): Promise<() => void> {
    if (this.inflightCount < this.maxConcurrent) {
      this.inflightCount++
      return () => this.release()
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve))
    this.inflightCount++
    return () => this.release()
  }

  private release(): void {
    this.inflightCount--
    const next = this.waitQueue.shift()
    if (next) {
      next()
    }
  }
}

// 传输层执行器：每个 Provider 实例持有一个（并发与重试状态按实例隔离）
export class ProviderRequestRunner {
  private readonly limiter = new ConcurrencyLimiter(5)

  constructor(private readonly ctx: ProviderRequestContext) {}

  // 构造请求头：代理模式带会话令牌，直连模式带 Authorization
  private buildHeaders(effectiveApiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.ctx.getProxyBaseUrl()) {
      // 代理模式：携带登录会话令牌（多用户 P0 服务端认证门校验）；
      // 未登录（如测试环境无会话）回退到 apiKey 占位（历史兼容）
      const sessionToken = getToken()
      if (sessionToken) {
        headers['x-user-token'] = sessionToken
      } else {
        const apiKey = this.ctx.getApiKey()
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
  private buildRequest(
    messages: ChatMessage[],
    options: ChatRequestOptions,
    stream: boolean,
  ): { effectiveModel: string; requestBody: Record<string, unknown> } {
    const proxyBaseUrl = this.ctx.getProxyBaseUrl()
    // 实际使用的模型：优先 modelOverride（模型分级），其次实例配置
    const effectiveModel = options.modelOverride ?? this.ctx.getModel()

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
    const baseBody = this.ctx.buildRequestBody(messages, buildOptions) as Record<string, unknown>
    // 若 jsonMode 为 true 且供应商支持，则附加 response_format 字段启用 JSON Output 模式
    // 不支持的供应商（meta.supportsJsonMode=false）静默跳过，仅靠 prompt 约束输出
    // expectArray 数组场景与 json_object 模式语义冲突时（第三方严格服从「顶层必须是
    // object」，见 jsonModeSupportsArray 注释）同样跳过，避免数组退化为单对象
    const useJsonMode =
      options.jsonMode === true &&
      this.ctx.supportsJsonMode() &&
      !(options.expectArray === true && !this.ctx.jsonModeSupportsArray())
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
      ? { provider: this.ctx.providerName(), body: upstreamBody }
      : upstreamBody
    return { effectiveModel, requestBody }
  }

  // 读取非 2xx 响应体：提取 { error: { message } } 与 429 建议等待时间
  private async readErrorResponse(
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
        console.warn('[base-provider] 错误响应 JSON 解析失败，回退到 text()', err)
      errorMessage = await res.text().catch(() => '')
    }
    return { message: errorMessage, retryAfterMs }
  }

  // 统一处理 Chat 请求/响应/错误
  // 含端点解析、headers 设置、信封 body 包装、fetch（含超时）、错误处理、内容提取
  // 整个流程包装在 retryWithBackoff 中，对网络错误/超时/5xx 自动重试 2 次
  async callChat(messages: ChatMessage[], options: ChatRequestOptions = {}): Promise<string> {
    const provider = this.ctx.providerName()
    // 解析有效密钥：显式 apiKey > keyResolver（secureStorage 用户配置）
    const effectiveApiKey = await this.ctx.getEffectiveApiKey()
    // 直连模式且无可用密钥时抛错
    if (!effectiveApiKey && !this.ctx.getProxyBaseUrl()) {
      throw new AIError(`未配置 ${provider} apiKey 且未设置代理地址，无法发起请求`)
    }

    const endpoint = this.ctx.resolveEndpoint()
    const headers = this.buildHeaders(effectiveApiKey)
    const { effectiveModel, requestBody } = this.buildRequest(messages, options, false)

    // 请求级可观测性日志：发起前记录请求元数据（不在重试回调内，避免每次重试都记录）
    const startMs = performance.now()
    console.debug('[AI Request]', {
      provider,
      model: effectiveModel,
      maxTokens: options.maxTokens,
      jsonMode: options.jsonMode === true,
      thinkingDisabled: options.thinkingDisabled === true,
      reasoningEffort: options.reasoningEffort,
      scenario: options.scenario,
    })

    // 客户端并发节流：acquire 包裹整个 retryWithBackoff（含所有重试），避免突发流量触发 429
    const releaseSlot = await this.limiter.acquire()
    try {
      // nextRetryDelayMs：429 响应中 retry_after（秒）转毫秒后的动态退避时间
      // 在 retryWithBackoff 回调内设置，由 nextDelayMs 回调读取；每次进入回调时重置为 null
      let nextRetryDelayMs: number | null = null
      // 整个 fetch + 状态检查 + 响应解析 + 内容提取包装在 retryWithBackoff 中
      const result = await retryWithBackoff(
        async () => {
          // 每次进入回调时重置 nextRetryDelayMs，避免上次错误残留
          nextRetryDelayMs = null
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), this.ctx.getFetchTimeoutMs())
          try {
            let res: Response
            try {
              res = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal,
              })
            } catch (err) {
              // 超时（AbortError）视为网络错误，可重试
              if (err instanceof Error && err.name === 'AbortError') {
                throw new RetryableAIError('请求超时（60s）', err)
              }
              // 其他 fetch 异常（TypeError 等）视为网络错误，可重试
              throw new RetryableAIError(`${provider} 请求发送失败（网络错误）`, err)
            }

            if (!res.ok) {
              const { message: errorMessage, retryAfterMs } = await this.readErrorResponse(res)
              if (retryAfterMs != null) nextRetryDelayMs = retryAfterMs
              const message = `${provider} 请求失败：HTTP ${res.status} ${res.statusText}${
                errorMessage ? ` - ${errorMessage}` : ''
              }`
              // 可重试状态（429/500/502/503）抛 RetryableAIError 触发重试
              if (isRetryableStatus(res.status)) {
                throw new RetryableAIError(message)
              }
              // 402 余额不足附加明确消息
              if (res.status === AI_STATUS.INSUFFICIENT_BALANCE) {
                throw new AIError(getAIErrorMessage(res.status, provider))
              }
              // 其他不可重试客户端错误（400/401/422）附加官方中文提示
              if (isNonRetryableClientError(res.status)) {
                throw new AIError(getAIErrorMessage(res.status, provider))
              }
              throw new AIError(message)
            }

            let data: unknown
            try {
              data = await res.json()
            } catch (err) {
              // 响应解析失败不重试（可能是上游返回非 JSON 内容）
              throw new AIError(`${provider} 响应解析失败`, err)
            }

            // 提取助手消息内容（由子类实现差异化解析）
            const content = this.ctx.parseContent(data)
            if (!content) {
              // JSON 模式下空内容是部分模型/网关的偶发问题（DeepSeek 官方文档有记载，
              // 第三方兼容端点同样存在），抛出 RetryableAIError 以触发自动重试
              if (options.jsonMode === true) {
                throw new RetryableAIError(`${provider} JSON 模式返回空内容，将自动重试`)
              }
              throw new AIError(`${provider} 响应中未包含有效的文本内容`)
            }
            // 请求成功日志：记录耗时与 token 用量（仅在成功路径记录，错误路径由重试抛出）
            const durationMs = Math.round(performance.now() - startMs)
            const usage = (data as { usage?: unknown })?.usage
            console.debug('[AI Response]', {
              provider,
              model: effectiveModel,
              durationMs,
              usage: usage ?? undefined,
              scenario: options.scenario,
            })
            // Token 用量统计（best-effort，失败不阻塞主流程）
            // 仅在 usage 字段存在时记录，避免无 usage 的响应产生噪声数据
            // DeepSeek 官方响应含 prompt_cache_hit_tokens / prompt_cache_miss_tokens
            try {
              if (usage && typeof usage === 'object') {
                const u = usage as {
                  prompt_tokens?: number
                  completion_tokens?: number
                  prompt_cache_hit_tokens?: number
                  prompt_cache_miss_tokens?: number
                }
                tokenStats.recordUsage(
                  options.scenario ?? 'unknown',
                  effectiveModel,
                  {
                    prompt_tokens: u.prompt_tokens ?? 0,
                    completion_tokens: u.completion_tokens ?? 0,
                    prompt_cache_hit_tokens: u.prompt_cache_hit_tokens,
                    prompt_cache_miss_tokens: u.prompt_cache_miss_tokens,
                  },
                  false,
                )
              }
            } catch (statsErr) {
              if (import.meta.env.DEV)
                console.warn('[base-provider] token 统计记录失败', statsErr)
            }
            return content
          } finally {
            // 清理 timeout 避免 AbortController 回调悬空导致内存泄漏
            clearTimeout(timeoutId)
          }
        },
        2,
        () => nextRetryDelayMs,
      )
      // AI 来源追踪：谁真正完成请求就记谁（供前端模块展示「来自哪个 AI 接口」）
      recordAIUsage(
        options.scenario ?? 'unknown',
        provider,
        this.ctx.usagePlatformLabel(),
        effectiveModel,
        true,
      )
      return result
    } catch (err) {
      // 失败也记录（徽章展示失败状态，便于排查自定义 API 是否兜底成功）
      recordAIUsage(
        options.scenario ?? 'unknown',
        provider,
        this.ctx.usagePlatformLabel(),
        effectiveModel,
        false,
      )
      throw err
    } finally {
      releaseSlot()
    }
  }

  // 流式 Chat 调用：解析 SSE 数据块，累积 delta.content，支持外部中断与进度回调
  //
  // - 端点：代理模式拼接 `${proxyBaseUrl}/v1/ai-proxy/<providerName>/stream`
  // - 请求体：附加 stream: true + stream_options: { include_usage: true }
  // - 响应解析：逐 chunk 解析 SSE `data: {...}` 行，累积 delta.content
  // - 重试：网络错误/超时/5xx/JSON 空内容自动重试 2 次；外部 signal 中断不重试
  // - 重试时静默不调 onChunk，重试成功后一次性发送完整文本
  async callChatStream(
    messages: ChatMessage[],
    options: ChatStreamRequestOptions,
  ): Promise<string> {
    const provider = this.ctx.providerName()
    const proxyBaseUrl = this.ctx.getProxyBaseUrl()
    const effectiveApiKey = await this.ctx.getEffectiveApiKey()
    if (!effectiveApiKey && !proxyBaseUrl) {
      throw new AIError(`未配置 ${provider} apiKey 且未设置代理地址，无法发起请求`)
    }

    // 流式端点：代理模式拼接 /stream 后缀，直连模式保持原端点（请求体加 stream:true）
    const endpoint = proxyBaseUrl
      ? `${proxyBaseUrl.replace(/\/+$/, '')}/v1/ai-proxy/${provider}/stream`
      : this.ctx.defaultEndpoint()
    const headers = this.buildHeaders(effectiveApiKey)
    const { effectiveModel, requestBody } = this.buildRequest(messages, options, true)

    const startMs = performance.now()
    console.debug('[AI Stream Request]', {
      provider,
      model: effectiveModel,
      maxTokens: options.maxTokens,
      jsonMode: options.jsonMode === true,
      thinkingDisabled: options.thinkingDisabled === true,
      scenario: options.scenario,
      hasSignal: !!options.signal,
    })

    // 客户端并发节流
    const releaseSlot = await this.limiter.acquire()
    try {
      // isFirstAttempt 跨重试保持状态：首次尝试正常流式输出 onChunk；
      // 重试时静默（避免 UI 残留 partial 文本）；重试成功后一次性发送完整文本
      let isFirstAttempt = true
      const result = await retryWithBackoff(
        async () => {
          // 每次重试新建 timeoutController，避免上次 abort 状态残留
          const timeoutController = new AbortController()
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            this.ctx.getFetchTimeoutMs(),
          )
          // 外部 signal 触发时中断超时 controller
          const externalSignal = options.signal
          if (externalSignal) {
            if (externalSignal.aborted) {
              timeoutController.abort()
            } else {
              externalSignal.addEventListener('abort', () => timeoutController.abort(), {
                once: true,
              })
            }
          }

          try {
            let res: Response
            try {
              res = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: timeoutController.signal,
              })
            } catch (err) {
              // 外部 signal 触发的中断：抛出 AbortError 让上层识别（不重试）
              if (externalSignal?.aborted) {
                const abortErr = new Error('请求被外部中断')
                abortErr.name = 'AbortError'
                throw abortErr
              }
              // 超时（AbortError）转为 RetryableAIError 以触发重试
              if (err instanceof Error && err.name === 'AbortError') {
                throw new RetryableAIError(`${provider} 流式请求超时（60s）`, err)
              }
              // 其他 fetch 异常（TypeError 等）视为网络错误，可重试
              throw new RetryableAIError(`${provider} 流式请求发送失败（网络错误）`, err)
            }

            if (!res.ok || !res.body) {
              // 错误响应：尝试解析 JSON 提取错误信息
              const { message: errorMessage } = await this.readErrorResponse(res)
              const message = `${provider} 流式请求失败：HTTP ${res.status} ${res.statusText}${
                errorMessage ? ` - ${errorMessage}` : ''
              }`
              // 可重试状态（429/500/502/503）抛 RetryableAIError 触发重试
              if (isRetryableStatus(res.status)) {
                throw new RetryableAIError(message)
              }
              // 402 余额不足等可识别错误附加中文提示
              if (res.status === AI_STATUS.INSUFFICIENT_BALANCE) {
                throw new AIError(getAIErrorMessage(res.status, provider))
              }
              if (isNonRetryableClientError(res.status)) {
                throw new AIError(getAIErrorMessage(res.status, provider))
              }
              throw new AIError(message)
            }

            // 解析 SSE 流
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let fullText = ''
            let usage: unknown = null

            try {
              // eslint-disable-next-line no-constant-condition -- 流式读取标准模式，退出条件为 reader.read() 返回 done
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                // SSE 事件以双换行分隔，按行处理
                const lines = buffer.split('\n')
                buffer = lines.pop() ?? ''
                for (const line of lines) {
                  const trimmedLine = line.trim()
                  if (!trimmedLine.startsWith('data: ')) continue
                  const data = trimmedLine.slice(6).trim()
                  if (data === '[DONE]') continue
                  try {
                    const chunk = JSON.parse(data) as {
                      choices?: Array<{
                        delta?: { content?: string; reasoning_content?: string }
                      }>
                      usage?: unknown
                      error?: { message?: string }
                    }
                    // 错误事件
                    if (chunk.error) {
                      throw new AIError(
                        `${provider} 流式响应错误：${chunk.error.message ?? '未知错误'}`,
                      )
                    }
                    const delta = chunk.choices?.[0]?.delta?.content ?? ''
                    if (delta) {
                      fullText += delta
                      // 仅首次尝试时流式输出 onChunk，重试时静默累积
                      if (isFirstAttempt) {
                        options.onChunk?.(delta, fullText)
                      }
                    }
                    // 流末尾 usage 字段（stream_options.include_usage）
                    if (chunk.usage) {
                      usage = chunk.usage
                    }
                  } catch (parseErr) {
                    // JSON 解析失败：忽略该 chunk（可能是 keep-alive 空行或部分数据）
                    if (parseErr instanceof AIError) throw parseErr
                    // 普通 JSON 解析错误静默忽略
                  }
                }
              }
            } finally {
              reader.releaseLock()
            }

            const durationMs = Math.round(performance.now() - startMs)
            console.debug('[AI Stream Response]', {
              provider,
              model: effectiveModel,
              durationMs,
              textLength: fullText.length,
              scenario: options.scenario,
            })

            // Token 用量统计（best-effort）
            try {
              if (usage && typeof usage === 'object') {
                const u = usage as {
                  prompt_tokens?: number
                  completion_tokens?: number
                  prompt_cache_hit_tokens?: number
                  prompt_cache_miss_tokens?: number
                }
                tokenStats.recordUsage(
                  options.scenario ?? 'unknown',
                  effectiveModel,
                  {
                    prompt_tokens: u.prompt_tokens ?? 0,
                    completion_tokens: u.completion_tokens ?? 0,
                    prompt_cache_hit_tokens: u.prompt_cache_hit_tokens,
                    prompt_cache_miss_tokens: u.prompt_cache_miss_tokens,
                  },
                  false,
                )
              }
            } catch (statsErr) {
              if (import.meta.env.DEV)
                console.warn('[base-provider] 流式 token 统计记录失败', statsErr)
            }

            if (!fullText) {
              // JSON 模式下空内容是部分模型/网关的偶发问题，抛 RetryableAIError 触发重试
              if (options.jsonMode === true) {
                throw new RetryableAIError(
                  `${provider} 流式 JSON 模式返回空内容，将自动重试`,
                )
              }
              throw new AIError(`${provider} 流式响应中未包含有效的文本内容`)
            }
            // 重试成功后一次性发送完整文本，保证 UI 拿到完整内容
            if (!isFirstAttempt) {
              options.onChunk?.(fullText, fullText)
            }
            return fullText
          } catch (err) {
            // 首次尝试失败时重置 UI（清除 partial 文本），并标记后续为重试模式
            // 无论错误是否可重试都重置：可重试错误后续静默重试，不可重试错误由上层处理
            if (isFirstAttempt) {
              isFirstAttempt = false
              options.onChunk?.('', '')
            }
            throw err
          } finally {
            clearTimeout(timeoutId)
          }
        },
        2, // max 2 retries (3 total attempts)
      )
      // AI 来源追踪：谁真正完成请求就记谁（供前端模块展示「来自哪个 AI 接口」）
      recordAIUsage(
        options.scenario ?? 'unknown',
        provider,
        this.ctx.usagePlatformLabel(),
        effectiveModel,
        true,
      )
      return result
    } catch (err) {
      // 失败也记录（徽章展示失败状态，便于排查自定义 API 是否兜底成功）
      recordAIUsage(
        options.scenario ?? 'unknown',
        provider,
        this.ctx.usagePlatformLabel(),
        effectiveModel,
        false,
      )
      throw err
    } finally {
      releaseSlot()
    }
  }
}
