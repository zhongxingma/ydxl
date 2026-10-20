// AI 代理路由：迁移自 api/ai-proxy.ts，支持多上游供应商（OpenAI 兼容协议）
// 当前支持：deepseek / openai / qwen / custom（均为 OpenAI Chat Completions 兼容协议）
// 无鉴权（不校验 x-user-token），仅校验服务端对应上游 API_KEY 环境变量是否配置
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { getProviderMeta, loadAiProvidersConfig } from './aiConfig.js'
import { logOperation, AUDIT_ACTIONS } from './audit.js'
import type { AuthUser } from './auth.js'

// AI 代理配额（多用户 P3）：按「用户」维度限流，而非按 IP
// - 主维度为 req.user.id（认证门之后 req.user 必存在，见 index.ts 的 /api 守卫）
// - 配额 20 次/分钟/用户：防止单个账号刷爆服务端 DeepSeek/Qwen 上游计费
// - 为什么不再按 IP：班级机房 / 宿舍 NAT 等共享出口场景下，按 IP 会让
//   「一个用户刷满 20 次」耗尽整个出口额度、误伤同网段其他正常学员
// - 兜底：req.user 缺失时（理论上不会，认证门已拦截未登录）回退到 IP，
//   确保限流键非空、不会因 key 相同而把不同匿名请求归并到同一桶
// - 工厂 + 默认实例：max / skip 可注入，便于测试自建小配额实例并跳过限流，
//   避免有状态桶跨用例累积污染 aiProxy 契约测试
export interface AiProxyLimiterOptions {
  // 单窗口最大请求数（默认 20）
  max?: number
  // 跳过判定（默认 NODE_ENV=test 时跳过，生产恒不跳过）
  skip?: (req: import('express').Request) => boolean
}

export function createAiProxyLimiter(options: AiProxyLimiterOptions = {}) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: options.max ?? 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: options.skip ?? (() => process.env.NODE_ENV === 'test'),
    keyGenerator: (req) => {
      const user = (req as unknown as { user?: AuthUser }).user
      return user?.id ?? req.ip ?? 'anonymous'
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many AI requests, please slow down',
        },
      })
    },
  })
}

// 生产挂载用的默认实例（20/min/user）
export const aiProxyLimiter = createAiProxyLimiter()

/** 审计：AI 代理调用（设计文档 4.2——detail 记 provider/model，不记 prompt 内容） */
function auditAiInvoke(
  req: import('express').Request,
  providerName: string,
  body: unknown,
  stream: boolean,
): void {
  const user = (req as { user?: AuthUser }).user
  logOperation({
    userId: user?.id ?? null,
    username: user?.username ?? null,
    action: AUDIT_ACTIONS.aiProxyInvoke,
    resource: 'ai-proxy',
    resourceId: providerName,
    detail: {
      provider: providerName,
      model: (body as { model?: unknown })?.model ?? null,
      stream,
    },
    ip: req.ip,
  })
}

/**
 * 上游供应商注册表：新增供应商只需在此追加条目，
 * 路由（/v1/ai-proxy/<name> 与 /v1/ai-proxy/<name>/stream）自动注册。
 */
interface UpstreamConfig {
  // 上游端点 URL（固定端点供应商）
  endpoint: string
  // 上游端点的环境变量名（可选，custom 部署级配置）
  // 存在时每次请求运行时读取并规范化（Base URL 自动拼接 /chat/completions），
  // 未配置时该路由返回 503 CUSTOM_NOT_CONFIGURED
  endpointEnv?: string
  // 上游鉴权密钥的环境变量名
  envKeyName: string
  // 模型白名单（防止恶意构造 body 触发计费）
  allowedModels: string[]
  // 模型白名单的环境变量名（可选，custom 部署级配置，逗号分隔）
  // 存在时运行时读取；未配置时白名单为空 = 放行任意 model（由上游 API Key 计费管控）
  allowedModelsEnv?: string
}

