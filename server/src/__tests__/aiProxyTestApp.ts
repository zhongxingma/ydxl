// AI 代理路由测试共享 Express 应用构造
import express from 'express'
import { aiProxyRouter } from '../ai-proxy.js'

// 构建测试用 Express 应用，挂载 aiProxyRouter
export function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/ai-proxy', aiProxyRouter)
  return app
}
