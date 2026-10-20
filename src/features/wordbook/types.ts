// 生词本特性模块的类型定义

// 排序字段：添加时间 / 复习时间 / 掌握程度 / 字母顺序
export type SortField = 'createdAt' | 'lastReview' | 'mastery' | 'alphabetical'

// 排序方向：升序 / 降序
export type SortOrder = 'asc' | 'desc'

// 生词本分页排序方式（Task 6.1）
// - 'alphabet'：按字母升序
// - 'createdAt-desc'：按添加时间降序（默认）
// - 'nextReview-asc'：按下次复习时间升序
export type WordbookSortBy = 'alphabet' | 'createdAt-desc' | 'nextReview-asc'

// 生词本列表过滤条件
export interface WordbookFilters {
  // 搜索关键字（匹配单词首字母、全拼、中文释义）
  search: string
  // 排序字段
  sortField: SortField
  // 排序方向
  sortOrder: SortOrder
  // 仅看收藏（true 时仅展示 favorite === 1 的单词）
  onlyFavorite: boolean
}

// 生词本统计数据
export interface WordbookStats {
  // 全部生词数
  total: number
  // 已掌握数量（mastery >= 5）
  mastered: number
  // 待复习数量（nextReview <= 当前时间）
  pendingReview: number
}
