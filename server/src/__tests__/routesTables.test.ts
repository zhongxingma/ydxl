// REST API：其余表端点
//
// questions / words / reviews / stats / readingSessions / achievements 的通用 CRUD。
// 由 routes.test.ts 按资源类型拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app, clearAllTables } from './routesTestApp.js'

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
