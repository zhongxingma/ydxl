// REST API：Articles 端点
//
// 文章表的 GET 列表 / GET :id / POST / PUT / DELETE 端到端行为。
// 由 routes.test.ts 按资源类型拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app, clearAllTables } from './routesTestApp.js'

describe('Articles endpoints', () => {
  beforeEach(() => {
    clearAllTables()
  })

  it('GET /api/articles should return empty items when no articles', async () => {
    const res = await request(app).get('/api/articles')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.limit).toBe(100)
    expect(res.body.offset).toBe(0)
  })

  it('POST /api/articles should create a new article and return 201', async () => {
    const article = {
      id: 'test-1',
      title: 'Test Article',
      content: 'Test content',
      translation: '测试内容',
      genre: 'narrative',
      wordCount: 100,
      topic: 'school',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 900 },
      highlightedWords: [],
      createdAt: Date.now(),
    }
    const res = await request(app).post('/api/articles').send(article)
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('test-1')
    expect(res.body.title).toBe('Test Article')
    // JSON 字段应被反序列化为对象
    expect(res.body.lexileRange).toEqual({ min: 600, max: 900 })
    expect(Array.isArray(res.body.highlightedWords)).toBe(true)
  })

  it('GET /api/articles should return all articles', async () => {
    await request(app)
      .post('/api/articles')
      .send({
        id: 'a-1',
        title: 'Article 1',
        content: 'Content 1',
        createdAt: Date.now(),
      })
    await request(app)
      .post('/api/articles')
      .send({
        id: 'a-2',
        title: 'Article 2',
        content: 'Content 2',
        createdAt: Date.now(),
      })

    const res = await request(app).get('/api/articles')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    const ids = res.body.items.map((a: { id: string }) => a.id)
    expect(ids).toContain('a-1')
    expect(ids).toContain('a-2')
    expect(res.body.total).toBe(2)
  })

  it('GET /api/articles/:id should return a single article', async () => {
    await request(app)
      .post('/api/articles')
      .send({
        id: 'a-1',
        title: 'Single Article',
        content: 'Content',
        createdAt: Date.now(),
      })

    const res = await request(app).get('/api/articles/a-1')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('a-1')
    expect(res.body.title).toBe('Single Article')
  })

  it('GET /api/articles/:id should return 404 when not found', async () => {
    const res = await request(app).get('/api/articles/nonexistent')
    expect(res.status).toBe(404)
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  it('PUT /api/articles/:id should update an article', async () => {
    await request(app)
      .post('/api/articles')
      .send({
        id: 'a-1',
        title: 'Original Title',
        content: 'Content',
        createdAt: Date.now(),
      })

    const res = await request(app)
      .put('/api/articles/a-1')
      .send({ title: 'Updated Title', wordCount: 250 })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Updated Title')
    expect(res.body.wordCount).toBe(250)

    // 验证已持久化
    const getRes = await request(app).get('/api/articles/a-1')
    expect(getRes.body.title).toBe('Updated Title')
    expect(getRes.body.wordCount).toBe(250)
  })

  it('PUT /api/articles/:id should return 404 when not found', async () => {
    const res = await request(app)
      .put('/api/articles/nonexistent')
      .send({ title: 'Updated' })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/articles/:id should delete an article', async () => {
    await request(app)
      .post('/api/articles')
      .send({
        id: 'a-1',
        title: 'To Delete',
        content: 'Content',
        createdAt: Date.now(),
      })

    const res = await request(app).delete('/api/articles/a-1')
    expect(res.status).toBe(204)

    // 验证已删除
    const getRes = await request(app).get('/api/articles/a-1')
    expect(getRes.status).toBe(404)
  })

  it('DELETE /api/articles/:id should return 404 when not found', async () => {
    const res = await request(app).delete('/api/articles/nonexistent')
    expect(res.status).toBe(404)
  })
})
