// 分页端点测试
// 验证 GET /api/:table 的分页参数（limit/offset）与响应格式
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTableRouter, type TableName } from '../routes.js'
import { db } from '../db.js'
import { injectUser } from './testUsers.js'

// 构建 Express 应用并注册 articles 路由（注入测试用户模拟认证上下文）
function createApp() {
  const app = express()
  app.use(express.json())
  app.use(injectUser())
  app.use('/api/articles', createTableRouter('articles' as TableName))
  return app
}

const app = createApp()

// 辅助：清理 articles 表
function clearArticles() {
  db.prepare('DELETE FROM articles').run()
}

// 辅助：批量插入 N 条 article 记录
// updated_at 递增，确保 ORDER BY updated_at DESC 有稳定顺序
function insertArticles(count: number, startIdx = 0) {
  const insert = db.prepare(
    `INSERT INTO articles (id, title, content, createdAt, updated_at) VALUES (?, ?, ?, ?, ?)`
  )
  const insertMany = db.transaction((n: number, base: number) => {
    for (let i = 0; i < n; i++) {
      const idx = base + i
      insert.run(
        `art-${idx}`,
        `Article ${idx}`,
        `Content ${idx}`,
        idx,
        idx + 1 // updated_at 从 base+1 开始，确保为正且递增
      )
    }
  })
  insertMany(count, startIdx)
}

describe('Pagination', () => {
  beforeEach(() => {
    clearArticles()
  })

  describe('Default pagination', () => {
    it('should return 100 items by default when more than 100 exist', async () => {
      insertArticles(150)
      const res = await request(app).get('/api/articles')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(100)
      expect(res.body.total).toBe(150)
      expect(res.body.limit).toBe(100)
      expect(res.body.offset).toBe(0)
    })

    it('should return all items when fewer than 100 exist', async () => {
      insertArticles(50)
      const res = await request(app).get('/api/articles')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(50)
      expect(res.body.total).toBe(50)
      expect(res.body.limit).toBe(100)
      expect(res.body.offset).toBe(0)
    })
  })

  describe('Custom pagination', () => {
    it('should return 10 items when limit=10&offset=0', async () => {
      insertArticles(150)
      const res = await request(app).get('/api/articles?limit=10&offset=0')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(10)
      expect(res.body.total).toBe(150)
      expect(res.body.limit).toBe(10)
      expect(res.body.offset).toBe(0)
    })

    it('should return correct items for second page', async () => {
      insertArticles(25)
      const res = await request(app).get('/api/articles?limit=10&offset=10')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(10)
      expect(res.body.total).toBe(25)
      expect(res.body.offset).toBe(10)
      // 按 updated_at DESC 排序，offset=10 跳过前 10 条
      // 插入 0-24，updated_at 1-25，倒序后 offset 10 应对应 idx=14
      expect(res.body.items[0].id).toBe('art-14')
    })
  })

  describe('Max limit enforcement', () => {
    it('should cap limit to 1000 when limit=2000 requested', async () => {
      insertArticles(1050)
      const res = await request(app).get('/api/articles?limit=2000')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1000)
      expect(res.body.total).toBe(1050)
      expect(res.body.limit).toBe(1000)
      expect(res.body.offset).toBe(0)
    })

    it('should cap limit to 1000 when limit=9999 requested', async () => {
      insertArticles(1050)
      const res = await request(app).get('/api/articles?limit=9999')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1000)
      expect(res.body.limit).toBe(1000)
    })
  })

  describe('Offset out of bounds', () => {
    it('should return empty items when offset exceeds total', async () => {
      insertArticles(10)
      const res = await request(app).get('/api/articles?limit=10&offset=100')
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
      expect(res.body.total).toBe(10)
      expect(res.body.offset).toBe(100)
    })

    it('should return empty items when offset equals total', async () => {
      insertArticles(10)
      const res = await request(app).get('/api/articles?offset=10')
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
      expect(res.body.total).toBe(10)
    })
  })

  describe('Total field', () => {
    it('should return correct total count', async () => {
      insertArticles(75)
      const res = await request(app).get('/api/articles?limit=20&offset=0')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(20)
      expect(res.body.total).toBe(75)
    })

    it('should return total=0 when table is empty', async () => {
      const res = await request(app).get('/api/articles')
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
      expect(res.body.total).toBe(0)
    })

    it('total should remain consistent across pages', async () => {
      insertArticles(250)
      const page1 = await request(app).get('/api/articles?limit=100&offset=0')
      const page2 = await request(app).get('/api/articles?limit=100&offset=100')
      const page3 = await request(app).get('/api/articles?limit=100&offset=200')
      expect(page1.body.total).toBe(250)
      expect(page2.body.total).toBe(250)
      expect(page3.body.total).toBe(250)
      expect(page1.body.items).toHaveLength(100)
      expect(page2.body.items).toHaveLength(100)
      expect(page3.body.items).toHaveLength(50)
    })
  })

  describe('Response format', () => {
    it('should return object with items, total, limit, offset fields', async () => {
      insertArticles(5)
      const res = await request(app).get('/api/articles?limit=3&offset=1')
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('items')
      expect(res.body).toHaveProperty('total')
      expect(res.body).toHaveProperty('limit')
      expect(res.body).toHaveProperty('offset')
      expect(Array.isArray(res.body.items)).toBe(true)
      expect(typeof res.body.total).toBe('number')
      expect(typeof res.body.limit).toBe('number')
      expect(typeof res.body.offset).toBe('number')
    })
  })
})
