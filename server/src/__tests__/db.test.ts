// SQLite 数据库表创建与 CRUD 测试
// 验证 server/src/db.ts 中 12 张表（7 业务 + 5 系统）的 schema 创建与基本增删改查操作
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db.js'

// 辅助：获取所有表名
function getTableNames(): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

// 辅助：获取所有索引名
function getIndexNames(): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

// 辅助：构造一条完整的 article 记录
function makeArticle(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Test Article',
    content: 'Test content',
    translation: '测试内容',
    genre: 'narrative',
    wordCount: 100,
    topic: 'school',
    difficulty: 'easy',
    lexileRange: '{"min":600,"max":900}',
    highlightedWords: '[]',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('SQLite Database', () => {
  describe('Table Creation', () => {
    it('should create articles table', () => {
      expect(getTableNames()).toContain('articles')
    })

    it('should create all 7 business tables', () => {
      const expected = [
        'articles',
        'questions',
        'words',
        'reviews',
        'stats',
        'readingSessions',
        'achievements',
      ]
      const tables = getTableNames()
      for (const table of expected) {
        expect(tables).toContain(table)
      }
    })

    it('should create all 5 system tables for multi-user support', () => {
      const expected = ['users', 'sessions', 'user_article_states', 'schema_meta', 'operation_logs']
      const tables = getTableNames()
      for (const table of expected) {
        expect(tables).toContain(table)
      }
      // 业务表 + 系统表共 12 张（不含 sqlite_ 内部表）
      expect(tables).toHaveLength(12)
    })

    it('should create composite indexes backing user-scoped queries', () => {
      // 回归测试（M2）：按用户维度的列表查询依赖复合索引，索引缺失会导致全表扫描
      const expected = [
        'idx_words_user_mastery',
        'idx_words_user_nextReview',
        'idx_words_user_createdAt',
        'idx_reviews_user_reviewedAt',
        'idx_sessions_user_reviewedAt',
      ]
      const indexes = getIndexNames()
      for (const index of expected) {
        expect(indexes).toContain(index)
      }
    })
  })

  describe('Articles CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM articles').run()
    })

    it('should insert and retrieve an article', () => {
      const article = makeArticle('test-1')
      db.prepare(
        `INSERT INTO articles (id, title, content, translation, genre, wordCount, topic, difficulty, lexileRange, highlightedWords, createdAt, updated_at)
         VALUES (@id, @title, @content, @translation, @genre, @wordCount, @topic, @difficulty, @lexileRange, @highlightedWords, @createdAt, @updated_at)`
      ).run(article)

      const retrieved = db.prepare('SELECT * FROM articles WHERE id = ?').get('test-1') as {
        title: string
        wordCount: number
      }
      expect(retrieved.title).toBe('Test Article')
      expect(retrieved.wordCount).toBe(100)
    })

    it('should update an article', () => {
      const article = makeArticle('test-2')
      db.prepare(
        `INSERT INTO articles (id, title, content, translation, genre, wordCount, topic, difficulty, lexileRange, highlightedWords, createdAt, updated_at)
         VALUES (@id, @title, @content, @translation, @genre, @wordCount, @topic, @difficulty, @lexileRange, @highlightedWords, @createdAt, @updated_at)`
      ).run(article)

      db.prepare('UPDATE articles SET title = ?, wordCount = ? WHERE id = ?').run(
        'Updated Title',
        200,
        'test-2'
      )

      const retrieved = db.prepare('SELECT * FROM articles WHERE id = ?').get('test-2') as {
        title: string
        wordCount: number
      }
      expect(retrieved.title).toBe('Updated Title')
      expect(retrieved.wordCount).toBe(200)
    })

    it('should delete an article', () => {
      const article = makeArticle('test-3')
      db.prepare(
        `INSERT INTO articles (id, title, content, translation, genre, wordCount, topic, difficulty, lexileRange, highlightedWords, createdAt, updated_at)
         VALUES (@id, @title, @content, @translation, @genre, @wordCount, @topic, @difficulty, @lexileRange, @highlightedWords, @createdAt, @updated_at)`
      ).run(article)

      const result = db.prepare('DELETE FROM articles WHERE id = ?').run('test-3')
      expect(result.changes).toBe(1)

      const retrieved = db.prepare('SELECT * FROM articles WHERE id = ?').get('test-3')
      expect(retrieved).toBeUndefined()
    })

    it('should migrate vocabulary column for legacy databases (ALTER TABLE ADD COLUMN)', () => {
      // 回归测试：旧生产库 articles 表无 vocabulary 列时，db.ts 启动迁移
      // （PRAGMA table_info 检查 + ALTER TABLE ADD COLUMN）应自动补列。
      // 验证迁移结果：列存在、旧数据行迁移后仍可读（新列默认 NULL）、新列可写入 JSON。
      const columns = db.prepare('PRAGMA table_info(articles)').all() as Array<{ name: string }>
      const columnNames = columns.map((c) => c.name)
      expect(columnNames).toContain('vocabulary')

      // 1. 旧式数据行（不含 vocabulary 列写入）迁移后仍完整可读，vocabulary 为 NULL
      const legacy = makeArticle('test-vocab-legacy')
      db.prepare(
        `INSERT INTO articles (id, title, content, translation, genre, wordCount, topic, difficulty, lexileRange, highlightedWords, createdAt, updated_at)
         VALUES (@id, @title, @content, @translation, @genre, @wordCount, @topic, @difficulty, @lexileRange, @highlightedWords, @createdAt, @updated_at)`
      ).run(legacy)
      const legacyRow = db.prepare('SELECT * FROM articles WHERE id = ?').get('test-vocab-legacy') as {
        title: string
        vocabulary: string | null
      }
      expect(legacyRow.title).toBe('Test Article')
      expect(legacyRow.vocabulary).toBeNull()

      // 2. vocabulary 列可写入 JSON 并完整读回（含增强字段 exampleSentence / emojiHint）
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
      db.prepare('UPDATE articles SET vocabulary = ? WHERE id = ?').run(
        JSON.stringify(vocabulary),
        'test-vocab-legacy'
      )
      const updatedRow = db.prepare('SELECT * FROM articles WHERE id = ?').get('test-vocab-legacy') as {
        vocabulary: string
      }
      expect(JSON.parse(updatedRow.vocabulary)).toEqual(vocabulary)
    })

    it('should return empty when no articles', () => {
      const rows = db.prepare('SELECT * FROM articles').all()
      expect(rows).toHaveLength(0)
    })
  })

  describe('Questions CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM questions').run()
    })

    it('should insert and retrieve a question', () => {
      db.prepare(
        `INSERT INTO questions (id, articleId, type, stem, options, correctIndex, explanation, locationClue, createdAt, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'q-1',
        'test-1',
        'choice',
        'What is the main idea?',
        '["A","B","C","D"]',
        0,
        'Explanation here',
        'paragraph 1',
        Date.now(),
        Date.now()
      )

      const retrieved = db.prepare('SELECT * FROM questions WHERE id = ?').get('q-1') as {
        stem: string
        type: string
      }
      expect(retrieved.stem).toBe('What is the main idea?')
      expect(retrieved.type).toBe('choice')
    })
  })

  describe('Words CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM words').run()
    })

    it('should insert and retrieve a word', () => {
      db.prepare(
        `INSERT INTO words (id, word, phonetic, pos, definition, example, root, note, mastery, nextReview, lastReview, reviewCount, interval, easeFactor, sourceArticleId, createdAt, stubbornCount, achievementTags, stabilityScore, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'w-1',
        'brave',
        '/breɪv/',
        'adj.',
        '勇敢的',
        'a brave boy',
        'brav',
        '',
        0,
        Date.now(),
        0,
        0,
        1,
        2.5,
        'test-1',
        Date.now(),
        0,
        '[]',
        0,
        Date.now()
      )

      const retrieved = db.prepare('SELECT * FROM words WHERE id = ?').get('w-1') as {
        word: string
        definition: string
      }
      expect(retrieved.word).toBe('brave')
      expect(retrieved.definition).toBe('勇敢的')
    })

    it('should persist exampleTranslation and phrases columns (AI-generated fields)', () => {
      // 回归测试：exampleTranslation（标量 TEXT）与 phrases（JSON TEXT）历史缺陷中
      // 缺失于 words 表 schema。验证迁移后两列存在且可读写。
      const phrases = [
        { phrase: 'take care of', meaning: '照顾', example: 'Take care of yourself.', exampleTranslation: '照顾好你自己。' },
      ]
      db.prepare(
        `INSERT INTO words (id, word, phonetic, pos, definition, example, mastery, nextReview, lastReview, reviewCount, interval, easeFactor, createdAt, exampleTranslation, phrases, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'w-enrich',
        'care',
        '/keər/',
        'n.',
        '照顾',
        'Take care of yourself.',
        0,
        Date.now(),
        0,
        0,
        1,
        2.5,
        Date.now(),
        '照顾好你自己。',
        JSON.stringify(phrases),
        Date.now()
      )

      const retrieved = db.prepare('SELECT * FROM words WHERE id = ?').get('w-enrich') as {
        word: string
        exampleTranslation: string
        phrases: string
      }
      expect(retrieved.word).toBe('care')
      expect(retrieved.exampleTranslation).toBe('照顾好你自己。')
      expect(JSON.parse(retrieved.phrases)).toEqual(phrases)
    })
  })

  describe('Reviews CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM reviews').run()
    })

    it('should insert and retrieve a review', () => {
      db.prepare(
        `INSERT INTO reviews (id, wordId, step, correct, correctRate, timeSpent, reviewedAt, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('r-1', 'w-1', 'recall', 1, 1.0, 5000, Date.now(), Date.now())

      const retrieved = db.prepare('SELECT * FROM reviews WHERE id = ?').get('r-1') as {
        wordId: string
        step: string
      }
      expect(retrieved.wordId).toBe('w-1')
      expect(retrieved.step).toBe('recall')
    })
  })

  describe('Stats CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM stats').run()
    })

    it('should insert and retrieve stats', () => {
      db.prepare(
        `INSERT INTO stats (id, articlesRead, wordsLearned, wordsReviewed, wordsMastered, streak, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('s-1', 10, 50, 100, 20, 5, Date.now())

      const retrieved = db.prepare('SELECT * FROM stats WHERE id = ?').get('s-1') as {
        articlesRead: number
        streak: number
      }
      expect(retrieved.articlesRead).toBe(10)
      expect(retrieved.streak).toBe(5)
    })
  })

  describe('ReadingSessions CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM readingSessions').run()
    })

    it('should insert and retrieve a reading session', () => {
      db.prepare(
        `INSERT INTO readingSessions (id, articleId, durationSec, wordCount, correctRate, reviewedAt, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('rs-1', 'test-1', 300, 250, 0.8, Date.now(), Date.now())

      const retrieved = db.prepare('SELECT * FROM readingSessions WHERE id = ?').get('rs-1') as {
        articleId: string
        durationSec: number
      }
      expect(retrieved.articleId).toBe('test-1')
      expect(retrieved.durationSec).toBe(300)
    })
  })

  describe('Achievements CRUD', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM achievements').run()
    })

    it('should insert and retrieve an achievement', () => {
      db.prepare(
        `INSERT INTO achievements (id, name, description, icon, unlockedAt, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('a-1', 'first_word', 'Learn your first word', '🎯', Date.now(), Date.now())

      const retrieved = db.prepare('SELECT * FROM achievements WHERE id = ?').get('a-1') as {
        name: string
        icon: string
      }
      expect(retrieved.name).toBe('first_word')
      expect(retrieved.icon).toBe('🎯')
    })
  })
})
