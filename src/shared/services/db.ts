// 数据库 schema 设计思路：
// 1. 使用 Dexie.js 封装 IndexedDB，提供 Promise 风格 API 与 TypeScript 类型支持
// 2. 五张表分别承载：每日文章(articles)、阅读题(questions)、生词本(words)、复习记录(reviews)、学习统计(stats)
// 3. 主键设计：
//    - articles/stats 使用日期字符串 YYYY-MM-DD 作为主键，天然保证每日唯一
//    - questions 使用 `${articleId}-${n}` 作为主键，体现与文章的归属关系
//    - words 使用单词本身作为主键，天然去重
//    - reviews 使用独立字符串主键（如 `${wordId}-${step}-${timestamp}`），由业务层生成
// 4. 索引设计：
//    - 为外键关系建立索引（questions.articleId、words.sourceArticleId、reviews.wordId），
//      支持按文章查询题目、按来源查询生词、按单词查询复习记录等高频查询
//    - 为常用筛选/排序字段建立索引（genre、mastery、nextReview、step、reviewedAt 等）
// 5. Dexie 仅作为离线只读缓存（断网时查看已加载数据），数据落盘以服务器为主（REST API）
//    updated_at 字段保留用于记录修改时间
import Dexie, { type Table } from 'dexie'
import type {
  Achievement,
  Article,
  Question,
  ReadingSession,
  Review,
  Stats,
  Word,
} from '@/shared/types'

// AI 响应缓存条目（responseCache 的 IndexedDB 持久化层）
// 与业务数据分离，独立承载所有确定性 AI 调用的永久缓存结果，
// 突破 localStorage 5MB 上限；updatedAt 用于 LRU 淘汰（超出上限时优先淘汰最久未使用的）
export interface AiCacheEntry {
  // 主键：缓存 key（${scenario}|${model}|${sha256(system+user)}）
  id: string
  // JSON 序列化后的缓存值（读取时反序列化）
  value: string
  // 调用场景标识，用于按 scenario 精确清理
  scenario: string
  // 过期时间戳；PERMANENT_EXPIRES_AT 哨兵表示永久缓存
  expiresAt: number
  // 最后写入时间戳，用于 LRU 淘汰排序（超出上限时优先淘汰最久未写入）
  updatedAt: number
}

// Dexie 数据库实例，数据库名 ydxl-db
export class YdxlDatabase extends Dexie {
  articles!: Table<Article, string>
  questions!: Table<Question, string>
  words!: Table<Word, string>
  reviews!: Table<Review, string>
  stats!: Table<Stats, string>
  // 阅读会话记录表
  readingSessions!: Table<ReadingSession, string>
  // 成就表
  achievements!: Table<Achievement, string>
  // AI 响应缓存表（永久缓存）
  aiCache!: Table<AiCacheEntry, string>

