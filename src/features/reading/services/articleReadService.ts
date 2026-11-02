// 文章阅读查询与阅读状态服务
//
// 负责：已读/开始阅读标记、历史与最近阅读查询、今日已读数、按 id 查询、短语补全。
// 文章生成与每日获取见 ./articleGenerationService。
import { logger } from '../../../shared/utils/logger'
import { aiProvider } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import type { Article, ArticlePhrase, Difficulty, Topic } from '@/shared/types'
import { ArticleNotFoundError } from './articleErrors'

// 仅包含首页「最近阅读」区块展示所需的字段，排除 content/translation 等大字段
export interface RecentlyReadArticle {
  id: string
  title: string
  readAt: number
  topic?: Topic
  difficulty?: Difficulty
  wordCount: number
}

/**
 * 标记文章为已读（更新 readAt 时间戳）
 * best-effort：标记失败不影响阅读主流程
 *
 * @param articleId 文章主键
 * @returns 是否成功写入（失败时调用方可提示用户）
 */
export async function markAsRead(articleId: string): Promise<boolean> {
  try {
    // 依赖 CachedRemoteRepository.update 的 404 兜底逻辑：
    // 远程 404 时已降级写入本地缓存并返回 fallback 对象，不抛错
    // 此处 catch 仅处理 500/网络错误等非 404 异常
    await articleRepository.update(articleId, { readAt: Date.now() })
    return true
  } catch (err) {
    // 服务器异常时标记失败不影响主流程（best-effort）
    logger.warn('[articleService] markAsRead 失败', err)
    return false
  }
}

/**
 * 记录用户开始阅读文章（更新 startedAt 时间戳）
 * best-effort：标记失败不影响阅读主流程
 * 与 markAsRead 区别：markAsRead 标记阅读完成，recordReadingStart 标记开始阅读
 *
 * @param articleId 文章主键
 * @returns 是否成功写入
 */
export async function recordReadingStart(articleId: string): Promise<boolean> {
  try {
    // 依赖 CachedRemoteRepository.update 的 404 兜底逻辑：
    // 远程 404 时已降级写入本地缓存并返回 fallback 对象，不抛错
    // 此处 catch 仅处理 500/网络错误等非 404 异常
    await articleRepository.update(articleId, { startedAt: Date.now() })
    return true
  } catch (err) {
    // 服务器异常时标记失败不影响主流程（best-effort）
    logger.warn('[articleService] recordReadingStart 失败', err)
    return false
  }
}

/**
 * 获取阅读历史文章（已读完或已开始阅读的）
 * 过滤条件：readAt != null || startedAt != null
 * 排序规则：按 readAt ?? startedAt ?? createdAt 倒序
 * 分页：slice(offset, offset + limit)
 *
 * @param limit 返回条数上限，默认 50
 * @param offset 起始偏移量，默认 0
 * @returns 历史文章数组；查询失败时返回空数组
 */
export async function getReadHistory(limit: number = 50, offset: number = 0): Promise<Article[]> {
  // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
  const all = await articleRepository.getAllLocalFirst()
  return all
    .filter((a) => a.readAt != null || a.startedAt != null)
    .sort((a, b) => {
      const aTime = a.readAt ?? a.startedAt ?? a.createdAt
      const bTime = b.readAt ?? b.startedAt ?? b.createdAt
      return bTime - aTime
    })
    .slice(offset, offset + limit)
}

/**
 * 用于首页「最近阅读」快捷区块展示。
 * 查询条件：readAt != null（仅已读完的文章）
 * 排序规则：按 readAt 降序（最近阅读的在前）
 * 返回精简字段：id, title, readAt, topic, difficulty, wordCount
 * 排除 content/translation/highlightedWords 等大字段，减少传输与渲染开销
 *
 * @param limit 返回条数上限
 * @returns 精简字段文章数组，按 readAt 降序；查询失败时返回空数组
 * @throws 内部捕获异常，不会向外抛出（best-effort，不阻塞首页加载）
 */
