// AI 代理 SSE 流式转发路由注册
import type { Router } from 'express'
import type { UpstreamConfig } from './aiProxyUpstreams.js'
import { resolveUpstream } from './aiProxyUpstreams.js'
import { fetchWithRetry, resolveRequestBody, validateUpstreamBody } from './aiProxyTransport.js'
import { auditAiInvoke } from './aiProxyAudit.js'

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
export function registerStreamRoute(
  router: Router,
  providerName: string,
  upstream: UpstreamConfig,
): void {
  router.post(`/${providerName}/stream`, async (req, res) => {
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
    const body = resolveRequestBody(req)
    const validationError = validateUpstreamBody(body, allowedModels)
    if (validationError) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: validationError } })
    }

    // 强制启用流式 + 请求 usage 字段（用于 token 统计）
    const streamBody = { ...(body as Record<string, unknown>), stream: true, stream_options: { include_usage: true } }

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
      model: (streamBody as { model?: number | string })?.model,
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
