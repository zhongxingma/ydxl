//
// 测试范围：
// 1. 空表查询 → 返回 { items: [], total: 0, limit: 100, offset: 0 }
// 2. 单条记录查询 → 返回单条 items
// 3. 分页越界 offset > total → 返回空 items 但 total 正确
// 4. limit=0 → 回退默认值 100
// 5. limit=负数 → 回退默认值 100
// 6. offset=负数 → 回退 0
// 7. GET /api/articles/nonexistent-id → 404
// 8. PUT /api/articles/nonexistent-id → 404
// 9. DELETE /api/articles/nonexistent-id → 404
// 10. GET /api/invalid_table → 404（未注册路由，Express 默认 404）
// 11. limit=非数字字符串 → 回退默认值 100
// 12. offset=非数字字符串 → 回退 0
//
// 验证 routes.ts 中 parsePagination 与各路由的边界行为
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTableRouter, type TableName } from '../routes.js'
import { db } from '../db.js'
import { injectUser } from './testUsers.js'

// 构建 Express 应用并注册所有 7 张表路由（与 routes.test.ts 保持一致，注入测试用户）
function createApp() {
  const app = express()
  app.use(express.json())
  app.use(injectUser())
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

const app = createApp()

// 辅助：清理所有表数据
function clearAllTables() {
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

// 辅助：插入单条 article
function insertArticle(id: string, updatedAt: number) {
  db.prepare(
    `INSERT INTO articles (id, title, content, createdAt, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `Article ${id}`, `Content ${id}`, updatedAt, updatedAt)
}

describe('REST API 边界场景', () => {
  beforeEach(() => {
    clearAllTables()
  })

  // 1. 空表查询 → 返回 { items: [], total: 0, limit: 100, offset: 0 }
  it('空表查询 → 返回空 items 与 total=0', async () => {
    const res = await request(app).get('/api/articles')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.limit).toBe(100)
    expect(res.body.offset).toBe(0)
  })

  // 2. 单条记录查询 → 返回单条 items
  it('单条记录查询 → 返回单条 items', async () => {
    insertArticle('art-1', 1000)
    const res = await request(app).get('/api/articles')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe('art-1')
    expect(res.body.total).toBe(1)
  })

  // 3. 分页越界 offset > total → 返回空 items 但 total 正确
  it('分页越界 offset > total → 返回空 items 但 total 正确', async () => {
    insertArticle('art-1', 1000)
    insertArticle('art-2', 2000)
    const res = await request(app).get('/api/articles?limit=10&offset=100')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(2)
    expect(res.body.offset).toBe(100)
  })

  // 4. limit=0 → 回退默认值 100（parsePagination 中 rawLimit > 0 才生效）
  it('limit=0 → 回退默认值 100', async () => {
    insertArticle('art-1', 1000)
    const res = await request(app).get('/api/articles?limit=0')
    expect(res.status).toBe(200)
    // limit=0 不满足 > 0 条件，回退到 DEFAULT_LIMIT=100
    expect(res.body.limit).toBe(100)
    // 验证仍返回所有数据（未受 limit=0 影响）
    expect(res.body.items).toHaveLength(1)
  })

  // 5. limit=负数 → 回退默认值 100
  it('limit=负数 → 回退默认值 100', async () => {
    insertArticle('art-1', 1000)
    const res = await request(app).get('/api/articles?limit=-5')
    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(100)
    expect(res.body.items).toHaveLength(1)
  })

  // 6. offset=负数 → 回退 0
  it('offset=负数 → 回退 0', async () => {
    insertArticle('art-1', 1000)
    const res = await request(app).get('/api/articles?offset=-10')
    expect(res.status).toBe(200)
    expect(res.body.offset).toBe(0)
    expect(res.body.items).toHaveLength(1)
  })

  // 7. GET /api/articles/nonexistent-id → 404
  it('GET /api/articles/nonexistent-id → 404', async () => {
    const res = await request(app).get('/api/articles/nonexistent-id')
    expect(res.status).toBe(404)
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  // 8. PUT /api/articles/nonexistent-id → 404
  it('PUT /api/articles/nonexistent-id → 404', async () => {
    const res = await request(app)
      .put('/api/articles/nonexistent-id')
      .send({ title: 'Updated' })
    expect(res.status).toBe(404)
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  // 9. DELETE /api/articles/nonexistent-id → 404
  it('DELETE /api/articles/nonexistent-id → 404', async () => {
    const res = await request(app).delete('/api/articles/nonexistent-id')
    expect(res.status).toBe(404)
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  // 10. GET /api/invalid_table → 404（未注册路由）
  it('GET /api/invalid_table → 404（表名白名单校验）', async () => {
    const res = await request(app).get('/api/invalid_table')
    expect(res.status).toBe(404)
  })

  // 11. limit=非数字字符串 → 回退默认值 100
  it('limit=非数字字符串 → 回退默认值 100', async () => {
    insertArticle('art-1', 1000)
    const res = await request(app).get('/api/articles?limit=abc')
    expect(res.status).toBe(200)
    // Number('abc') = NaN，不满足 Number.isFinite 条件，回退默认值
    expect(res.body.limit).toBe(100)
    expect(res.body.items).toHaveLength(1)
  })

  // 12. offset=非数字字符串 → 回退 0
  it('offset=非数字字符串 → 回退 0', async () => {
    insertArticle('art-1', 1000)
    const res = await request(app).get('/api/articles?offset=xyz')
    expect(res.status).toBe(200)
    expect(res.body.offset).toBe(0)
    expect(res.body.items).toHaveLength(1)
  })
})
