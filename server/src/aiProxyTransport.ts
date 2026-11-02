// AI 代理传输：带超时/重试的上游 fetch、非流式代理转发与请求体校验
import { logger } from './logger.js'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { extractUsageFromJson, recordAiUsage } from './aiUsage.js'

// fetch 返回的 DOM Response（避免与 express 的 Response 类型同名冲突）
export type FetchResponse = Awaited<ReturnType<typeof fetch>>

// 上游请求超时（150s）：
// - 长响应场景（语法填空 5 题深度解析 maxTokens 4096、文章生成 3072）在第三方平台
//   （如 SiliconFlow）上生成 3000+ token 可能需要 75-150s；旧值 45s 导致这类请求
//   稳定超时返回 504（2026-08-29 修复语法填空生成失败的真实根因）
// - 前端超时为 170s，比服务端长，确保前端仍能收到错误响应
const UPSTREAM_TIMEOUT_MS = 150_000
// 网络错误与 5xx 指数退避重试（1s/2s，最多 2 次）
const MAX_RETRIES = 2

// 输入上限：防止单次请求携带超大 messages 放大上游计费与内存占用
// 正常文章生成 prompt 约 5k 字符、消息 ≤ 5 条；阈值留足余量
const MAX_MESSAGES = 50
const MAX_TOTAL_CONTENT_CHARS = 100_000

/**
 * 带超时与重试的 fetch：每次请求 150s 超时，网络错误（非 AbortError）与 5xx/429 指数退避重试（1s/2s，最多 2 次）。
 * AbortError（超时或客户端中断）不重试，直接抛出。
 *
 * - 调用方通过 `options.signal` 传入的 signal（如 SSE 路由监听 `res.on('close')` 触发的 AbortController）
 *   必须能够中断上游 fetch，否则客户端断连后上游 AI 请求继续运行浪费 token 与服务器资源。
 * - 本函数每次重试创建本地 `controller`（150s 超时），将调用方 signal 的 abort 事件转发到本地 controller，
 *   从而任一触发（超时或客户端中断）都会中断上游 fetch。
 * - 使用 `addEventListener` 转发而非 `AbortSignal.any()`：项目要求 Node.js ≥18，而 `AbortSignal.any`
 *   在 Node.js 20.3+ 才稳定，addEventListener 转发在 Node 18 上同样可用且无依赖。
 * - 转发监听器为 `once` 且不在 finally 中移除：fetch 返回 Response 后路由仍会持续读取 body 流，
 *   客户端在流式传输期间断连需要继续转发 abort；caller signal 由路由按请求创建（生命周期短），不会泄漏。
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = MAX_RETRIES,
): Promise<FetchResponse> {
  let lastError: unknown = new Error('No attempt completed')
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

    // 合并调用方 signal（如客户端中断）与本地超时 signal：任一触发都应中断上游 fetch
    const callerSignal = options.signal
    const onCallerAbort = (): void => controller.abort()
    if (callerSignal) {
      if (callerSignal.aborted) {
        // 调用方 signal 已中断：立即触发本地 controller
        controller.abort()
      } else {
        // 监听器为 once，触发后自动移除。此处不在 finally 中 removeEventListener：
        // fetch 返回 Response 后路由仍会持续读取 body 流，客户端在此期间断连需要
        // caller signal 的 abort 继续转发到本地 controller.signal（传给 fetch 的 signal），
        // 才能取消上游响应体读取。caller signal 由路由按请求创建（生命周期短），
        // 不会造成长期泄漏。
        callerSignal.addEventListener('abort', onCallerAbort, { once: true })
      }
    }

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        // 优先使用 Retry-After 头作为退避时间（秒），否则指数退避
        const retryAfterSec = parseInt(
          response.headers.get('Retry-After') ?? '',
          10
        )
        const delayMs = Number.isNaN(retryAfterSec)
          ? 1000 * Math.pow(2, attempt)
          : Math.min(retryAfterSec * 1000, 30_000) // 上限 30s，避免过长等待
        await new Promise((r) => setTimeout(r, delayMs))
        continue
      }
      return response
    } catch (err) {
      // AbortError（超时或客户端中断）不重试，直接抛出交由上层处理：
      // - 非流式路由（proxyToUpstream）：上层捕获后返回 504 + TIMEOUT（非流式路由不传 caller signal，仅超时会触发）
      // - SSE 流式路由：上层捕获后正常 res.end()（客户端中断与超时均按正常结束处理）
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }
      lastError = err
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
  throw lastError
}

/**
 * 通用上游代理：转发请求到指定上游端点，透传响应
 *
 * - 所有代理响应统一设置 `Cache-Control: no-cache, no-store, must-revalidate`，
 *   防止浏览器/CDN 对 AI 响应做 HTTP 缓存。
 * - 前端显式缓存由 responseCache（内存 LRU + localStorage）按 scenario + TTL 管理，
 *   与 HTTP 缓存层职责分离，避免双层缓存导致不一致。
 * - 429 响应同样禁用缓存，避免重试逻辑读取到过期的限流响应。
 *
 * @param upstreamUrl 上游端点 URL
 * @param authKey 上游鉴权密钥（作为 Authorization: Bearer）
 * @param body 请求体（已解析的对象）
 * @param res Express Response 对象
 * @param usageMeta 用量记录上下文（用户维度预算统计；未提供时不记录）
 */
