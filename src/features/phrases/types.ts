// 重点短语汇总模块类型定义
import type { ArticlePhrase } from '@/shared/types'

// 带来源文章信息的短语（用于汇总页展示短语及其出处）
export interface PhraseWithSource extends ArticlePhrase {
  // 来源文章 id（用于点击跳转回原文）
  articleId: string
  // 来源文章标题（背面展示出处）
  articleTitle: string
  // 阅读完成时间戳（用于按日期分组）
  readAt: number
}

// 按日期分组的短语集合
export interface PhraseGroup {
  // YYYY-MM-DD 格式，用于排序与分组键
  date: string
  // 显示用标签（如「今天」、「昨天」、「2026-08-05」）
  dateLabel: string
  // 该日期下的所有短语
  phrases: PhraseWithSource[]
}
