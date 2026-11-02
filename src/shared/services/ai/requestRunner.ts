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
import {
  buildHeaders,
  buildRequest,
  readErrorResponse,
} from './requestPayload'
import { executeChatStream } from './streamRunner'
import { recordTokenUsageSafe, recordUsageSource } from './usageRecorder'
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
    logger.debug('[AI Request]', {
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
            logger.debug('[AI Response]', {
              provider,
              model: effectiveModel,
              durationMs,
              usage: usage ?? undefined,
              scenario: options.scenario,
            })
            // Token 用量统计（best-effort，失败不阻塞主流程）
            // 仅在 usage 字段存在时记录，避免无 usage 的响应产生噪声数据
            recordTokenUsageSafe(
              (data as { usage?: unknown })?.usage,
              options.scenario,
              effectiveModel,
            )
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
      recordUsageSource(options.scenario, this.ctx, effectiveModel, true)
      return result
    } catch (err) {
      // 失败也记录（徽章展示失败状态，便于排查自定义 API 是否兜底成功）
      recordUsageSource(options.scenario, this.ctx, effectiveModel, false)
      throw err
    } finally {
      releaseSlot()
    }
  }

  // 流式 Chat 调用：解析 SSE 数据块，累积 delta.content，支持外部中断与进度回调
  //
  // 具体执行逻辑在 streamRunner.ts（传输、SSE 解析、重试、用量记录），
  // 此处仅委托并共享本实例的并发限流器（保证同一 Provider 的并发上限一致）。
  async callChatStream(
    messages: ChatMessage[],
    options: ChatStreamRequestOptions,
  ): Promise<string> {
    return executeChatStream(this.ctx, this.limiter, messages, options)
  }
}