export async function getRecentlyReadArticles(
  limit: number,
): Promise<RecentlyReadArticle[]> {
  try {
    // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
    const all = await articleRepository.getAllLocalFirst()
    return all
      .filter((a): a is Article & { readAt: number } => a.readAt != null)
      .sort((a, b) => b.readAt - a.readAt)
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        title: a.title,
        readAt: a.readAt,
        topic: a.topic,
        difficulty: a.difficulty,
        wordCount: a.wordCount,
      }))
  } catch (err) {
    // 查询失败时返回空数组，不阻塞首页加载
    if (import.meta.env.DEV)
      logger.warn('[articleService] getRecentlyReadArticles 查询失败', err)
    return []
  }
}

/**
 * 查询今日已读文章数
 * 过滤条件：readAt 不为 null 且在今日 0:00:00-23:59:59 之间
 * 使用 articleRepository.getAllLocalFirst() 过滤（本地优先，数据量不大可接受）
 *
 * @returns 今日已读文章数；查询失败时返回 0
 */
export async function getTodayReadCount(): Promise<number> {
  try {
    // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
    const all = await articleRepository.getAllLocalFirst()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)
    const startMs = todayStart.getTime()
    const endMs = todayEnd.getTime()
    return all.filter((a) => a.readAt != null && a.readAt >= startMs && a.readAt <= endMs).length
  } catch (err) {
    logger.warn('[articleService] getTodayReadCount 查询失败', err)
    return 0
  }
}

/**
 * 根据 id 获取文章（本地优先，离线可用）
 *
 * 实现说明：
 * - 调用 articleRepository.getByIdLocalFirst(id)（SWR 模式）：
 *   - 本地缓存命中时立即返回，后台异步刷新该条记录
 *   - 本地未命中时同步等待远程拉取，写入本地后返回
 * - 服务器 404 时 localApi.getById 内部已转换为 undefined 返回；
 *   getByIdLocalFirst 在本地未命中且远程返回 undefined 时返回 undefined
 * - 本方法将 undefined 统一转换为 ArticleNotFoundError 抛出，便于 UI 层友好提示
 * - 其他非 404 错误（如 500、网络错误且本地缓存查询也失败）向上抛出，不静默吞错
 *
 * @param id 文章 id
 * @returns 完整 Article 对象（含 content/translation/highlightedWords/phrases 等字段）
 * @throws {ArticleNotFoundError} 当文章不存在（服务器 404 或本地缓存未命中）时抛出
 * @throws {Error} 当服务器不可用且本地缓存查询失败等非 404 异常时抛出
 */
export async function getArticleById(id: string): Promise<Article> {
  let article: Article | undefined
  try {
    article = await articleRepository.getByIdLocalFirst(id)
  } catch (err) {
    // 服务器 404 错误（CachedRemoteRepository 回退本地时一般不会抛 404，
    // 此处兜底处理 localApi 层未被转换的 404 异常）
    if (err instanceof Error && err.message.includes('404')) {
      throw new ArticleNotFoundError(id)
    }
    // 非 404 错误（500/网络错误等）向上抛出，不静默吞错
    throw err
  }
  if (!article) {
    throw new ArticleNotFoundError(id)
  }
  return article
}

/**
 * 确保文章有重点短语：已有则直接返回，缺失则调用 AI 提取并写回
 *
 * 用于历史文章（功能上线前生成，article.phrases 为 undefined）的短语补全。
 * 提取后写回 articleRepository 持久化，下次打开不再调用 AI。
 *
 * @param article 文章实体
 * @returns 短语数组（可能为空，表示提取失败或文章无合适短语）
 */
export async function ensureArticlePhrases(article: Article): Promise<ArticlePhrase[]> {
  // 已有短语直接返回
  if (article.phrases && article.phrases.length > 0) {
    return article.phrases
  }
  try {
    const phrases = await aiProvider.extractArticlePhrases(article.content)
    // 写回 articleRepository 持久化（best-effort，失败不阻塞）
    if (phrases.length > 0) {
      try {
        await articleRepository.update(article.id, { phrases })
      } catch (writeErr) {
        logger.warn('[articleService] 短语写回失败，仅返回不持久化', writeErr)
      }
    }
    return phrases
  } catch (err) {
    logger.warn('[articleService] 文章短语提取失败，静默降级', err)
    return []
  }
}