// 内置供应商上游配置从 config/ai-providers.json 单一注册表派生（见 aiConfig.ts），
// 消除端点/白名单/密钥变量名的硬编码冗余；JSON 缺失或字段缺失时 getProviderMeta
// 回退内置默认值（等价于历史硬编码），保证向后兼容。新增/调整供应商只需改 JSON 一处。
const UPSTREAMS: Record<string, UpstreamConfig> = {
  deepseek: {
    endpoint: getProviderMeta('deepseek').endpoint!,
    envKeyName: getProviderMeta('deepseek').keyEnv!,
    allowedModels: getProviderMeta('deepseek').allowedModels!,
  },
  openai: {
    endpoint: getProviderMeta('openai').endpoint!,
    envKeyName: getProviderMeta('openai').keyEnv!,
    allowedModels: getProviderMeta('openai').allowedModels!,
  },
  qwen: {
    endpoint: getProviderMeta('qwen').endpoint!,
    envKeyName: getProviderMeta('qwen').keyEnv!,
    allowedModels: getProviderMeta('qwen').allowedModels!,
  },
  // 自定义模型上游（生产代理模式节点）：端点 / 模型 / 密钥变量名在 config/ai-providers.json
  // 的 custom 字段声明，server/src/index.ts 启动时派生 CUSTOM_API_ENDPOINT / CUSTOM_MODELS；
  // 密钥值写在 .env 的 CUSTOM_API_KEY（JSON 只存变量名 keyEnv，不存密钥值）
  // SSRF 防护：endpoint 只信服务端 env 固定值，前端请求体不透传任何 URL，
  // 用户在个人中心自填的端点不经此路由（由前端浏览器直连）
  custom: {
    endpoint: '',
    endpointEnv: 'CUSTOM_API_ENDPOINT',
    envKeyName: loadAiProvidersConfig().custom?.keyEnv ?? 'CUSTOM_API_KEY',
    allowedModels: [],
    allowedModelsEnv: 'CUSTOM_MODELS',
  },
}

/**
 * 规范化上游端点为完整的 chat/completions URL
 * - 已含 /chat/completions：原样返回（去除尾部斜杠）
 * - 否则视为 Base URL：拼接 /chat/completions
 * - 空值返回空串（路由层据此返回 503）
 */
function normalizeUpstreamEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed
  }
  return `${trimmed}/chat/completions`
}

/**
 * 解析上游运行时配置（固定值或 env 动态读取）
 * custom 的端点/白名单在每次请求时点读取（测试与运维改 env 后无需重启即可生效）
 */