  constructor() {
    super('ydxl-db')
    // 版本 1：初始 schema（articles/questions/words/reviews/stats）
    this.version(1).stores({
      // 主键 id；genre 用于文体筛选；createdAt/updated_at 用于排序与记录修改时间
      articles: 'id, genre, createdAt, updated_at',
      // 主键 id；articleId 外键索引支持按文章查询题目；type 用于题型筛选
      questions: 'id, articleId, type, createdAt',
      // 主键 id(单词本身)；sourceArticleId 外键索引；mastery 按掌握度筛选；nextReview 到期复习查询
      words: 'id, word, sourceArticleId, mastery, nextReview',
      // 主键 id；wordId 外键索引支持按单词查询复习记录；step 按步骤统计；reviewedAt 时间范围查询
      reviews: 'id, wordId, step, reviewedAt',
      // 主键 id(YYYY-MM-DD)；updated_at 用于记录修改时间
      stats: 'id, updated_at',
    })

    // 版本 2：新增 readingSessions 与 achievements 两张表
    // 重要：Dexie 升级版本时必须声明全部已有表的 schema，否则会被当作删除处理
    this.version(2).stores({
      // 主键 id；genre 用于文体筛选；createdAt/updated_at 用于排序与记录修改时间
      articles: 'id, genre, createdAt, updated_at',
      // 主键 id；articleId 外键索引支持按文章查询题目；type 用于题型筛选
      questions: 'id, articleId, type, createdAt',
      // 主键 id(单词本身)；sourceArticleId 外键索引；mastery 按掌握度筛选；nextReview 到期复习查询
      words: 'id, word, sourceArticleId, mastery, nextReview',
      // 主键 id；wordId 外键索引支持按单词查询复习记录；step 按步骤统计；reviewedAt 时间范围查询
      reviews: 'id, wordId, step, reviewedAt',
      // 主键 id(YYYY-MM-DD)；updated_at 用于记录修改时间
      stats: 'id, updated_at',
      // 主键 id；articleId 外键索引支持按文章查询阅读记录；reviewedAt 时间范围查询；updated_at 用于记录修改时间
      readingSessions: 'id, articleId, reviewedAt, updated_at',
      // 主键 id(成就规则 ID)；updated_at 用于记录修改时间
      achievements: 'id, updated_at',
    })

    // 版本 3：为 questions / words / reviews 三张表新增 updated_at 索引
    // 用于按 updated_at 索引查询（离线缓存场景下的排序与筛选）
    // 注意：Dexie v3 schema 升级会自动建立索引，无需数据迁移
    // 其他表（articles/stats/readingSessions/achievements）已在 v1/v2 中声明 updated_at 索引
    this.version(3).stores({
      // 主键 id；genre 用于文体筛选；createdAt/updated_at 用于排序与记录修改时间
      articles: 'id, genre, createdAt, updated_at',
      // 主键 id；articleId 外键索引；type 用于题型筛选；updated_at 用于记录修改时间
      questions: 'id, articleId, type, createdAt, updated_at',
      // 主键 id(单词本身)；sourceArticleId 外键索引；mastery 按掌握度筛选；nextReview 到期复习查询；updated_at 用于记录修改时间
      words: 'id, word, sourceArticleId, mastery, nextReview, updated_at',
      // 主键 id；wordId 外键索引；step 按步骤统计；reviewedAt 时间范围查询；updated_at 用于记录修改时间
      reviews: 'id, wordId, step, reviewedAt, updated_at',
      // 主键 id(YYYY-MM-DD)；updated_at 用于记录修改时间
      stats: 'id, updated_at',
      // 主键 id；articleId 外键索引支持按文章查询阅读记录；reviewedAt 时间范围查询；updated_at 用于记录修改时间
      readingSessions: 'id, articleId, reviewedAt, updated_at',
      // 主键 id(成就规则 ID)；updated_at 用于记录修改时间
      achievements: 'id, updated_at',
    })

    // 版本 4：为 articles 表新增 contentHash 与 readAt 索引
    // - contentHash：文章内容指纹（基于标题+正文 SHA-256 前 16 位），用于去重判断
    // - readAt：阅读完成时间戳，用于已读历史查询
    // 仅新增索引不修改表结构（Dexie 索引可动态添加，无需数据迁移）
    this.version(4).stores({
      // 主键 id；genre 用于文体筛选；createdAt/updated_at 用于排序与记录修改时间；
      // contentHash 用于去重查询；readAt 用于已读历史排序
      articles: 'id, genre, createdAt, updated_at, contentHash, readAt',
      // 以下表保持与 v3 一致
      questions: 'id, articleId, type, createdAt, updated_at',
      words: 'id, word, sourceArticleId, mastery, nextReview, updated_at',
      reviews: 'id, wordId, step, reviewedAt, updated_at',
      stats: 'id, updated_at',
      readingSessions: 'id, articleId, reviewedAt, updated_at',
      achievements: 'id, updated_at',
    })

    // 版本 5：为 articles 表新增 startedAt 索引
    // - startedAt：开始阅读时间戳，用于追踪用户阅读行为（区分"未开始"与"已开始未完成"）
    // 仅新增索引不修改表结构（Dexie 索引可动态添加，无需数据迁移）
    this.version(5).stores({
      // 主键 id；genre 用于文体筛选；createdAt/updated_at 用于排序与记录修改时间；
      // contentHash 用于去重查询；readAt 用于已读历史排序；startedAt 用于阅读行为追踪
      articles: 'id, genre, createdAt, updated_at, contentHash, readAt, startedAt',
      // 以下表保持与 v4 一致
      questions: 'id, articleId, type, createdAt, updated_at',
      words: 'id, word, sourceArticleId, mastery, nextReview, updated_at',
      reviews: 'id, wordId, step, reviewedAt, updated_at',
      stats: 'id, updated_at',
      readingSessions: 'id, articleId, reviewedAt, updated_at',
      achievements: 'id, updated_at',
    })

    // 版本 6：为 words 表新增 favorite 索引
    // - favorite：收藏标记（0 = 普通生词，1 = 重点收藏），用于「仅看收藏」筛选
    // 仅新增索引不修改表结构（Dexie 索引可动态添加，无需数据迁移）
    this.version(6).stores({
      // 以下表保持与 v5 一致
      articles: 'id, genre, createdAt, updated_at, contentHash, readAt, startedAt',
      questions: 'id, articleId, type, createdAt, updated_at',
      // words 表新增 favorite 索引，支持按收藏状态筛选
      words: 'id, word, sourceArticleId, mastery, nextReview, updated_at, favorite',
      reviews: 'id, wordId, step, reviewedAt, updated_at',
      stats: 'id, updated_at',
      readingSessions: 'id, articleId, reviewedAt, updated_at',
      achievements: 'id, updated_at',
    })

    // 版本 7：新增 aiCache 表（AI 响应永久缓存，突破 localStorage 5MB 上限）
    // - id：主键即缓存 key
    // - scenario：按场景精确清理
    // - updatedAt：LRU 淘汰排序（超出上限时优先淘汰最久未使用）
    this.version(7).stores({
      // 以下表保持与 v6 一致
      articles: 'id, genre, createdAt, updated_at, contentHash, readAt, startedAt',
      questions: 'id, articleId, type, createdAt, updated_at',
      words: 'id, word, sourceArticleId, mastery, nextReview, updated_at, favorite',
      reviews: 'id, wordId, step, reviewedAt, updated_at',
      stats: 'id, updated_at',
      readingSessions: 'id, articleId, reviewedAt, updated_at',
      achievements: 'id, updated_at',
      // AI 响应缓存表：id 主键 + scenario/updatedAt 索引
      aiCache: 'id, scenario, updatedAt',
    })
  }
}

// 单例数据库实例，供全局使用
export const db = new YdxlDatabase()
