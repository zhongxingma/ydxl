// REST API 测试共享 Express 应用与数据库清理
import express from 'express'
import { createTableRouter, createWordsBulkRouter, type TableName } from '../routes.js'
import { db } from '../db.js'
import { injectUser, TEST_USER } from './testUsers.js'

// 构建 Express 应用并注册所有 7 张表路由（注入测试用户模拟认证上下文）
// 注意：words 表的批量端点 /api/words/bulk 必须在 /api/words 通用路由之前注册，
// 否则 POST /api/words/bulk 会被 createTableRouter 的 POST /:id 匹配（bulk 作为 :id）
function createApp() {
  const app = express()
  // 与生产配置一致：提高 JSON 解析上限以支持批量端点
  app.use(express.json({ limit: '10mb' }))
  // 共享内容核心写操作（PUT/DELETE articles/questions）需要 content:manage，
  // 通用路由测试注入教师身份以覆盖完整 CRUD；学生权限由 contentAuth.test.ts 专门验证
  app.use(injectUser({ ...TEST_USER, role: 'teacher' }))
  // 批量端点先注册
  app.use('/api/words/bulk', createWordsBulkRouter())
  const tables: TableName[] = [
    'articles',
    'questions',
    'words',
    'reviews',
    'stats',
    'readingSessions',
    'achievements',
  ]
  for (const table of tables) {
    app.use(`/api/${table}`, createTableRouter(table))
  }
  return app
}

export const app = createApp()

// 辅助：清理所有表数据
export function clearAllTables() {
  for (const table of [
    'questions',
    'words',
    'reviews',
    'stats',
    'readingSessions',
    'achievements',
    'articles',
  ] as const) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}
