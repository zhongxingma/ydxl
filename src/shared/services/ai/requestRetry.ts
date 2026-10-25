// 传输层重试与并发控制
//
// - 指数退避重试：网络错误 / 超时 / 上游 5xx 自动重试，4xx 与解析错误立即抛出
// - 客户端并发限流：默认上限 5，避免突发流量触发 429
import { AIError } from './types'

// 内部错误标记：可重试的 AIError（5xx、网络错误、超时）
export class RetryableAIError extends AIError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'RetryableAIError'
  }
}

// 判断错误是否可重试
// 可重试：网络错误（非 AIError 或包含"网络错误"）、超时（包含"超时"）、上游 5xx
// 不可重试：4xx 客户端错误、响应解析错误、内容缺失错误、外部中断 AbortError
export function isRetryableError(err: unknown): boolean {
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
export async function retryWithBackoff<T>(
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
export class ConcurrencyLimiter {
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