function resolveUpstream(upstream: UpstreamConfig): {
  endpoint: string
  allowedModels: string[]
} {
  const endpoint = upstream.endpointEnv
    ? normalizeUpstreamEndpoint(process.env[upstream.endpointEnv] ?? '')
    : upstream.endpoint
  const allowedModels = upstream.allowedModelsEnv
    ? (process.env[upstream.allowedModelsEnv] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : upstream.allowedModels
  return { endpoint, allowedModels }
}

// 上游请求超时（150s）：
// - 长响应场景（语法填空 5 题深度解析 maxTokens 4096、文章生成 3072）在第三方平台
//   （如 SiliconFlow）上生成 3000+ token 可能需要 75-150s；旧值 45s 导致这类请求
//   稳定超时返回 504（2026-08-29 修复语法填空生成失败的真实根因）
// - 前端超时为 170s，比服务端长，确保前端仍能收到错误响应
const UPSTREAM_TIMEOUT_MS = 150_000
// 网络错误与 5xx 指数退避重试（1s/2s，最多 2 次）
const MAX_RETRIES = 2

export const aiProxyRouter = Router()

/**
 * 带超时与重试的 fetch：每次请求 45s 超时，网络错误（非 AbortError）与 5xx/429 指数退避重试（1s/2s，最多 2 次）。
 * AbortError（超时或客户端中断）不重试，直接抛出。
 *
 * 信号合并（SubTask 5.1）：
 * - 调用方通过 `options.signal` 传入的 signal（如 SSE 路由监听 `res.on('close')` 触发的 AbortController）
 *   必须能够中断上游 fetch，否则客户端断连后上游 AI 请求继续运行浪费 token 与服务器资源。
 * - 本函数每次重试创建本地 `controller`（45s 超时），将调用方 signal 的 abort 事件转发到本地 controller，
 *   从而任一触发（超时或客户端中断）都会中断上游 fetch。
 * - 使用 `addEventListener` 转发而非 `AbortSignal.any()`：项目要求 Node.js ≥18，而 `AbortSignal.any`
 *   在 Node.js 20.3+ 才稳定，addEventListener 转发在 Node 18 上同样可用且无依赖。
 * - 转发监听器为 `once` 且不在 finally 中移除：fetch 返回 Response 后路由仍会持续读取 body 流，
 *   客户端在流式传输期间断连需要继续转发 abort；caller signal 由路由按请求创建（生命周期短），不会泄漏。
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = MAX_RETRIES,
): Promise<Response> {
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
 * 缓存策略（Task 4.3）：
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
 */
async function proxyToUpstream(
  upstreamUrl: string,
  authKey: string,
  body: unknown,
  res: import('express').Response,
): Promise<void> {
  const startMs = performance.now()
  console.debug('[AI Proxy]', {
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
    console.debug('[AI Proxy Response]', {
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
function validateUpstreamBody(body: unknown, allowedModels: string[]): string | null {
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
  return null
}

/**
 * SSE 流式转发路由注册：将上游流式响应逐 chunk 透传到前端
 *
 * Phase 3 优化（2026-07-27）：
 * - 用于长响应场景（article/questions，15-30s）的流式输出，提升用户感知速度
 * - 监听客户端 res.on('close') 中断上游请求，节省 token 与服务器资源
 * - 设置 X-Accel-Buffering: no 头，避免 nginx 缓冲 SSE 流
 * - stream_options.include_usage: true 让上游在流末尾返回 usage 字段用于 token 统计
 *
 * 错误处理：
 * - 503：对应供应商 API_KEY 未配置
 * - 400：请求体无效
 * - SSE error 事件：上游非 2xx 响应或流读取异常
 * - 客户端中断（AbortError）：正常结束响应，不报错
 *
 * 文档参考：
 * - OpenAI 兼容流式输出（DeepSeek/Qwen 同协议）
 * - SSE 协议：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
 */
function registerStreamRoute(providerName: string, upstream: UpstreamConfig): void {
  aiProxyRouter.post(`/${providerName}/stream`, async (req, res) => {
    // 解析运行时上游（custom 端点/白名单从 env 动态读取）
    const { endpoint, allowedModels } = resolveUpstream(upstream)
    // custom 未配置 CUSTOM_API_ENDPOINT → 503（前端将自动回退 DeepSeek 兜底）
    if (!endpoint) {
      return res.status(503).json({
        error: {
          code: 'CUSTOM_NOT_CONFIGURED',
          message: `${upstream.endpointEnv} not configured`,
        },
      })
    }
    const authKey = process.env[upstream.envKeyName]
    if (!authKey) {
      return res.status(503).json({
        error: {
          code: 'PROXY_NOT_CONFIGURED',
          message: `${upstream.envKeyName} not configured`,
        },
      })
    }

    // 兼容 { provider, body } 包装体与裸 body 两种形式 + body schema 校验
    const body = req.body?.body ?? req.body
    const validationError = validateUpstreamBody(body, allowedModels)
    if (validationError) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: validationError } })
    }

    // 强制启用流式 + 请求 usage 字段（用于 token 统计）
    const streamBody = { ...body, stream: true, stream_options: { include_usage: true } }

    // 审计：AI 代理调用留痕（P2）
    auditAiInvoke(req, providerName, streamBody, true)

    // SSE 响应头
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      // nginx 禁用缓冲，确保 chunk 及时透传到客户端
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    // 客户端中断时取消上游请求
    // 使用 res.on('close') 而非 req.on('close')：
    // Node.js 16+ 中 req 的 'close' 事件在请求体接收完成时即触发（早于响应发送），
    // 会导致 controller.abort() 在上游 fetch 发起前就被调用，破坏所有流式请求。
    // res 的 'close' 事件在连接关闭时触发：正常结束（writableEnded=true）或客户端断连
    // （writableEnded=false）。配合 !res.writableEnded 判断，仅在客户端断连时 abort。
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort()
      }
    })

    const startMs = performance.now()
    console.debug('[AI Proxy Stream]', {
      provider: providerName,
      upstream: endpoint,
      model: (streamBody as { model?: string })?.model,
      maxTokens: (streamBody as { max_tokens?: number })?.max_tokens,
    })

    try {
      const response = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authKey}`,
        },
        body: JSON.stringify(streamBody),
        signal: controller.signal,
      })

      const durationMs = Math.round(performance.now() - startMs)
      console.debug('[AI Proxy Stream Response]', {
        status: response.status,
        durationMs,
      })

      // 上游错误响应：通过 SSE error 事件发送，前端可据 status 区分处理
      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '')
        // 429 透传 Retry-After 头
        const retryAfter = response.headers.get('Retry-After')
        const errorPayload: Record<string, unknown> = {
          status: response.status,
          message: errText,
        }
        if (retryAfter) {
          errorPayload.retryAfter = retryAfter
        }
        res.write(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`)
        res.end()
        return
      }

      // 透传上游 SSE 流到客户端（逐 chunk 转发，不缓冲完整响应）
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      try {
        // eslint-disable-next-line no-constant-condition -- 流式读取标准模式，退出条件为 reader.read() 返回 done
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(decoder.decode(value, { stream: true }))
        }
      } finally {
        reader.releaseLock()
      }
      res.end()
      return
    } catch (err: unknown) {
      // 客户端中断：正常结束响应，不报错
      if (err instanceof Error && err.name === 'AbortError') {
        if (!res.writableEnded) {
          res.end()
        }
        return
      }
      // 其他异常：通过 SSE error 事件发送
      const message = err instanceof Error ? err.message : 'Stream failed'
      console.error('[AI Proxy Stream] error:', message)
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
        res.end()
      }
      return
    }
  })
}

