// 健康检查端点
//
// 两个探针语义分离（容器编排与蓝绿发布依赖该语义）：
// - GET /api/health       存活（liveness）：进程能响应即可，不依赖数据库；
//                         容器重启策略只看它，避免数据库短暂不可用被误判为进程死亡。
// - GET /api/health/ready 就绪（readiness）：数据库可执行查询才返回 200，
//                         否则 503，用于容器 HEALTHCHECK 与蓝绿发布「切流前门禁」。
// 两个端点均免登录、免限流（见 index.ts 的 skip 配置），否则探针会被限流计数打满。
import { logger } from './logger.js'
import type { Request, Response } from 'express'
import { db } from './db.js'

// 服务标识（容器编排与监控侧可按此聚合）
const SERVICE_NAME = 'ydxl-server'

/**
 * 服务版本号：构建镜像时通过 APP_VERSION 注入（如 git commit），
 * 未注入时返回开发占位值，避免健康负载中出现 undefined
 */
export function getServiceVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : '0.0.0-dev'
}

/**
 * 数据库探活函数类型（默认实现查询 SELECT 1；测试可注入抛错实现模拟故障）
 */
export type DatabasePing = () => unknown

const defaultDatabasePing: DatabasePing = () => db.prepare('SELECT 1 AS ok').get()

/**
 * 存活负载：进程元信息 + 时间戳
 * @param now 当前时间（毫秒，便于测试注入）
 */
export function buildLiveness(now: number = Date.now()) {
  return {
    status: 'ok' as const,
    service: SERVICE_NAME,
    version: getServiceVersion(),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date(now).toISOString(),
  }
}

/**
 * 就绪负载：在存活信息基础上附加数据库检查结果
 * @param now 当前时间（毫秒）
 * @param ping 数据库探活函数（默认 SELECT 1）
 */
export function buildReadiness(
  now: number = Date.now(),
  ping: DatabasePing = defaultDatabasePing,
) {
  const databaseOk = pingDatabase(ping)
  return {
    status: databaseOk ? ('ready' as const) : ('not_ready' as const),
    service: SERVICE_NAME,
    version: getServiceVersion(),
    checks: { database: databaseOk ? ('ok' as const) : ('fail' as const) },
    timestamp: new Date(now).toISOString(),
  }
}

/**
 * 执行数据库探活，异常时返回 false（不向调用方抛出，保证探针本身始终可响应）
 */
function pingDatabase(ping: DatabasePing): boolean {
  try {
    ping()
    return true
  } catch (err) {
    logger.error(
      '[ydxl-server] 就绪检查失败：数据库不可用',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

/**
 * 存活探针处理器
 */
export function livenessHandler(_req: Request, res: Response): void {
  res.json(buildLiveness())
}

/**
 * 就绪探针处理器工厂（ping 可注入，默认查数据库）
 * @param ping 数据库探活函数
 */
export function createReadinessHandler(ping: DatabasePing = defaultDatabasePing) {
  return (_req: Request, res: Response): void => {
    const payload = buildReadiness(Date.now(), ping)
    res.status(payload.status === 'ready' ? 200 : 503).json(payload)
  }
}
