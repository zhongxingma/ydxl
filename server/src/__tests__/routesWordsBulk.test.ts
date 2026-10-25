// REST API：Words 批量端点
//
// POST /api/words/bulk 的批量插入与 added / skipped 计数。
// 由 routes.test.ts 按资源类型拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app, clearAllTables } from './routesTestApp.js'

describe('Words bulk endpoint', () => {
  beforeEach(() => {
    clearAllTables()
  })

  it('POST /api/words/bulk 应批量插入新词并返回 added/skipped 计数', async () => {
    const items = [
      { id: 'apple', word: 'apple', phonetic: '', pos: '', definition: '', example: '', mastery: 0, nextReview: Date.now(), lastReview: 0, reviewCount: 0, interval: 0, easeFactor: 2.5, createdAt: Date.now() },
      { id: 'banana', word: 'banana', phonetic: '', pos: '', definition: '', example: '', mastery: 0, nextReview: Date.now(), lastReview: 0, reviewCount: 0, interval: 0, easeFactor: 2.5, createdAt: Date.now() },
      { id: 'cherry', word: 'cherry', phonetic: '', pos: '', definition: '', example: '', mastery: 0, nextReview: Date.now(), lastReview: 0, reviewCount: 0, interval: 0, easeFactor: 2.5, createdAt: Date.now() },
    ]

    const res = await request(app).post('/api/words/bulk').send({ items })
    expect(res.status).toBe(201)
    expect(res.body.added).toBe(3)
    expect(res.body.skipped).toBe(0)
    expect(Array.isArray(res.body.errors)).toBe(true)
    expect(res.body.errors).toHaveLength(0)

    // 验证全部写入数据库
    const listRes = await request(app).get('/api/words')
    expect(listRes.body.total).toBe(3)
  })

  it('POST /api/words/bulk 已存在词应被跳过（INSERT OR IGNORE），不覆盖复习进度', async () => {
    // 预置 apple 已存在且有复习进度
    await request(app).post('/api/words').send({
      id: 'apple',
      word: 'apple',
      phonetic: '/æpəl/',
      pos: 'n.',
      definition: '苹果',
      example: 'an apple',
      mastery: 3,
      nextReview: Date.now(),
      lastReview: Date.now(),
      reviewCount: 5,
      interval: 7,
      easeFactor: 2.6,
      createdAt: Date.now(),
    })

    // 批量插入 apple（已存在）+ banana（新）
    const items = [
      { id: 'apple', word: 'apple', phonetic: '', pos: '', definition: '', example: '', mastery: 0, nextReview: Date.now(), lastReview: 0, reviewCount: 0, interval: 0, easeFactor: 2.5, createdAt: Date.now() },
      { id: 'banana', word: 'banana', phonetic: '', pos: '', definition: '', example: '', mastery: 0, nextReview: Date.now(), lastReview: 0, reviewCount: 0, interval: 0, easeFactor: 2.5, createdAt: Date.now() },
    ]
    const res = await request(app).post('/api/words/bulk').send({ items })
    expect(res.status).toBe(201)
    expect(res.body.added).toBe(1)
    expect(res.body.skipped).toBe(1)

    // 验证 apple 复习进度未被覆盖（mastery 仍为 3，reviewCount 仍为 5）
    const getRes = await request(app).get('/api/words/apple')
    expect(getRes.status).toBe(200)
    expect(getRes.body.mastery).toBe(3)
    expect(getRes.body.reviewCount).toBe(5)
    expect(getRes.body.easeFactor).toBe(2.6)
    // 验证 banana 已插入
    const bananaRes = await request(app).get('/api/words/banana')
    expect(bananaRes.status).toBe(200)
  })

  it('POST /api/words/bulk 空数组 → 返回 0/0', async () => {
    const res = await request(app).post('/api/words/bulk').send({ items: [] })
    expect(res.status).toBe(200)
    expect(res.body.added).toBe(0)
    expect(res.body.skipped).toBe(0)
  })

  it('POST /api/words/bulk 缺少 items 字段 → 400', async () => {
    const res = await request(app).post('/api/words/bulk').send({ foo: 'bar' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INPUT')
  })

  it('POST /api/words/bulk 超过 1000 条 → 400', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => ({
      id: `w-${i}`,
      word: `w-${i}`,
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
      mastery: 0,
      nextReview: Date.now(),
      lastReview: 0,
      reviewCount: 0,
      interval: 0,
      easeFactor: 2.5,
      createdAt: Date.now(),
    }))
    const res = await request(app).post('/api/words/bulk').send({ items })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INPUT')
  })

  it('POST /api/words/bulk 不应被 POST /:id 路由匹配（路由顺序验证）', async () => {
    // 验证 bulk 端点正常工作，而非被通用 POST /:id 处理（bulk 不会作为 :id）
    const res = await request(app).post('/api/words/bulk').send({
      items: [{ id: 'test', word: 'test', phonetic: '', pos: '', definition: '', example: '', mastery: 0, nextReview: Date.now(), lastReview: 0, reviewCount: 0, interval: 0, easeFactor: 2.5, createdAt: Date.now() }],
    })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('added')
    expect(res.body).toHaveProperty('skipped')
    // 不应返回 POST /:id 的响应体（仅含 id 与字段，无 added/skipped）
  })
})
