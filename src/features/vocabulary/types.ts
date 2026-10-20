// 重点词汇汇总模块类型定义
//
// 数据来源：已读文章的 Article.vocabulary 字段（AI 提取并增强后随文章持久化），
// 与重点短语模块（features/phrases）的数据结构模式保持一致
import type { ArticleVocabulary } from '@/shared/types'

// 带来源信息的重点词汇条目：扩展 ArticleVocabulary，附加来源文章信息
export interface VocabularyWithSource extends ArticleVocabulary {
  articleId: string // 来源文章 id（用于跳转原文）
  articleTitle: string // 来源文章标题
  readAt: number // 阅读完成时间戳（用于按日期分组）
}

// 按阅读日期分组的重点词汇
export interface VocabularyGroup {
  date: string // 日期键 YYYY-MM-DD
  dateLabel: string // 展示标签（今天 / 昨天 / N 天前 / YYYY-MM-DD）
  vocabularies: VocabularyWithSource[] // 组内词汇（按文章顺序保留）
}
