// REST API 端到端测试（supertest）
// 验证 7 张表的 REST 路由：GET 列表 / GET :id / POST 新增 / PUT 更新 / DELETE 删除
// 验证 words 表的批量端点：POST /api/words/bulk
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTableRouter, createWordsBulkRouter, type TableName } from '../routes.js'
import { db } from '../db.js'
import { injectUser } from './testUsers.js'

// 构建 Express 应用并注册所有 7 张表路由（注入测试用户模拟认证上下文）
// 注意：words 表的批量端点 /api/words/bulk 必须在 /api/words 通用路由之前注册，
// 否则 POST /api/words/bulk 会被 createTableRouter 的 POST /:id 匹配（bulk 作为 :id）
function createApp() {
  const app = express()
  // 与生产配置一致：提高 JSON 解析上限以支持批量端点
  app.use(express.json({ limit: '10mb' }))
  app.use(injectUser())
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

describe('REST API', () => {
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

  describe('Other tables endpoints', () => {
    beforeEach(() => {
      clearAllTables()
    })

    it('POST/GET/PUT/DELETE /api/questions should work end-to-end', async () => {
      const question = {
        id: 'q-1',
        articleId: 'a-1',
        type: 'choice',
        stem: 'What is the main idea?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Explanation',
        locationClue: 'paragraph 1',
        createdAt: Date.now(),
      }

      // POST
      const postRes = await request(app).post('/api/questions').send(question)
      expect(postRes.status).toBe(201)
      expect(postRes.body.id).toBe('q-1')
      // JSON 字段 options 应被反序列化
      expect(Array.isArray(postRes.body.options)).toBe(true)

      // GET 列表
      const listRes = await request(app).get('/api/questions')
      expect(listRes.status).toBe(200)
      expect(listRes.body.items).toHaveLength(1)
      expect(listRes.body.total).toBe(1)

      // GET :id
      const getRes = await request(app).get('/api/questions/q-1')
      expect(getRes.status).toBe(200)
      expect(getRes.body.stem).toBe('What is the main idea?')

      // PUT
      const putRes = await request(app)
        .put('/api/questions/q-1')
        .send({ stem: 'Updated question?' })
      expect(putRes.status).toBe(200)

      // DELETE
      const delRes = await request(app).delete('/api/questions/q-1')
      expect(delRes.status).toBe(204)
    })

    it('POST/GET /api/words should work', async () => {
      const word = {
        id: 'w-1',
        word: 'brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        mastery: 0,
        reviewCount: 0,
        interval: 1,
        easeFactor: 2.5,
        createdAt: Date.now(),
        achievementTags: ['first-word'],
      }

      const postRes = await request(app).post('/api/words').send(word)
      expect(postRes.status).toBe(201)
      // JSON 字段 achievementTags 应被反序列化
      expect(Array.isArray(postRes.body.achievementTags)).toBe(true)

      const getRes = await request(app).get('/api/words/w-1')
      expect(getRes.status).toBe(200)
      expect(getRes.body.word).toBe('brave')
    })

    it('POST/GET /api/words should persist AI-generated exampleTranslation & phrases', async () => {
      // 回归测试：exampleTranslation（string）与 phrases（WordPhrase[]）历史缺陷中被
      // sanitizeBody 白名单过滤掉（旧 schema 缺这两列）。验证修复后能正确持久化与反序列化。
      const phrases = [
        { phrase: 'take care of', meaning: '照顾', example: 'Take care of yourself.', exampleTranslation: '照顾好你自己。' },
      ]
      const word = {
        id: 'w-enrich',
        word: 'care',
        phonetic: '/keər/',
        pos: 'n.',
        definition: '照顾',
        example: 'Take care of yourself.',
        exampleTranslation: '照顾好你自己。',
        phrases,
        mastery: 0,
        reviewCount: 0,
        interval: 1,
        easeFactor: 2.5,
        createdAt: Date.now(),
      }

      const postRes = await request(app).post('/api/words').send(word)
      expect(postRes.status).toBe(201)
      // 写入后返回的 body 应保留这两个字段（未被白名单过滤）
      expect(postRes.body.exampleTranslation).toBe('照顾好你自己。')
      expect(Array.isArray(postRes.body.phrases)).toBe(true)

      const getRes = await request(app).get('/api/words/w-enrich')
      expect(getRes.status).toBe(200)
      expect(getRes.body.word).toBe('care')
      // 标量字段 exampleTranslation 应原样读取
      expect(getRes.body.exampleTranslation).toBe('照顾好你自己。')
      // JSON 字段 phrases 应被反序列化为数组，且结构完整
      expect(Array.isArray(getRes.body.phrases)).toBe(true)
      expect(getRes.body.phrases).toEqual(phrases)
    })

    it('PUT /api/articles/:id should persist vocabulary (enhanced flip-card content)', async () => {
      // 回归测试：重点词汇增强内容（exampleSentence / emojiHint 等全部显示内容）
      // 通过 CachedRemoteRepository.update → PUT /api/articles/:id 写入服务器 SQLite。
      // 验证 sanitizeBody 白名单（PRAGMA table_info 动态列）不会丢弃 vocabulary 字段，
      // 且 JSON_COLUMNS 序列化/反序列化往返完整。
      const vocabulary = [
        {
          word: 'annual',
          phonetic: '/ˈænjuəl/',
          pos: 'adj.',
          definition: '每年的；年度的',
          example: 'the annual Sports Day',
          importance: 'high',
          exampleSentence: 'Our school holds an annual sports meeting.',
          emojiHint: ['🏃', '📅'],
        },
      ]
      // 先创建文章（含基础版 vocabulary，模拟 saveArticle 路径）
      const article = {
        id: 'a-vocab-put',
        title: 'Vocabulary Put Test',
        content: 'Test content',
        translation: '测试内容',
        wordCount: 100,
        createdAt: Date.now(),
        vocabulary: [
          {
            word: 'annual',
            phonetic: '/ˈænjuəl/',
            pos: 'adj.',
            definition: '每年的；年度的',
            example: 'the annual Sports Day',
            importance: 'high',
          },
        ],
      }
      const postRes = await request(app).post('/api/articles').send(article)
      expect(postRes.status).toBe(201)
      expect(Array.isArray(postRes.body.vocabulary)).toBe(true)

      // PUT 增强 patch：仅携带 vocabulary 字段（模拟 persistToArticle 更新路径）
      const putRes = await request(app).put('/api/articles/a-vocab-put').send({ vocabulary })
      expect(putRes.status).toBe(200)
      expect(putRes.body.vocabulary).toEqual(vocabulary)

      // GET 读回：JSON 反序列化完整（含增强字段）
      const getRes = await request(app).get('/api/articles/a-vocab-put')
      expect(getRes.status).toBe(200)
      expect(getRes.body.vocabulary).toEqual(vocabulary)
      expect(getRes.body.vocabulary[0].exampleSentence).toBe(
        'Our school holds an annual sports meeting.'
      )
      expect(getRes.body.vocabulary[0].emojiHint).toEqual(['🏃', '📅'])
    })

    it('POST/GET /api/reviews should work', async () => {
      const review = {
        id: 'r-1',
        wordId: 'w-1',
        step: 'recall',
        correct: 1,
        correctRate: 1.0,
        timeSpent: 5000,
        reviewedAt: Date.now(),
      }

      const postRes = await request(app).post('/api/reviews').send(review)
      expect(postRes.status).toBe(201)
      expect(postRes.body.id).toBe('r-1')

      const getRes = await request(app).get('/api/reviews/r-1')
      expect(getRes.status).toBe(200)
      expect(getRes.body.wordId).toBe('w-1')
    })

    it('POST/GET /api/stats should work', async () => {
      const stats = {
        id: 's-1',
        articlesRead: 5,
        wordsLearned: 20,
        wordsReviewed: 50,
        wordsMastered: 10,
        streak: 3,
      }

      const postRes = await request(app).post('/api/stats').send(stats)
      expect(postRes.status).toBe(201)
      expect(postRes.body.id).toBe('s-1')

      const getRes = await request(app).get('/api/stats/s-1')
      expect(getRes.status).toBe(200)
      expect(getRes.body.articlesRead).toBe(5)
    })

    it('POST/GET /api/readingSessions should work', async () => {
      const session = {
        id: 'rs-1',
        articleId: 'a-1',
        durationSec: 300,
        wordCount: 250,
        correctRate: 0.8,
        reviewedAt: Date.now(),
      }

      const postRes = await request(app).post('/api/readingSessions').send(session)
      expect(postRes.status).toBe(201)
      expect(postRes.body.id).toBe('rs-1')

      const getRes = await request(app).get('/api/readingSessions/rs-1')
      expect(getRes.status).toBe(200)
      expect(getRes.body.durationSec).toBe(300)
    })

    it('POST/GET /api/achievements should work', async () => {
      const achievement = {
        id: 'a-1',
        name: 'first_word',
        description: 'Learn your first word',
        icon: '🎯',
        unlockedAt: Date.now(),
      }

      const postRes = await request(app).post('/api/achievements').send(achievement)
      expect(postRes.status).toBe(201)
      expect(postRes.body.id).toBe('a-1')

      const getRes = await request(app).get('/api/achievements/a-1')
      expect(getRes.status).toBe(200)
      expect(getRes.body.name).toBe('first_word')
    })
  })

  // words 表批量端点 POST /api/words/bulk
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
})
