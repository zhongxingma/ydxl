// 服务器本地 SQLite 数据库（better-sqlite3）
// 7 张表 schema 与前端 Dexie 完全一致：字段名使用 camelCase（与 src/shared/types 一致），
// BaseEntity.updated_at 保留 snake_case 以与前端类型定义对齐，避免字段映射转换。
// 数据库文件路径：server/data/ydxl.db（运行时自动创建 data/ 目录）
// 测试环境（NODE_ENV=test 或 DB_PATH=:memory:）使用内存数据库，避免清空生产数据
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 测试环境使用内存数据库，避免清空生产数据
// 支持通过 DB_PATH 环境变量覆盖（如 DB_PATH=:memory: 或自定义路径）
const dbPath =
  process.env.DB_PATH ??
  (process.env.NODE_ENV === 'test'
    ? ':memory:'
    : join(__dirname, '..', 'data', 'ydxl.db'))
// 导出数据库文件路径（多用户迁移前的文件备份需要使用；:memory: 时跳过备份）
export const databasePath = dbPath
// 仅对文件数据库创建目录（:memory: 不需要，dirname 为 '.'）
if (dbPath !== ':memory:') {
  mkdirSync(dirname(dbPath), { recursive: true })
}

// 显式标注实例类型，避免 declaration 生成时报 "cannot be named" 错误
export const db: InstanceType<typeof Database> = new Database(dbPath)
// WAL 模式提升并发读性能（对 :memory: 数据库无实际意义但不报错，保持一致调用）
db.pragma('journal_mode = WAL')
// 单写者模型下，写事务排队最多等待 5s 再返回 SQLITE_BUSY，避免并发写入直接失败
db.pragma('busy_timeout = 5000')

// 各表的 JSON 序列化字段（object/array 存为 TEXT，读取时反序列化）
// 其余字段为标量类型，直接存储
export const JSON_COLUMNS: Record<string, readonly string[]> = {
  articles: ['lexileRange', 'highlightedWords', 'phrases', 'vocabulary'],
  questions: ['options'],
  words: ['achievementTags', 'phrases'],
  reviews: [],
  stats: [],
  readingSessions: [],
  achievements: [],
}

// 各表的加密字段（敏感的用户学习数据，写入前加密、读取后解密）
// 加密使用应用层 AES-256-GCM（见 encryption.ts），对上层透明
// 仅加密用户敏感笔记，复习记录等其他数据不加密（含用户行为数据但无个人标识）
export const ENCRYPTED_COLUMNS: Record<string, readonly string[]> = {
  articles: [],
  questions: [],
  words: ['note'], // 用户笔记可能含个人学习心得，需加密
  reviews: [],
  stats: [],
  readingSessions: [],
  achievements: [],
}

