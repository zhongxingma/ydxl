// 可选的数据库初始化脚本：插入测试数据
// 运行：npx tsx src/seed.ts
import { db } from './db.js'

const now = Date.now()

const sampleArticle = {
  id: 'sample-1',
  title: 'Welcome to ydxl',
  content: 'This is a sample article for testing the local server storage API.',
  translation: '这是用于测试本地服务器存储 API 的示例文章。',
  genre: 'expository',
  wordCount: 12,
  createdAt: now,
  updated_at: now,
  topic: 'campus',
  difficulty: 'easy',
  lexileRange: { min: 400, max: 600 },
  highlightedWords: [
    { word: 'sample', phonetic: '/ˈsæmpl/', pos: 'n.', definition: '示例', example: 'a sample article' },
  ],
}

const sampleStats = {
  id: new Date().toISOString().slice(0, 10),
  articlesRead: 1,
  wordsLearned: 5,
  wordsReviewed: 10,
  wordsMastered: 2,
  streak: 1,
  updated_at: now,
}

// 插入示例数据（INSERT OR REPLACE 避免重复运行报错）
db
  .prepare(
    `INSERT OR REPLACE INTO articles (id, title, content, translation, genre, wordCount, createdAt, updated_at, topic, difficulty, lexileRange, highlightedWords)
     VALUES (@id, @title, @content, @translation, @genre, @wordCount, @createdAt, @updated_at, @topic, @difficulty, @lexileRange, @highlightedWords)`
  )
  .run({
    ...sampleArticle,
    lexileRange: JSON.stringify(sampleArticle.lexileRange),
    highlightedWords: JSON.stringify(sampleArticle.highlightedWords),
  })

// 私有表存储 id 为 `${userId}:${业务id}`（与 routes.ts 前缀映射一致）
const firstUser = db.prepare('SELECT id FROM users ORDER BY createdAt ASC LIMIT 1').get() as
  | { id: string }
  | undefined
if (firstUser) {
  db.prepare(
    `INSERT OR REPLACE INTO stats (id, articlesRead, wordsLearned, wordsReviewed, wordsMastered, streak, updated_at, userId)
     VALUES (@id, @articlesRead, @wordsLearned, @wordsReviewed, @wordsMastered, @streak, @updated_at, @userId)`
  ).run({ ...sampleStats, id: `${firstUser.id}:${sampleStats.id}`, userId: firstUser.id })
} else {
  console.warn('[seed] users 表为空，跳过 stats 示例数据（请先启动服务完成多用户迁移）')
}

console.log('Seed data inserted')
