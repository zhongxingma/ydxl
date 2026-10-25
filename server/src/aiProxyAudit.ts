// AI 代理审计：记录每次调用的 provider / model / 流式标记（不记 prompt 内容）
import type { Request } from 'express'
import { logOperation, AUDIT_ACTIONS } from './audit.js'
import type { AuthUser } from './auth.js'

/** 审计：AI 代理调用（设计文档 4.2——detail 记 provider/model，不记 prompt 内容） */
export function auditAiInvoke(
  req: Request,
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
