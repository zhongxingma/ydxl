// Provider 传输层执行器
//
// 组装请求执行流程（端点、鉴权、请求体、fetch、错误映射、Token 统计与来源追踪），
// 具体细节按职责拆分：
//   - requestRetry.ts：RetryableAIError、指数退避重试、并发限流
//   - requestPayload.ts：请求头 / 请求体信封 / 错误响应解析
//   - sseParser.ts：SSE 流解析与 delta 累积
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
import {
  ConcurrencyLimiter,
  RetryableAIError,
  retryWithBackoff,
} from './requestRetry'
import {
  buildHeaders,
  buildRequest,
  readErrorResponse,
} from './requestPayload'
import { readSseStream } from './sseParser'
import type {
  ChatRequestOptions,
  ChatStreamRequestOptions,
  ProviderRequestContext,
} from './requestTypes'

export type {
  ChatRequestOptions,
  ChatStreamRequestOptions,
  ProviderRequestContext,
  ReasoningEffort,
  RequestBodyOptions,
} from './requestTypes'

// 传输层执行器：每个 Provider 实例持有一个（并发与重试状态按实例隔离）
export class ProviderRequestRunner {
  private readonly limiter = new ConcurrencyLimiter(5)

  constructor(private readonly ctx: ProviderRequestContext) {}

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
    const headers = buildHeaders(this.ctx, effectiveApiKey)
    const { effectiveModel, requestBody } = buildRequest(this.ctx, messages, options, false)

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
              const { message: errorMessage, retryAfterMs } = await readErrorResponse(res)
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
    const headers = buildHeaders(this.ctx, effectiveApiKey)
    const { effectiveModel, requestBody } = buildRequest(this.ctx, messages, options, true)

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
              const { message: errorMessage } = await readErrorResponse(res)
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

            // 解析 SSE 流（仅首次尝试流式输出 onChunk，重试时静默累积）
            const { fullText, usage } = await readSseStream(
              res.body,
              provider,
              isFirstAttempt ? options.onChunk : undefined,
            )

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
