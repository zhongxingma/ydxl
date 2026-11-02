// Provider 流式传输执行器：SSE 请求 / 重试 / 外部中断 / 用量记录
//
// 从 requestRunner.ts 抽出，ProviderRequestRunner.callChatStream 仅做委托。
// 共享同一并发限流器实例（由调用方注入），保证同一 Provider 的并发上限一致。
import { logger } from '../../utils/logger'
import { AIError, type ChatMessage } from './types'
import {
  isRetryableStatus,
  isNonRetryableClientError,
  getAIErrorMessage,
  AI_STATUS,
} from './errors'
import {
  ConcurrencyLimiter,
  RetryableAIError,
  retryWithBackoff,
} from './requestRetry'
import { buildHeaders, buildRequest, readErrorResponse } from './requestPayload'
import { readSseStream } from './sseParser'
import { recordTokenUsageSafe, recordUsageSource } from './usageRecorder'
import type {
  ChatStreamRequestOptions,
  ProviderRequestContext,
} from './requestTypes'

/**
 * 执行流式 Chat 请求
 *
 * - 端点：代理模式拼接 `${proxyBaseUrl}/v1/ai-proxy/<providerName>/stream`
 * - 请求体：附加 stream: true + stream_options: { include_usage: true }
 * - 响应解析：逐 chunk 解析 SSE `data: {...}` 行，累积 delta.content
 * - 重试：网络错误/超时/5xx/JSON 空内容自动重试 2 次；外部 signal 中断不重试
 * - 重试时静默不调 onChunk，重试成功后一次性发送完整文本
 *
 * @param ctx 供应商上下文
 * @param limiter 并发限流器（与调用方共享）
 * @param messages 对话消息
 * @param options 流式请求选项
 * @returns 完整响应文本
 */
export async function executeChatStream(
  ctx: ProviderRequestContext,
  limiter: ConcurrencyLimiter,
  messages: ChatMessage[],
  options: ChatStreamRequestOptions,
): Promise<string> {
  const provider = ctx.providerName()
  const proxyBaseUrl = ctx.getProxyBaseUrl()
  const effectiveApiKey = await ctx.getEffectiveApiKey()
  if (!effectiveApiKey && !proxyBaseUrl) {
    throw new AIError(`未配置 ${provider} apiKey 且未设置代理地址，无法发起请求`)
  }

  // 流式端点：代理模式拼接 /stream 后缀，直连模式保持原端点（请求体加 stream:true）
  const endpoint = proxyBaseUrl
    ? `${proxyBaseUrl.replace(/\/+$/, '')}/v1/ai-proxy/${provider}/stream`
    : ctx.defaultEndpoint()
  const headers = buildHeaders(ctx, effectiveApiKey)
  const { effectiveModel, requestBody } = buildRequest(ctx, messages, options, true)

  const startMs = performance.now()
  logger.debug('[AI Stream Request]', {
    provider,
    model: effectiveModel,
    maxTokens: options.maxTokens,
    jsonMode: options.jsonMode === true,
    thinkingDisabled: options.thinkingDisabled === true,
    scenario: options.scenario,
    hasSignal: !!options.signal,
  })

  // 客户端并发节流
  const releaseSlot = await limiter.acquire()
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
          ctx.getFetchTimeoutMs(),
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
          logger.debug('[AI Stream Response]', {
            provider,
            model: effectiveModel,
            durationMs,
            textLength: fullText.length,
            scenario: options.scenario,
          })

          // Token 用量统计（best-effort）
          recordTokenUsageSafe(usage, options.scenario, effectiveModel)

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
    recordUsageSource(options.scenario, ctx, effectiveModel, true)
    return result
  } catch (err) {
    // 失败也记录（徽章展示失败状态，便于排查自定义 API 是否兜底成功）
    recordUsageSource(options.scenario, ctx, effectiveModel, false)
    throw err
  } finally {
    releaseSlot()
  }
}
