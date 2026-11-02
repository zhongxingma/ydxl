// 兜底素材库：AI 接口不可用时随机抽取一篇作为今日阅读
// 素材数据外置在 fallback-articles.json（13 篇，每篇 200-300 词），运营增补无需改动逻辑代码
// 覆盖记叙文 / 说明文 / 应用文三种文体，题材含 campus / science / culture / biography / nature
import type { ArticleGenerationResult } from '@/shared/services/ai'
import fallbackArticleData from './fallback-articles.json'

// 兜底文章类型（不含 id 与时间戳，由调用方在落库时补齐）
export type FallbackArticle = ArticleGenerationResult

// JSON 字段被推断为宽泛类型，此处收敛为领域类型（数据契约由本目录 JSON 维护）
export const fallbackArticles = fallbackArticleData as unknown as FallbackArticle[]

// 从兜底素材库随机抽取一篇
export function pickRandomFallbackArticle(): FallbackArticle {
  const idx = Math.floor(Math.random() * fallbackArticles.length)
  return fallbackArticles[idx] ?? fallbackArticles[0]
}

// 兜底素材库全部篇目（供调用方计算 contentHash 集合，与本地已有文章做去重比对）
export function getAllFallbackArticles(): FallbackArticle[] {
  return fallbackArticles
}