// 按注册表为每个供应商自动注册路由（/deepseek、/openai、/qwen、/custom 及对应 /stream 流式路由）
for (const [providerName, upstream] of Object.entries(UPSTREAMS)) {
  aiProxyRouter.post(`/${providerName}`, async (req, res) => {
    // 解析运行时上游（custom 端点/白名单从 env 动态读取）
    const { endpoint, allowedModels } = resolveUpstream(upstream)
    // custom 未配置 CUSTOM_API_ENDPOINT → 503（前端将自动回退 DeepSeek 兜底）
    if (!endpoint) {
      return res.status(503).json({
        error: {
          code: 'CUSTOM_NOT_CONFIGURED',
          message: `${upstream.endpointEnv} not configured`,
        },
      })
    }
    const authKey = process.env[upstream.envKeyName]
    if (!authKey) {
      return res.status(503).json({
        error: {
          code: 'PROXY_NOT_CONFIGURED',
          message: `${upstream.envKeyName} not configured`,
        },
      })
    }

    // 兼容 { provider, body } 包装体与裸 body 两种形式 + body schema 校验
    const body = req.body?.body ?? req.body
    const validationError = validateUpstreamBody(body, allowedModels)
    if (validationError) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: validationError } })
    }

    // 审计：AI 代理调用留痕（P2）
    auditAiInvoke(req, providerName, body, false)

    return proxyToUpstream(endpoint, authKey, body, res)
  })

  registerStreamRoute(providerName, upstream)
}
