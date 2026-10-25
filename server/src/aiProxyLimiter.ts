// AI 代理配额限流：按用户维度 20 次/分钟
import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import type { AuthUser } from './auth.js'

// AI 代理配额：按「用户」维度限流，而非按 IP
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
  skip?: (req: Request) => boolean
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
