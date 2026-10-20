//
// 基于用户最近阅读历史（topic/genre/difficulty 分布）对未读文章进行相关度评分排序：
// - 同 topic +3 分
// - 同 genre +2 分
// - 同 difficulty +1 分
// - 相关度同为 0 时按 createdAt 倒序
//
// 边界情况：
// - 无历史时返回最近 limit 篇未读文章（按 createdAt 倒序）
// - 全部已读时返回空数组
// - 推荐池不足 limit 篇时返回实际数量
import { articleRepository } from '@/shared/services'
import type { Article } from '@/shared/types'

// 评分权重常量
const SCORE_SAME_TOPIC = 3
const SCORE_SAME_GENRE = 2
const SCORE_SAME_DIFFICULTY = 1

// 用于构建用户偏好的历史样本量
const HISTORY_SAMPLE_SIZE = 10

/**
 * 计算候选文章相对历史偏好集合的相关度评分
 *
 * @param candidate 候选文章
 * @param historyTopics 历史文章出现过的 topic 集合
 * @param historyGenres 历史文章出现过的 genre 集合
 * @param historyDifficulties 历史文章出现过的 difficulty 集合
 * @returns 相关度评分（>=0）
 */
function scoreCandidate(
  candidate: Article,
  historyTopics: Set<string>,
  historyGenres: Set<string>,
  historyDifficulties: Set<string>,
): number {
  let score = 0
  if (candidate.topic && historyTopics.has(candidate.topic)) {
    score += SCORE_SAME_TOPIC
  }
  if (historyGenres.has(candidate.genre)) {
    score += SCORE_SAME_GENRE
  }
  if (candidate.difficulty && historyDifficulties.has(candidate.difficulty)) {
    score += SCORE_SAME_DIFFICULTY
  }
  return score
}

/**
 * 获取推荐文章列表
 *
 * 算法流程：
 * 1. 查询最近 10 篇历史阅读文章（已读完或已开始），提取 topic/genre/difficulty 分布
 * 2. 查询全部文章，过滤掉已读完（readAt != null）与已在推荐池中的文章
 * 3. 按相关度评分排序：同 topic +3 / 同 genre +2 / 同 difficulty +1
 * 4. 相关度同为 0 时按 createdAt 倒序
 * 5. 取前 limit 篇
 *
 * 边界情况：
 * - 无历史阅读记录时，返回最近 limit 篇未读文章（按 createdAt 倒序）
 * - 全部文章已读完时，返回空数组
 * - 未读文章池不足 limit 篇时，返回实际数量
 *
 * @param limit 返回条数上限，默认 6
 * @returns 推荐文章数组；查询失败时返回空数组
 */
export async function getRecommendedArticles(limit: number = 6): Promise<Article[]> {
  // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
  const all = await articleRepository.getAllLocalFirst()

  // 历史阅读文章：已读完或已开始阅读的，按 readAt ?? startedAt ?? createdAt 倒序取最近 10 篇
  const historyArticles = all
    .filter((a) => a.readAt != null || a.startedAt != null)
    .sort((a, b) => {
      const aTime = a.readAt ?? a.startedAt ?? a.createdAt
      const bTime = b.readAt ?? b.startedAt ?? b.createdAt
      return bTime - aTime
    })
    .slice(0, HISTORY_SAMPLE_SIZE)

  // 未读文章池：过滤掉已读完的（readAt != null）
  const unreadPool = all.filter((a) => a.readAt == null)

  // 边界：全部已读 → 返回空数组
  if (unreadPool.length === 0) {
    return []
  }

  // 边界：无历史 → 返回最近 limit 篇未读文章（按 createdAt 倒序）
  if (historyArticles.length === 0) {
    return unreadPool
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  // 构建历史偏好集合
  const historyTopics = new Set<string>()
  const historyGenres = new Set<string>()
  const historyDifficulties = new Set<string>()
  for (const a of historyArticles) {
    if (a.topic) historyTopics.add(a.topic)
    historyGenres.add(a.genre)
    if (a.difficulty) historyDifficulties.add(a.difficulty)
  }

  // 评分 + 排序：相关度降序，同为 0 时按 createdAt 倒序
  const scored = unreadPool
    .map((article) => ({
      article,
      score: scoreCandidate(article, historyTopics, historyGenres, historyDifficulties),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.article.createdAt - a.article.createdAt
    })

  return scored.slice(0, limit).map((item) => item.article)
}

export const recommendationService = {
  getRecommendedArticles,
}
