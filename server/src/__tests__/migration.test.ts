// 多用户迁移测试（P0）
// 验证：旧单用户数据（无 userId / 无前缀 id / articles 行内 readAt）经迁移后
// 正确归属首个管理员、id 前缀化、阅读状态剥离，且迁移幂等可重复执行
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db.js'
import { runMultiUserMigration } from '../migrateMultiUser.js'
import { verifyPassword, findUserByUsername } from '../auth.js'

const ADMIN_PASSWORD = 'admin-test-pass'

function clearAll() {
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
    'schema_meta',
  ] as const) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

/** 构造单用户时代的旧数据（无 userId、id 无前缀、readAt 存 articles 行） */
function seedLegacyData() {
  db.prepare(
    `INSERT INTO articles (id, title, content, createdAt, updated_at, readAt, startedAt)
     VALUES ('2026-01-01', 'Legacy', 'Content', 1000, 1000, 2000, 1500)`,
  ).run()
  db.prepare(
    `INSERT INTO articles (id, title, content, createdAt, updated_at)
     VALUES ('2026-01-02', 'Unread', 'Content', 1000, 1000)`,
  ).run()
  db.prepare(
    `INSERT INTO words (id, word, definition, createdAt, updated_at) VALUES ('apple', 'apple', '苹果', 1000, 1000)`,
  ).run()
  db.prepare(
    `INSERT INTO reviews (id, wordId, step, correct, reviewedAt, updated_at)
     VALUES ('apple-learn-1', 'apple', 'learn', 1, 1000, 1000)`,
  ).run()
  db.prepare(
    `INSERT INTO stats (id, articlesRead, wordsLearned, wordsReviewed, wordsMastered, streak, updated_at)
     VALUES ('2026-01-01', 1, 5, 10, 2, 3, 1000)`,
  ).run()
}

describe('多用户数据迁移', () => {
  beforeEach(() => {
    clearAll()
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_INITIAL_PASSWORD = ADMIN_PASSWORD
  })

  afterEach(() => {
    delete process.env.ADMIN_USERNAME
    delete process.env.ADMIN_INITIAL_PASSWORD
  })

  it('空库迁移：创建首个管理员并写入完成标记', () => {
    runMultiUserMigration()
    const admin = findUserByUsername('admin')
    expect(admin).toBeDefined()
    expect(admin!.role).toBe('admin')
    expect(verifyPassword(ADMIN_PASSWORD, admin!.passwordHash)).toBe(true)
    const meta = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'multi_user_migrated'`)
      .get() as { value: string }
    expect(meta.value).toBe('1')
  })

  it('旧数据归属首个管理员：userId 回填 + id 前缀化 + 引用列前缀化', () => {
    seedLegacyData()
    runMultiUserMigration()
    const admin = findUserByUsername('admin')!

    const word = db.prepare('SELECT id, userId FROM words').get() as {
      id: string
      userId: string
    }
    expect(word.id).toBe(`${admin.id}:apple`)
    expect(word.userId).toBe(admin.id)

    const review = db.prepare('SELECT id, wordId, userId FROM reviews').get() as {
      id: string
      wordId: string
      userId: string
    }
    expect(review.id).toBe(`${admin.id}:apple-learn-1`)
    expect(review.wordId).toBe(`${admin.id}:apple`)
    expect(review.userId).toBe(admin.id)

    const stats = db.prepare('SELECT id, userId FROM stats').get() as {
      id: string
      userId: string
    }
    expect(stats.id).toBe(`${admin.id}:2026-01-01`)
    expect(stats.userId).toBe(admin.id)
  })

  it('articles 行内 readAt/startedAt 剥离到 user_article_states', () => {
    seedLegacyData()
    runMultiUserMigration()
    const admin = findUserByUsername('admin')!

    const state = db
      .prepare('SELECT * FROM user_article_states WHERE articleId = ?')
      .get('2026-01-01') as {
      userId: string
      startedAt: number
      readAt: number
    }
    expect(state.userId).toBe(admin.id)
    expect(state.startedAt).toBe(1500)
    expect(state.readAt).toBe(2000)

    // 未读文章不产生状态行
    const unread = db
      .prepare('SELECT COUNT(*) as c FROM user_article_states WHERE articleId = ?')
      .get('2026-01-02') as { c: number }
    expect(unread.c).toBe(0)
  })

  it('迁移幂等：重复执行不产生重复前缀、不重复建管理员', () => {
    seedLegacyData()
    runMultiUserMigration()
    runMultiUserMigration()
    runMultiUserMigration()
    const admin = findUserByUsername('admin')!
    const word = db.prepare('SELECT id FROM words').get() as { id: string }
    expect(word.id).toBe(`${admin.id}:apple`)
    const adminCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
    expect(adminCount.c).toBe(1)
    const wordCount = db.prepare('SELECT COUNT(*) as c FROM words').get() as { c: number }
    expect(wordCount.c).toBe(1)
  })

  it('已有用户时不重复创建管理员，历史数据归属最早用户', () => {
    // 模拟已有用户的环境（如重复部署）
    db.prepare(
      `INSERT INTO users (id, username, displayName, passwordHash, role, status, createdAt, updated_at)
       VALUES ('existing-admin', 'admin', '管理员', 'x', 'admin', 'active', 1, 1)`,
    ).run()
    seedLegacyData()
    runMultiUserMigration()
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
    expect(userCount.c).toBe(1)
    const word = db.prepare('SELECT userId FROM words').get() as { userId: string }
    expect(word.userId).toBe('existing-admin')
  })
})