// 初始化 7 张表（字段名与 src/shared/types/index.ts 的类型定义一致）
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    translation TEXT,
    genre TEXT,
    wordCount INTEGER,
    createdAt INTEGER,
    updated_at INTEGER,
    topic TEXT,
    difficulty TEXT,
    lexileRange TEXT,
    highlightedWords TEXT,
    contentHash TEXT,
    readAt INTEGER,
    phrases TEXT,
    vocabulary TEXT
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    articleId TEXT,
    type TEXT,
    stem TEXT,
    options TEXT,
    correctIndex INTEGER,
    explanation TEXT,
    locationClue TEXT,
    createdAt INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS words (
    id TEXT PRIMARY KEY,
    word TEXT,
    phonetic TEXT,
    pos TEXT,
    definition TEXT,
    example TEXT,
    root TEXT,
    note TEXT,
    mastery INTEGER,
    nextReview INTEGER,
    lastReview INTEGER,
    reviewCount INTEGER,
    interval INTEGER,
    easeFactor REAL,
    sourceArticleId TEXT,
    createdAt INTEGER,
    stubbornCount INTEGER,
    achievementTags TEXT,
    stabilityScore INTEGER,
    favorite INTEGER DEFAULT 0,
    exampleTranslation TEXT,
    phrases TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    wordId TEXT,
    step TEXT,
    correct INTEGER,
    correctRate REAL,
    timeSpent INTEGER,
    reviewedAt INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY,
    articlesRead INTEGER,
    wordsLearned INTEGER,
    wordsReviewed INTEGER,
    wordsMastered INTEGER,
    streak INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS readingSessions (
    id TEXT PRIMARY KEY,
    articleId TEXT,
    durationSec INTEGER,
    wordCount INTEGER,
    correctRate REAL,
    reviewedAt INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    icon TEXT,
    unlockedAt INTEGER,
    updated_at INTEGER
  );

  -- ===== 多用户新增表 =====
  -- 用户表：role 取值 admin / teacher / student；status 取值 active / disabled（软删除）
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    status TEXT NOT NULL DEFAULT 'active',
    failedLogins INTEGER DEFAULT 0,
    lockedUntil INTEGER,
    createdAt INTEGER,
    updated_at INTEGER
  );

  -- 会话表：不透明令牌（crypto.randomBytes(32) hex），滑动过期，可吊销
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    createdAt INTEGER,
    expiresAt INTEGER,
    ip TEXT,
    userAgent TEXT
  );

  -- 私有阅读状态：articles 为全站共享表，readAt/startedAt 按用户剥离到此表
  CREATE TABLE IF NOT EXISTS user_article_states (
    userId TEXT NOT NULL,
    articleId TEXT NOT NULL,
    startedAt INTEGER,
    readAt INTEGER,
    updated_at INTEGER,
    PRIMARY KEY (userId, articleId)
  );

  -- schema 迁移元数据（幂等迁移标记，如 multi_user_migrated）
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- ===== 多用户审计日志 =====
  -- 只追加（append-only）：无更新/删除 API；保留 180 天，到期归档 CSV 后清理
  -- detail 为脱敏后的 JSON（绝不含密码/token/笔记明文/AI 密钥）
  CREATE TABLE IF NOT EXISTS operation_logs (
    id TEXT PRIMARY KEY,
    userId TEXT,
    username TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    resourceId TEXT,
    result TEXT NOT NULL DEFAULT 'success',
    detail TEXT,
    ip TEXT,
    createdAt INTEGER
  );
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_logs_user_time ON operation_logs(userId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_logs_action_time ON operation_logs(action, createdAt);
  CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON operation_logs(createdAt);
`)

// 迁移：为已有的 articles 表新增 contentHash 与 readAt 列（兼容旧数据库）
// SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS，通过 PRAGMA table_info 检查列是否存在
const articleColumns = db.prepare('PRAGMA table_info(articles)').all() as Array<{
  name: string
}>
const articleColumnNames = new Set(articleColumns.map((c) => c.name))
if (!articleColumnNames.has('contentHash')) {
  db.exec('ALTER TABLE articles ADD COLUMN contentHash TEXT')
}
if (!articleColumnNames.has('readAt')) {
  db.exec('ALTER TABLE articles ADD COLUMN readAt INTEGER')
}
if (!articleColumnNames.has('startedAt')) {
  db.exec('ALTER TABLE articles ADD COLUMN startedAt INTEGER')
}
// 迁移：为已有的 articles 表新增 phrases 列（兼容旧数据库）
// phrases：文章重点短语 JSON 数组（AI 生成时提取，3-5 个），存储为 TEXT
if (!articleColumnNames.has('phrases')) {
  db.exec('ALTER TABLE articles ADD COLUMN phrases TEXT')
}
// 迁移：为已有的 articles 表新增 vocabulary 列（兼容旧数据库）
// vocabulary：文章重点词汇 JSON 数组（AI 提取并增强后随文章持久化），存储为 TEXT
if (!articleColumnNames.has('vocabulary')) {
  db.exec('ALTER TABLE articles ADD COLUMN vocabulary TEXT')
}

// 迁移：为已有的 words 表新增 favorite 列（兼容旧数据库）
// favorite：收藏标记（0 = 普通生词，1 = 重点收藏），默认 0
const wordColumns = db.prepare('PRAGMA table_info(words)').all() as Array<{
  name: string
}>
const wordColumnNames = new Set(wordColumns.map((c) => c.name))
if (!wordColumnNames.has('favorite')) {
  db.exec('ALTER TABLE words ADD COLUMN favorite INTEGER DEFAULT 0')
}
// 迁移：为已有的 words 表新增 exampleTranslation 与 phrases 列（兼容旧数据库）
// exampleTranslation：例句中文翻译（AI 补全时生成），纯字符串，存为 TEXT
// phrases：相关短语数组（AI 补全时生成，0-3 个 WordPhrase），JSON 序列化后存为 TEXT
// POST /api/words 通过 sanitizeBody 白名单过滤非法列名，
// 旧 schema 缺这两列导致 AI 生成的 exampleTranslation/phrases 被静默丢弃
if (!wordColumnNames.has('exampleTranslation')) {
  db.exec('ALTER TABLE words ADD COLUMN exampleTranslation TEXT')
}
if (!wordColumnNames.has('phrases')) {
  db.exec('ALTER TABLE words ADD COLUMN phrases TEXT')
}

// 迁移：为 5 张私有表新增 userId 列（兼容旧数据库）
// 私有表：words / reviews / stats / readingSessions / achievements（按用户隔离）
// 共享表：articles / questions 不加用户维度（全站共享，节省 AI 生成成本）
const PRIVATE_TABLES_FOR_USERID = ['words', 'reviews', 'stats', 'readingSessions', 'achievements'] as const
for (const table of PRIVATE_TABLES_FOR_USERID) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'userId')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN userId TEXT`)
  }
}

