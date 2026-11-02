// 健康检查端点测试
// 覆盖：存活负载字段、APP_VERSION 注入、就绪探针在数据库可用/不可用时的状态码与负载
import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  buildLiveness,
  buildReadiness,
  getServiceVersion,
  livenessHandler,
  createReadinessHandler,
} from '../health.js'

// 创建仅挂载健康检查路由的测试 app（与生产挂载方式一致）
function createTestApp() {
  const app = express()
  app.get('/api/health', livenessHandler)
  app.get('/api/health/ready', createReadinessHandler())
  return app
}

describe('健康检查', () => {
  const originalVersion = process.env.APP_VERSION

  afterEach(() => {
    if (originalVersion === undefined) delete process.env.APP_VERSION
    else process.env.APP_VERSION = originalVersion
  })

  describe('存活探针 /api/health', () => {
    it('返回 200 与进程元信息，且不依赖数据库', async () => {
      const res = await request(createTestApp()).get('/api/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
      expect(res.body.service).toBe('ydxl-server')
      expect(typeof res.body.version).toBe('string')
      expect(typeof res.body.uptimeSeconds).toBe('number')
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0)
      // 时间戳必须是可解析的 ISO 字符串（监控侧按此对齐采集时间）
      expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false)
    })

    it('version 默认取开发占位值，配置 APP_VERSION 后取构建注入值', () => {
      delete process.env.APP_VERSION
      expect(getServiceVersion()).toBe('0.0.0-dev')

      process.env.APP_VERSION = 'git-abc1234'
      expect(getServiceVersion()).toBe('git-abc1234')
      expect(buildLiveness(0).version).toBe('git-abc1234')
    })

    it('负载时间戳由传入时间派生（便于监控对齐，避免依赖系统时钟抖动）', () => {
      const payload = buildLiveness(Date.UTC(2026, 10, 1, 0, 0, 0))
      expect(payload.timestamp).toBe('2026-11-01T00:00:00.000Z')
    })
  })

  describe('就绪探针 /api/health/ready', () => {
    it('数据库可查询时返回 200 / ready', async () => {
      const res = await request(createTestApp()).get('/api/health/ready')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ready')
      expect(res.body.checks.database).toBe('ok')
    })

    it('数据库不可用时返回 503 / not_ready，且探针本身仍可响应', async () => {
      const app = express()
      app.get(
        '/api/health/ready',
        createReadinessHandler(() => {
          throw new Error('database is closed')
        }),
      )

      const res = await request(app).get('/api/health/ready')

      expect(res.status).toBe(503)
      expect(res.body.status).toBe('not_ready')
      expect(res.body.checks.database).toBe('fail')
    })

    it('buildReadiness 将探活异常收敛为 fail 而不是抛出', () => {
      const payload = buildReadiness(Date.now(), () => {
        throw new Error('boom')
      })
      expect(payload.status).toBe('not_ready')
      expect(payload.checks.database).toBe('fail')
    })
  })
})
