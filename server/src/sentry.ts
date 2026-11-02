// 可选 Sentry 错误上报（opt-in，后端）
//
// - 未配置 SENTRY_DSN 时：不加载 @sentry/node（动态 import 不触发）、不上报、
//   不发任何网络请求，对现有行为零影响
// - 配置 SENTRY_DSN 后：启动时动态加载 SDK 并初始化，captureException 开始上报
// - captureException 在未初始化时为同步 no-op，调用点（进程异常/错误中间件）无需感知配置状态
// - DSN 是公开项目标识（非密钥）
import { logger } from './logger.js'

type SentryModule = typeof import('@sentry/node')

// 已初始化的 SDK 模块引用；null 表示未启用（未配置 DSN 或初始化失败）
let sentry: SentryModule | null = null

/**
 * 初始化 Sentry（启动时调用一次）
 * 未配置 SENTRY_DSN 时直接返回，不加载 SDK
 */
export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN
  // 未配置 DSN：不触发动态 import，零副作用
  if (!dsn || sentry) return
  try {
    const mod = await import('@sentry/node')
    mod.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    })
    sentry = mod
  } catch (err) {
    // SDK 加载/初始化失败不影响业务：保持不上报，仅记录警告
    logger.warn('[sentry] 初始化失败，错误上报未启用', err)
  }
}

/**
 * 上报错误到 Sentry；未初始化（未配置 DSN）时为 no-op，同步返回不抛错
 */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (!sentry) return
  sentry.captureException(error, extra ? { extra } : undefined)
}
