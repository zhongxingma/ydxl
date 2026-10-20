// 生词本特性模块的统一导出口
export { default as WordbookPage } from './pages/WordbookPage'
export {
  addToWordbook,
  bulkAddToWordbook,
  updateNote,
  removeFromWordbook,
  bulkRemove,
  getWordbook,
  getWordbookStats,
  enrichWord,
  wordbookService,
} from './services/wordbookService'
export type {
  AddToWordbookParams,
  GetWordbookParams,
  WordbookPage as WordbookPageResult,
} from './services/wordbookService'
export { useWordbookStore, filterAndSortWords } from './store'
export type { SortField, SortOrder, WordbookFilters, WordbookSortBy, WordbookStats } from './types'
