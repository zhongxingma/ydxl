// 传输层用量记录：Token 统计与 AI 来源追踪（best-effort，失败不阻塞主流程）
import { logger } from '../../utils/logger'
import * as tokenStats from './tokenStats'
import { recordAIUsage } from './aiUsageTracker'
import type { ProviderRequestContext } from './requestTypes'

/**
 * 记录响应 usage 字段中的 Token 用量
 * - usage 缺失或非对象时静默跳过（避免无 usage 的响应产生噪声数据）
 * - DeepSeek 官方响应含 prompt_cache_hit_tokens / prompt_cache_miss_tokens
 * - 统计失败仅记录开发日志，不影响主流程
 *
 * @param usage 上游响应中的 usage 字段（unknown，需运行时校验）
 * @param scenario 调用场景标识
 * @param model 实际使用的模型名
 */
export function recordTokenUsageSafe(
  usage: unknown,
  scenario: string | undefined,
  model: string,
): void {
  if (!usage || typeof usage !== 'object') return
  try {
    const u = usage as {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    }
    tokenStats.recordUsage(
      scenario ?? 'unknown',
      model,
      {
        prompt_tokens: u.prompt_tokens ?? 0,
        completion_tokens: u.completion_tokens ?? 0,
        prompt_cache_hit_tokens: u.prompt_cache_hit_tokens,
        prompt_cache_miss_tokens: u.prompt_cache_miss_tokens,
      },
      false,
    )
  } catch (statsErr) {
    if (import.meta.env.DEV)
      logger.warn('[base-provider] token 统计记录失败', statsErr)
  }
}

/**
 * AI 来源追踪：谁真正完成请求就记谁（供前端模块展示「来自哪个 AI 接口」）
 *
 * @param scenario 调用场景标识
 * @param ctx 供应商上下文（提供 provider 名称与展示平台标签）
 * @param model 实际使用的模型名
 * @param success 请求是否成功（失败也记录，便于排查兜底链路）
 */
export function recordUsageSource(
  scenario: string | undefined,
  ctx: ProviderRequestContext,
  model: string,
  success: boolean,
): void {
  recordAIUsage(
    scenario ?? 'unknown',
    ctx.providerName(),
    ctx.usagePlatformLabel(),
    model,
    success,
  )
}
