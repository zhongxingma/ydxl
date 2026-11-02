// Express 应用入口
// 加载项目根目录的 .env 文件（server 运行在 server/src/ 或 server/dist/，向上两级到项目根目录）
// 生产部署时若 .env 不存在，dotenv 静默跳过，环境变量由系统注入
import { logger } from './logger.js'
import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAiProvidersConfig } from './aiConfig.js'
import { initSentry, captureException } from './sentry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 加载项目根目录 .env（server/dist/ 或 server/src/ 向上两级）
const envPath = resolve(__dirname, '../../.env')
const dotenvResult = dotenv.config({ path: envPath })

// ===== AI 供应商统一配置源 =====
// 端点 / 模型 / 密钥变量名统一在 config/ai-providers.json 声明（单一注册表），前端构建注入
// 与服务端运行时默认值均派生自该文件，消除多处手写导致的不一致（加载器见 server/src/aiConfig.ts，
// ai-proxy.ts 的 UPSTREAMS 注册表同样从该 JSON 派生）。
// 此处仅作兜底：.env / 系统环境变量显式设置的 CUSTOM_* 优先；未设置时从 JSON 派生。
// 注意：密钥在 JSON 中只存「变量名」（keyEnv），实际值写服务端 .env，绝不进前端 bundle。
{
  const aiConfig = loadAiProvidersConfig()
  if (aiConfig.custom?.endpoint) process.env.CUSTOM_API_ENDPOINT ??= aiConfig.custom.endpoint
  if (aiConfig.custom?.model) process.env.CUSTOM_MODELS ??= aiConfig.custom.model
}

// 启动自检：打印 .env 实际加载路径，便于排查「改了 .env 不生效」类问题
// （服务实际读取的是 <部署根目录>/.env，而非 server/.env）
if (dotenvResult.error) {
  logger.warn(`[ydxl-server] 未找到 .env（${envPath}），使用系统环境变量`)
} else {
  logger.info(`[ydxl-server] 已加载 .env：${envPath}`)
}

// 可选 Sentry 错误上报：配置了 SENTRY_DSN 才加载 SDK，否则直接返回（零副作用）。
// 必须在 dotenv 加载之后调用，保证 .env 中的 SENTRY_DSN 可见
void initSentry()

/**
 * 进程健壮性：全局未捕获异常处理
 * 避免单个异步链路的未处理拒绝导致进程崩溃或进入不可知状态
 */
process.on('uncaughtException', (err) => {
  // 可选 Sentry 上报：未配置 SENTRY_DSN 时为 no-op（见 sentry.ts）
  captureException(err)
  logger.error('[ydxl-server] FATAL: 未捕获的同步异常 (uncaughtException)', {
    message: err.message,
    stack: err.stack,
  })
  // 同步异常通常意味着进程状态已损坏，建议记录后重启
  // 在生产环境建议配合 PM2 等进程管理器自动重启
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  // 可选 Sentry 上报：未配置 SENTRY_DSN 时为 no-op（见 sentry.ts）
  captureException(reason)
  logger.error('[ydxl-server] WARN: 未处理的 Promise 拒绝 (unhandledRejection)', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  // Promise 拒绝通常是局部链路失败，不强制退出，但必须记录
})

// dotenv 不会覆盖进程环境中已存在的变量：若 PM2/系统环境中已注入 PORT，
// .env 中的 PORT 修改将被静默忽略，此处显式警告并给出修复命令

// dotenv 不会覆盖进程环境中已存在的变量：若 PM2/系统环境中已注入 PORT，
// .env 中的 PORT 修改将被静默忽略，此处显式警告并给出修复命令
if (
  dotenvResult.parsed?.PORT &&
  process.env.PORT !== dotenvResult.parsed.PORT
) {
  logger.warn(
    `[ydxl-server] 端口配置冲突：进程环境 PORT=${process.env.PORT ?? '未设置'} ` +
      `优先于 .env 中 PORT=${dotenvResult.parsed.PORT}（dotenv 不覆盖已有环境变量）。` +
      `如使用 pm2，请执行：pm2 restart <name> --update-env`,
  )
}

import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { createTableRouter, createWordsBulkRouter, TABLES } from './routes.js'
import { aiProxyRouter, aiProxyLimiter } from './ai-proxy.js'
import { authMiddleware } from './auth.js'
import { authRouter, loginLimiter } from './authRoutes.js'
import { adminRouter } from './adminRoutes.js'
import { runMultiUserMigration } from './migrateMultiUser.js'
import { runAuditRetention, DEFAULT_ARCHIVE_DIR } from './audit.js'
import { resolveTrustProxy } from './trustProxy.js'
import { livenessHandler, createReadinessHandler } from './health.js'

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

// 反向代理信任：Nginx 后部署需配置 TRUST_PROXY=1，否则 req.ip 恒为反代地址，
// 使按 IP 的限流与审计 IP 失真（解析与生产强校验见 trustProxy.ts）
const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV)
if (trustProxy.error) {
  logger.error(`[ydxl-server] ${trustProxy.error}`)
  process.exit(1)
}
if (trustProxy.warning) {
  logger.warn(`[ydxl-server] ${trustProxy.warning}`)
}
if (trustProxy.setting !== undefined) {
  app.set('trust proxy', trustProxy.setting)
}

