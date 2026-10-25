// 生词本服务聚合出口
//
// 按职责拆分：
//   - wordbookMutationService.ts：添加/批量添加/笔记/删除/收藏
//   - wordbookQueryService.ts：列表分页筛选排序/统计计数
//   - wordEnrichmentService.ts：AI 补全缺失字段
//
// 调用方仍从 './wordbookService' 导入，聚合对象保持原有方法集合。
import {
  addToWordbook,
  bulkAddToWordbook,
  bulkRemove,
  removeFromWordbook,
  toggleFavorite,
  updateNote,
} from './wordbookMutationService'
import { getWordbook, getWordbookStats } from './wordbookQueryService'
import { enrichWord } from './wordEnrichmentService'

export type { AddToWordbookParams } from './wordbookMutationService'
export type { GetWordbookParams, WordbookPage } from './wordbookQueryService'
export { enrichWord }
export {
  addToWordbook,
  bulkAddToWordbook,
  bulkRemove,
  removeFromWordbook,
  toggleFavorite,
  updateNote,
}
export { getWordbook, getWordbookStats }

export const wordbookService = {
  addToWordbook,
  bulkAddToWordbook,
  updateNote,
  removeFromWordbook,
  bulkRemove,
  getWordbook,
  getWordbookStats,
  enrichWord,
  toggleFavorite,
}
