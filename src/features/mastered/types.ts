// 已掌握单词模块的类型定义

// 已掌握列表分页排序方式（Task 5.2）
// - 'alphabet'：按字母升序
// - 'masteredAt-desc'：按最近掌握时间降序（默认）
//   注：Word 实体无独立的 masteredAt 字段，使用 lastReview（最近一次复习时间）
//   作为掌握时间代理，因为单词在复习中达到 mastery >= 5 即视为掌握
// - 'createdAt-desc'：按添加时间降序
export type MasteredSortBy = 'alphabet' | 'masteredAt-desc' | 'createdAt-desc'
