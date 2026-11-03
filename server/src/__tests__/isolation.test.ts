// 数据隔离测试（多用户核心验收）
// 验证：双账号并行操作互不可见、id 前缀映射对前端透明、伪造 userId 被忽略、
//       articles/questions 全站共享、readAt/startedAt 按用户隔离
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTableRouter, createWordsBulkRouter, TABLES } from '../routes.js'
import { authMiddleware } from '../auth.js'
import { db } from '../db.js'
import { createRealUser } from './testUsers.js'

// 构建与生产一致的全栈应用：认证门 + 全部表路由
function createApp() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next()
    return authMiddleware(req, res, next)
  })
  app.use('/api/words/bulk', createWordsBulkRouter())
  for (const table of TABLES) {
    app.use(`/api/${table}`, createTableRouter(table))
  }
  return app
}

const app = createApp()

function clearAllTables() {
  for (const table of [
    'questions',
    'words',
    'reviews',
    'stats',
    'readingSessions',
    'achievements',
    'articles',
    'user_article_states',
    'sessions',
    'users',
  ] as const) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

function makeWord(id: string) {
  return {
    id,
    word: id,
    phonetic: '/test/',
    pos: 'n.',
    definition: '测试',
    example: 'an example',
    mastery: 1,
    nextReview: Date.now(),
    lastReview: Date.now(),
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: Date.now(),
  }
}

describe('多用户数据隔离', () => {
  let alice: { user: { id: string }; token: string }
  let bob: { user: { id: string }; token: string }

  beforeEach(() => {
    clearAllTables()
    alice = createRealUser({ username: 'alice' })
    bob = createRealUser({ username: 'bob' })
  })

  it('未认证请求一律 401', async () => {
    for (const path of ['/api/words', '/api/articles', '/api/stats', '/api/questions']) {
      const res = await request(app).get(path)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    }
  })

  it('words：双用户同名生词互不冲突，列表/详情严格隔离', async () => {
    // 两个用户收藏同一个单词（单用户时代必然主键碰撞的场景）
    await request(app).post('/api/words').set('x-user-token', alice.token).send(makeWord('apple'))
    await request(app)
      .post('/api/words')
      .set('x-user-token', bob.token)
      .send({ ...makeWord('apple'), definition: '鲍勃的苹果' })

    // Alice 列表只有自己的词，且 id 被透明剥离为 'apple'
    const listA = await request(app).get('/api/words').set('x-user-token', alice.token)
    expect(listA.status).toBe(200)
    expect(listA.body.total).toBe(1)
    expect(listA.body.items[0].id).toBe('apple')
    expect(listA.body.items[0].userId).toBeUndefined()

    const listB = await request(app).get('/api/words').set('x-user-token', bob.token)
    expect(listB.body.total).toBe(1)
    expect(listB.body.items[0].definition).toBe('鲍勃的苹果')

    // 详情按业务 id 访问，互不可见对方数据
    const detailA = await request(app).get('/api/words/apple').set('x-user-token', alice.token)
    expect(detailA.status).toBe(200)
    expect(detailA.body.id).toBe('apple')
    expect(detailA.body.userId).toBeUndefined()
    // 删除对方不存在于自己空间的数据 → 404
    await request(app).delete('/api/words/apple').set('x-user-token', bob.token)
    const afterDelete = await request(app).get('/api/words/apple').set('x-user-token', alice.token)
    expect(afterDelete.status).toBe(200)
    const afterDeleteB = await request(app).get('/api/words/apple').set('x-user-token', bob.token)
    expect(afterDeleteB.status).toBe(404)
  })

  it('words：客户端伪造 userId 字段被忽略，强制归属当前用户', async () => {
    const malicious = { ...makeWord('hack'), userId: bob.user.id }
    await request(app).post('/api/words').set('x-user-token', alice.token).send(malicious)
    const listB = await request(app).get('/api/words').set('x-user-token', bob.token)
    expect(listB.body.total).toBe(0)
    const listA = await request(app).get('/api/words').set('x-user-token', alice.token)
    expect(listA.body.total).toBe(1)
  })

  it('words 批量端点：批量生词归属当前用户，另一用户不可见', async () => {
    const res = await request(app)
      .post('/api/words/bulk')
      .set('x-user-token', alice.token)
      .send({ items: [makeWord('w1'), makeWord('w2')] })
    expect(res.status).toBe(201)
    expect(res.body.added).toBe(2)
    const listB = await request(app).get('/api/words').set('x-user-token', bob.token)
    expect(listB.body.total).toBe(0)
    const listA = await request(app).get('/api/words').set('x-user-token', alice.token)
    expect(listA.body.total).toBe(2)
  })

  it('stats：同日期主键按用户隔离', async () => {
    const stats = {
      id: '2026-10-14',
      articlesRead: 1,
      wordsLearned: 5,
      wordsReviewed: 10,
      wordsMastered: 2,
      streak: 3,
    }
    await request(app).post('/api/stats').set('x-user-token', alice.token).send(stats)
    await request(app)
      .post('/api/stats')
      .set('x-user-token', bob.token)
      .send({ ...stats, articlesRead: 9 })
    const a = await request(app).get('/api/stats/2026-10-14').set('x-user-token', alice.token)
    expect(a.body.id).toBe('2026-10-14')
    expect(a.body.articlesRead).toBe(1)
    const b = await request(app).get('/api/stats/2026-10-14').set('x-user-token', bob.token)
    expect(b.body.articlesRead).toBe(9)
  })

  it('reviews：wordId 引用透明映射，跨用户不可见', async () => {
    await request(app).post('/api/words').set('x-user-token', alice.token).send(makeWord('apple'))
    const review = {
      id: 'apple-learn-1',
      wordId: 'apple',
      step: 'learn',
      correct: true,
      correctRate: 1,
      timeSpent: 30,
      reviewedAt: Date.now(),
    }
    await request(app).post('/api/reviews').set('x-user-token', alice.token).send(review)
    const listA = await request(app).get('/api/reviews').set('x-user-token', alice.token)
    expect(listA.body.total).toBe(1)
    // wordId 前缀被透明剥离
    expect(listA.body.items[0].wordId).toBe('apple')
    const listB = await request(app).get('/api/reviews').set('x-user-token', bob.token)
    expect(listB.body.total).toBe(0)
  })

  it('articles/questions 全站共享：一人创建全员可读', async () => {
    const article = {
      id: '2026-10-14',
      title: 'Shared Article',
      content: 'Shared content',
      genre: 'narrative',
      wordCount: 100,
      createdAt: Date.now(),
    }
    await request(app).post('/api/articles').set('x-user-token', alice.token).send(article)
    const b = await request(app).get('/api/articles/2026-10-14').set('x-user-token', bob.token)
    expect(b.status).toBe(200)
    expect(b.body.title).toBe('Shared Article')

    const question = {
      id: '2026-10-14-1',
      articleId: '2026-10-14',
      type: 'main_idea',
      stem: 'Q?',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      explanation: 'e',
      locationClue: 'l',
      createdAt: Date.now(),
    }
    await request(app).post('/api/questions').set('x-user-token', alice.token).send(question)
    const bq = await request(app).get('/api/questions').set('x-user-token', bob.token)
    expect(bq.body.total).toBe(1)
  })

  it('readAt/startedAt 按用户隔离：Alice 标记已读不影响 Bob 视图', async () => {
    const article = {
      id: '2026-10-15',
      title: 'Reading States',
      content: 'Content',
      genre: 'expository',
      wordCount: 80,
      createdAt: Date.now(),
    }
    await request(app).post('/api/articles').set('x-user-token', alice.token).send(article)

    // Alice 标记开始阅读与已读（与前端 markAsRead 相同的 PUT 语义）
    const put = await request(app)
      .put('/api/articles/2026-10-15')
      .set('x-user-token', alice.token)
      .send({ id: '2026-10-15', startedAt: 1000, readAt: 2000 })
    expect(put.status).toBe(200)
    expect(put.body.readAt).toBe(2000)

    // Alice 视图：readAt=2000；Bob 视图：readAt=null
    const a = await request(app).get('/api/articles/2026-10-15').set('x-user-token', alice.token)
    expect(a.body.readAt).toBe(2000)
    expect(a.body.startedAt).toBe(1000)
    const b = await request(app).get('/api/articles/2026-10-15').set('x-user-token', bob.token)
    expect(b.body.readAt).toBeNull()
    expect(b.body.startedAt).toBeNull()

    // 共享文章行本身不存阅读状态（列保留但不再写入）
    const row = db.prepare('SELECT readAt, startedAt FROM articles WHERE id = ?').get('2026-10-15') as {
      readAt: number | null
      startedAt: number | null
    }
    expect(row.readAt).toBeNull()
    expect(row.startedAt).toBeNull()

    // 列表同样按用户合并状态
    const listB = await request(app).get('/api/articles').set('x-user-token', bob.token)
    expect(listB.body.items[0].readAt).toBeNull()
  })

  it('业务字段更新（translation）为全站共享，阅读状态更新互不影响', async () => {
    const article = {
      id: '2026-10-16',
      title: 'Mixed Update',
      content: 'Content',
      genre: 'expository',
      wordCount: 60,
      createdAt: Date.now(),
    }
    await request(app).post('/api/articles').set('x-user-token', alice.token).send(article)
    // 共享业务字段的编辑需要 content:manage：由教师更新翻译
    const teacher = createRealUser({ username: 'carol', role: 'teacher' })
    await request(app)
      .put('/api/articles/2026-10-16')
      .set('x-user-token', teacher.token)
      .send({ id: '2026-10-16', translation: '鲍勃的翻译' })
    // Bob 只标记自己的 readAt（私有状态，学生可写）
    await request(app)
      .put('/api/articles/2026-10-16')
      .set('x-user-token', bob.token)
      .send({ id: '2026-10-16', readAt: 3000 })
    const a = await request(app).get('/api/articles/2026-10-16').set('x-user-token', alice.token)
    expect(a.body.translation).toBe('鲍勃的翻译')
    expect(a.body.readAt).toBeNull()
    const b = await request(app).get('/api/articles/2026-10-16').set('x-user-token', bob.token)
    expect(b.body.readAt).toBe(3000)
  })
})
