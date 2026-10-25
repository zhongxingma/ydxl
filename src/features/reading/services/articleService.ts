// 每日文章服务统一出口
//
// 实现拆分：
// - articleGenerationService：AI 生成、contentHash/标题去重、兜底素材库、主题注入
// - articleReadService：已读/开始阅读标记、历史与最近阅读查询、按 id 查询、短语补全
// - articleErrors：ArticleNotFoundError
//
// 本文件仅做聚合导出，调用方导入路径保持不变。
import {
  generateArticle,
  getDailyArticle,
  saveArticle,
} from './articleGenerationService'
import {
  ensureArticlePhrases,
  getArticleById,
  getReadHistory,
  getRecentlyReadArticles,
  getTodayReadCount,
  markAsRead,
  recordReadingStart,
} from './articleReadService'

export { ArticleNotFoundError } from './articleErrors'
export type { GetDailyArticleOptions } from './articleGenerationService'
export {
  generateArticle,
  getDailyArticle,
  getRecentTopics,
  normalizeTitleForDedupe,
  saveArticle,
} from './articleGenerationService'
export type { RecentlyReadArticle } from './articleReadService'
export {
  ensureArticlePhrases,
  getArticleById,
  getReadHistory,
  getRecentlyReadArticles,
  getTodayReadCount,
  markAsRead,
  recordReadingStart,
} from './articleReadService'

export const articleService = {
  getDailyArticle,
  generateArticle,
  saveArticle,
  markAsRead,
  recordReadingStart,
  getReadHistory,
  getRecentlyReadArticles,
  getTodayReadCount,
  getArticleById,
  ensureArticlePhrases,
}
