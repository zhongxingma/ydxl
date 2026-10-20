// Repository 实例集中定义
// 策略：服务器为主（REST API），Dexie（IndexedDB）作为离线只读缓存
// - 读取：先请求服务器，失败则回退本地缓存
// - 写入：写入服务器，成功后同步更新本地缓存
import { db } from './db'
import { Repository } from './repository'
import { RemoteRepository, CachedRemoteRepository } from './remoteRepository'
import type {
  Achievement,
  Article,
  Question,
  ReadingSession,
  Review,
  Stats,
  Word,
} from '@/shared/types'

/**
 * 生词本数据访问对象（扩展 Repository，新增按稳固度排序等查询）
 * 继承全部通用 CRUD，保持向后兼容（作为离线缓存使用）
 */
export class WordRepository extends Repository<Word> {
  /**
   * 获取按 stabilityScore 降序排列的单词列表
   * - stabilityScore 缺失视为 0
   * - 用于"稳固度排行"或"最薄弱词优先"场景
   */
  async getByStabilityDesc(): Promise<Word[]> {
    const all = await this.getAll()
    return all.sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0))
  }
}

// 本地 Repository 实例（Dexie，作为离线只读缓存）
// 导出供 storageManager 等模块使用（dynamic import 避免循环依赖）
export const localArticleRepo = new Repository<Article>(db.articles)
export const localQuestionRepo = new Repository<Question>(db.questions)
export const localWordRepo = new WordRepository(db.words)
export const localReviewRepo = new Repository<Review>(db.reviews)
export const localStatsRepo = new Repository<Stats>(db.stats)
export const localReadingSessionRepo = new Repository<ReadingSession>(db.readingSessions)
export const localAchievementRepo = new Repository<Achievement>(db.achievements)

// 服务器为主 Repository 实例（REST API 优先，Dexie 作为离线只读缓存）
// basePath 对应 server 端的路由名（articles/questions/words/reviews/stats/readingSessions/achievements）
// 第三参数 tableName 与 basePath 保持一致，用于 cacheEvents 事件总线精确通知
export const articleRepository = new CachedRemoteRepository<Article>(
  new RemoteRepository<Article>('articles'),
  localArticleRepo,
  'articles',
)
// 阅读题数据访问对象
export const questionRepository = new CachedRemoteRepository<Question>(
  new RemoteRepository<Question>('questions'),
  localQuestionRepo,
  'questions',
)
// 生词本数据访问对象
export const wordRepository = new CachedRemoteRepository<Word>(
  new RemoteRepository<Word>('words'),
  localWordRepo,
  'words',
)
// 复习记录数据访问对象
export const reviewRepository = new CachedRemoteRepository<Review>(
  new RemoteRepository<Review>('reviews'),
  localReviewRepo,
  'reviews',
)
// 学习统计数据访问对象
export const statsRepository = new CachedRemoteRepository<Stats>(
  new RemoteRepository<Stats>('stats'),
  localStatsRepo,
  'stats',
)
// 阅读会话记录数据访问对象
export const readingSessionRepository = new CachedRemoteRepository<ReadingSession>(
  new RemoteRepository<ReadingSession>('readingSessions'),
  localReadingSessionRepo,
  'readingSessions',
)
// 成就数据访问对象
export const achievementRepository = new CachedRemoteRepository<Achievement>(
  new RemoteRepository<Achievement>('achievements'),
  localAchievementRepo,
  'achievements',
)