export async function proxyToUpstream(
  upstreamUrl: string,
  authKey: string,
  body: unknown,
  res: ExpressResponse,
  usageMeta?: { userId: string; username: string | null; provider: string; ip?: string | null },
): Promise<void> {
  const startMs = performance.now()
  logger.debug('[AI Proxy]', {
    upstream: upstreamUrl,
    model: (body as { model?: string })?.model,
    maxTokens: (body as { max_tokens?: number })?.max_tokens,
  })

  // 统一设置禁用 HTTP 缓存头：所有 AI 代理响应不应被浏览器/CDN 缓存
  // 前端缓存由 responseCache 显式管理（按 scenario + TTL），与 HTTP 缓存层解耦
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')

  try {
    const upstream = await fetchWithRetry(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authKey}`,
      },
      body: JSON.stringify(body),
    })

    const durationMs = Math.round(performance.now() - startMs)
    logger.debug('[AI Proxy Response]', {
      status: upstream.status,
      durationMs,
    })

    // 上游 5xx（重试耗尽）→ 502 + UPSTREAM_ERROR
    if (upstream.status >= 500) {
      res.status(502).json({
        error: { code: 'UPSTREAM_ERROR', message: `Upstream returned ${upstream.status}` },
      })
      return
    }

    // 429 透传：保留状态码与 Retry-After 头，让前端可据 retry_after 重试
    if (upstream.status === 429) {
      const text = await upstream.text()
      const contentType = upstream.headers.get('content-type') ?? 'application/json'
      const retryAfter = upstream.headers.get('Retry-After')
      if (retryAfter) {
        res.set('Retry-After', retryAfter)
      }
      res.status(429).set('Content-Type', contentType).send(text)
      return
    }

    // 注：DeepSeek 非流式请求可能持续返回 keep-alive 空行，不影响 JSON body 解析
    // （官方文档：https://api-docs.deepseek.com/zh-cn/guides/keep_alive）
    // 使用 text() 读取整体响应后原样转发，空行被保留但不影响客户端 JSON.parse
    // 2xx / 其他 4xx → 原样转发
    const text = await upstream.text()
    const contentType = upstream.headers.get('content-type') ?? 'application/json'
    res.status(upstream.status).set('Content-Type', contentType).send(text)
    // 用量记录：仅成功响应且上游返回 usage 时写入（预算统计与成本面板的数据源）
    if (usageMeta && upstream.ok) {
      const usage = extractUsageFromJson(text)
      if (usage) {
        recordAiUsage(
          {
            userId: usageMeta.userId,
            username: usageMeta.username,
            provider: usageMeta.provider,
            model: String((body as { model?: unknown })?.model ?? 'unknown'),
            stream: false,
            durationMs,
          },
          usage,
          usageMeta.ip,
        )
      }
    }
    return
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      res
        .status(504)
        .json({ error: { code: 'TIMEOUT', message: 'Upstream request timed out' } })
      return
    }
    const message = err instanceof Error ? err.message : 'Upstream request failed'
    res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message } })
    return
  }
}

/**
 * 校验上游请求体，防止恶意构造 body 转发给上游（如超大 max_tokens 触发计费、非法 model）
 * @param allowedModels 当前供应商的模型白名单
 * @returns 错误消息（null 表示校验通过）
 */
export function validateUpstreamBody(body: unknown, allowedModels: string[]): string | null {
  if (!body || typeof body !== 'object') return 'Missing body'
  const b = body as Record<string, unknown>
  // model 白名单（仅允许当前供应商配置的模型；白名单为空时放行，
  // 适用于 custom 未配置 CUSTOM_MODELS 的场景——模型 ID 由部署者/用户约定，由上游计费管控）
  if (
    allowedModels.length > 0 &&
    typeof b.model === 'string' &&
    !allowedModels.includes(b.model)
  ) {
    return `Unsupported model: ${b.model}`
  }
  // max_tokens 上限 4096（项目最大场景 generateArticle=3072，留余量）
  if (typeof b.max_tokens === 'number' && b.max_tokens > 4096) {
    return 'max_tokens exceeds limit 4096'
  }
  // messages 必须是非空数组
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return 'messages must be a non-empty array'
  }
  if (b.messages.length > MAX_MESSAGES) {
    return `messages exceeds limit ${MAX_MESSAGES}`
  }
  // 总内容长度上限（content 可能是字符串或多模态数组，统一按 JSON 长度估算）
  let totalChars = 0
  for (const message of b.messages) {
    if (!message || typeof message !== 'object') return 'Invalid message'
    const content = (message as Record<string, unknown>).content
    totalChars += JSON.stringify(content ?? '').length
    if (totalChars > MAX_TOTAL_CONTENT_CHARS) {
      return `messages content exceeds limit ${MAX_TOTAL_CONTENT_CHARS} chars`
    }
  }
  return null
}

// 非流式路由解析请求体（兼容 { provider, body } 包装体与裸 body 两种形式）
export function resolveRequestBody(req: ExpressRequest): unknown {
  return (req.body as { body?: unknown })?.body ?? req.body
}