// contentHash 索引：用于去重查询时快速定位
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(contentHash)',
)

// updated_at 索引：所有表的列表查询均按 updated_at DESC 排序（routes.ts GET /），
// 建索引后 SQLite 可利用索引有序性直接倒序扫描，避免全表扫描 + 排序。
// reviews 表增长最快（每次复习新增一行），无索引时排序成本随数据量线性增长。
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_articles_updated_at ON articles(updated_at);
  CREATE INDEX IF NOT EXISTS idx_questions_updated_at ON questions(updated_at);
  CREATE INDEX IF NOT EXISTS idx_words_updated_at ON words(updated_at);
  CREATE INDEX IF NOT EXISTS idx_reviews_updated_at ON reviews(updated_at);
  CREATE INDEX IF NOT EXISTS idx_stats_updated_at ON stats(updated_at);
  CREATE INDEX IF NOT EXISTS idx_readingSessions_updated_at ON readingSessions(updated_at);
  CREATE INDEX IF NOT EXISTS idx_achievements_updated_at ON achievements(updated_at);
`)

// - 私有表 userId 索引：所有私有表查询强制 WHERE userId = ?，必须走索引
// - sessions：按用户吊销会话 / 定期清理过期会话
// - user_article_states：按用户查询已读历史（WHERE userId = ? ORDER BY readAt）
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_words_userId ON words(userId);
  CREATE INDEX IF NOT EXISTS idx_reviews_userId ON reviews(userId);
  CREATE INDEX IF NOT EXISTS idx_stats_userId ON stats(userId);
  CREATE INDEX IF NOT EXISTS idx_readingSessions_userId ON readingSessions(userId);
  CREATE INDEX IF NOT EXISTS idx_achievements_userId ON achievements(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);
  CREATE INDEX IF NOT EXISTS idx_uas_user_readAt ON user_article_states(userId, readAt);
`)

// 复合索引：多用户高频查询下沉
// - words(userId, mastery)：生词本列表按用户过滤已掌握单词（mastery < 5）
// - words(userId, nextReview)：复习队列到期查询（nextReview <= now）
// - words(userId, createdAt)：生词本默认排序（添加时间倒序）
// - reviews(userId, reviewedAt)：复习记录按时间范围统计
// - readingSessions(userId, reviewedAt)：阅读会话按时间范围统计
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_words_user_mastery ON words(userId, mastery);
  CREATE INDEX IF NOT EXISTS idx_words_user_nextReview ON words(userId, nextReview);
  CREATE INDEX IF NOT EXISTS idx_words_user_createdAt ON words(userId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_reviews_user_reviewedAt ON reviews(userId, reviewedAt);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_reviewedAt ON readingSessions(userId, reviewedAt);
`)
