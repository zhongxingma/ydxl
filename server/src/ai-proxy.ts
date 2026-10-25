// AI 代理路由：支持多上游供应商（OpenAI 兼容协议）
// 当前支持：deepseek / openai / qwen / custom（均为 OpenAI Chat Completions 兼容协议）
//
// 按职责拆分：
//   - aiProxyUpstreams.ts：上游注册表与运行时端点/白名单解析
//   - aiProxyTransport.ts：重试 fetch、非流式转发、请求体校验
//   - aiProxyStream.ts：SSE 流式转发路由
//   - aiProxyAudit.ts：调用审计
//   - aiProxyLimiter.ts：按用户维度限额
import { Router } from 'express'
import { UPSTREAMS, resolveUpstream } from './aiProxyUpstreams.js'
import {
  proxyToUpstream,
  resolveRequestBody,
  validateUpstreamBody,
} from './aiProxyTransport.js'
import { registerStreamRoute } from './aiProxyStream.js'
import { auditAiInvoke } from './aiProxyAudit.js'

export { aiProxyLimiter, createAiProxyLimiter } from './aiProxyLimiter.js'
export type { AiProxyLimiterOptions } from './aiProxyLimiter.js'

export const aiProxyRouter = Router()

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
    const body = resolveRequestBody(req)
    const validationError = validateUpstreamBody(body, allowedModels)
    if (validationError) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: validationError } })
    }

    auditAiInvoke(req, providerName, body, false)

    return proxyToUpstream(endpoint, authKey, body, res)
  })

  registerStreamRoute(aiProxyRouter, providerName, upstream)
}