// 多用户数据迁移（幂等，启动时执行；测试环境 :memory: 库同样安全执行）
runMultiUserMigration()

// 审计日志保留策略：导出 180 天前日志为 CSV 归档后清理（幂等）
// 失败不阻塞启动（如磁盘只读）：日志仅 console.error，下次启动重试
try {
  const retention = runAuditRetention()
  if (retention.archived > 0) {
    logger.info(
      `[ydxl-server] 审计日志归档：${retention.archived} 条 → ${retention.archiveFile}，已清理 ${retention.deleted} 条`,
    )
  }
} catch (err) {
  logger.error(`[ydxl-server] 审计日志归档失败（不阻塞启动；归档目录 ${DEFAULT_ARCHIVE_DIR}）`, err)
}

// CORS 白名单：
// - 配置 CORS_ORIGIN 时：按逗号分割为白名单数组，仅允许白名单内来源
// - 未配置 CORS_ORIGIN 时：
//   * 生产环境（NODE_ENV=production）：默认仅允许 localhost，避免误开放
//   * 开发环境：允许所有来源，便于 localhost 调试
const corsOrigin = process.env.CORS_ORIGIN
const isProduction = process.env.NODE_ENV === 'production'
const corsOptions = corsOrigin
  ? {
      origin: corsOrigin.split(',').map((s) => s.trim()),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-user-token'],
    }
  : isProduction
    ? {
        // 生产环境安全默认：仅允许本机，部署时必须配置 CORS_ORIGIN 白名单
        origin: ['http://localhost', 'http://127.0.0.1'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'x-user-token'],
      }
    : {}
app.use(cors(corsOptions))

// 文章内容较长，提高 JSON 解析上限
app.use(express.json({ limit: '10mb' }))

// 限流：每 IP 每分钟 60 次（可用 RATE_LIMIT_MAX 覆盖；E2E 真实后端模式会调高），超限返回 429；排除健康检查端点以便监控
const parsedRateLimitMax = Number(process.env.RATE_LIMIT_MAX)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.isFinite(parsedRateLimitMax) && parsedRateLimitMax > 0 ? parsedRateLimitMax : 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/health'),
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      },
    })
  },
})
app.use(limiter)

// 认证路由：登录端点独立限流（口令爆破防护）
// /api/auth/login 与 /api/auth/logout 无需会话；/me 与 /change-password 在路由内自挂 authMiddleware
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth', authRouter)

// 认证门：/api 下除 /api/auth/* 与 /api/health*（含 /ready 就绪探针）外的全部端点需要登录
// 挂载顺序必须在业务路由之前；认证成功后 req.user 可用（路由层数据隔离依赖）
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/auth')) return next()
  return authMiddleware(req, res, next)
})

// 用户管理 API：内部经 requirePermission('users:manage') 二次授权（仅 admin）
app.use('/api/admin', adminRouter)

// 7 张表 REST API
// 注意：words 表的批量端点 /api/words/bulk 必须在 /api/words 通用路由之前注册，
// 否则 POST /api/words/bulk 会被 createTableRouter 的 POST /:id 匹配（bulk 作为 :id）
app.use('/api/words/bulk', createWordsBulkRouter())
for (const table of TABLES) {
  app.use(`/api/${table}`, createTableRouter(table))
}

// AI 代理端点（需登录，独立限流防止上游配额滥用）
// 配额 20/min/user 按用户维度（aiProxyLimiter 见 ai-proxy.ts）：
// 共享出口（机房/NAT）下按 IP 会误伤同网段学员，故按 req.user.id 计量
app.use('/api/v1/ai-proxy', aiProxyLimiter, aiProxyRouter)

// 健康检查：/api/health 为存活探针（进程可响应），/api/health/ready 为就绪探针（数据库可用）
// 容器 HEALTHCHECK 与蓝绿发布切流门禁均使用 /ready；两者均免登录、免限流
app.get('/api/health', livenessHandler)
app.get('/api/health/ready', createReadinessHandler())

// 全局错误处理中间件：捕获所有同步/异步路由抛出的异常，统一返回 JSON 错误响应。
// Express 默认会返回 HTML 错误页（500），前置 nginx 可能将其转换为 502 Bad Gateway，
// 在此显式处理以避免该问题并对外暴露结构化错误信息。
// 安全：生产环境不向客户端暴露原始错误消息与堆栈（可能泄露内部实现），仅返回通用提示；
//       开发环境保留原始消息便于调试。服务端日志始终记录完整错误。
// 注意：错误处理中间件必须声明 4 个参数（err, req, res, next），否则不会被 Express 识别。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // 可选 Sentry 上报：未配置 SENTRY_DSN 时为 no-op（见 sentry.ts）
  captureException(err)
  logger.error(`[ydxl-server] 未捕获错误：${err.message}`)
  logger.error(err.stack)
  const isProd = process.env.NODE_ENV === 'production'
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      // 生产环境返回通用提示，避免泄露内部实现细节；开发环境返回原始消息便于调试
      message: isProd ? 'Internal Server Error' : err.message || 'Internal Server Error',
    },
  })
})

app.listen(PORT, () => {
  logger.info(`[ydxl-server] listening on http://localhost:${PORT}`)
})

export { app }
