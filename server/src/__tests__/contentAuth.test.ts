// 共享内容写权限测试：articles/questions 的核心写操作仅教师/管理员可执行
// - 学生：可创建（AI 生成写回）、可写回 vocabulary/phrases 派生缓存
// - 学生：不得修改标题/正文/翻译等核心字段，不得删除共享内容
// - 教师：完整 CRUD
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTableRouter, type TableName } from '../routes.js'
import { db } from '../db.js'
import { injectUser, TEST_USER } from './testUsers.js'

function createApp(role: 'student' | 'teacher' | 'admin') {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use(injectUser({ ...TEST_USER, role }))
  const tables: TableName[] = ['articles', 'questions']
  for (const table of tables) {
    app.use(`/api/${table}`, createTableRouter(table))
  }
  return app
}

const studentApp = createApp('student')
const teacherApp = createApp('teacher')

function clearSharedTables(): void {
  db.prepare('DELETE FROM questions').run()
  db.prepare('DELETE FROM user_article_states').run()
  db.prepare('DELETE FROM articles').run()
}

const ARTICLE = {
  id: 'auth-art-1',
  title: '权限测试文章',
  content: 'Permission test content',
  translation: '权限测试内容',
  genre: 'narrative',
  wordCount: 100,
  createdAt: Date.now(),
}

const QUESTION = {
  id: 'auth-art-1-1',
  articleId: 'auth-art-1',
  type: 'detail',
  stem: '题干？',
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  explanation: '解析',
  locationClue: '第一段',
  createdAt: Date.now(),
}

beforeEach(() => {
  clearSharedTables()
})

describe('共享内容写权限（content:manage）', () => {
  it('学生可创建共享文章与题目（AI 生成写回路径）', async () => {
    const articleRes = await request(studentApp).post('/api/articles').send(ARTICLE)
    expect(articleRes.status).toBe(201)

    const questionRes = await request(studentApp).post('/api/questions').send(QUESTION)
    expect(questionRes.status).toBe(201)
  })

  it('学生可写回文章派生缓存字段 vocabulary / phrases', async () => {
    await request(studentApp).post('/api/articles').send(ARTICLE)

    const res = await request(studentApp)
      .put('/api/articles/auth-art-1')
      .send({ vocabulary: [{ word: 'test' }], phrases: [] })
    expect(res.status).toBe(200)
  })

  it('学生修改文章核心字段返回 403', async () => {
    await request(studentApp).post('/api/articles').send(ARTICLE)

    const res = await request(studentApp)
      .put('/api/articles/auth-art-1')
      .send({ title: '被篡改的标题' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('学生删除共享文章返回 403，内容仍存在', async () => {
    await request(studentApp).post('/api/articles').send(ARTICLE)

    const res = await request(studentApp).delete('/api/articles/auth-art-1')
    expect(res.status).toBe(403)

    const getRes = await request(studentApp).get('/api/articles/auth-art-1')
    expect(getRes.status).toBe(200)
  })

  it('学生修改/删除题目返回 403', async () => {
    await request(studentApp).post('/api/articles').send(ARTICLE)
    await request(studentApp).post('/api/questions').send(QUESTION)

    const putRes = await request(studentApp)
      .put('/api/questions/auth-art-1-1')
      .send({ stem: '被篡改的题干' })
    expect(putRes.status).toBe(403)

    const delRes = await request(studentApp).delete('/api/questions/auth-art-1-1')
    expect(delRes.status).toBe(403)
  })

  it('教师可修改/删除文章与题目', async () => {
    await request(teacherApp).post('/api/articles').send(ARTICLE)
    await request(teacherApp).post('/api/questions').send(QUESTION)

    const putArticle = await request(teacherApp)
      .put('/api/articles/auth-art-1')
      .send({ title: '教师修订标题' })
    expect(putArticle.status).toBe(200)

    const putQuestion = await request(teacherApp)
      .put('/api/questions/auth-art-1-1')
      .send({ stem: '教师修订题干' })
    expect(putQuestion.status).toBe(200)

    const delArticle = await request(teacherApp).delete('/api/articles/auth-art-1')
    expect(delArticle.status).toBe(204)
    const delQuestion = await request(teacherApp).delete('/api/questions/auth-art-1-1')
    expect(delQuestion.status).toBe(204)
  })

  it('删除共享文章时同步清理各用户阅读状态（同一事务）', async () => {
    // 回归：文章与 user_article_states 的删除需在同一事务内完成，避免孤儿状态残留
    await request(teacherApp).post('/api/articles').send(ARTICLE)
    const markRead = await request(studentApp)
      .put('/api/articles/auth-art-1')
      .send({ readAt: Date.now() })
    expect(markRead.status).toBe(200)

    const countStates = () =>
      (
        db.prepare('SELECT COUNT(*) AS c FROM user_article_states WHERE articleId = ?').get(
          'auth-art-1',
        ) as { c: number }
      ).c
    expect(countStates()).toBe(1)

    const delArticle = await request(teacherApp).delete('/api/articles/auth-art-1')
    expect(delArticle.status).toBe(204)
    expect(countStates()).toBe(0)
    expect(db.prepare('SELECT 1 FROM articles WHERE id = ?').get('auth-art-1')).toBeUndefined()
  })
})
