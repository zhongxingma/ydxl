// 生词本状态管理：列表数据、过滤条件、选中集合、加载状态
import { logger } from '../../shared/utils/logger'
import { create } from 'zustand'
import { wordRepository } from '@/shared/services'
import type { Word } from '@/shared/types'
import type { SortField, SortOrder, WordbookFilters } from './types'
import { wordbookService } from './services/wordbookService'

// 默认过滤条件：搜索为空、按添加时间倒序（最新优先）、不筛选收藏
const DEFAULT_FILTERS: WordbookFilters = {
  search: '',
  sortField: 'createdAt',
  sortOrder: 'desc',
  onlyFavorite: false,
}

// 生词本状态接口
interface WordbookState {
  // 全部生词（从 DB 读取的原始数据）
  words: Word[]
  // 过滤条件
  filters: WordbookFilters
  // 选中的生词 id 集合
  selectedIds: Set<string>
  // 加载状态
  loading: boolean

  // 加载生词列表（从 DB 读取全部）
  loadWords: () => Promise<void>
  // 设置搜索关键字
  setSearch: (search: string) => void
  // 设置排序字段与方向
  setSort: (field: SortField, order: SortOrder) => void
  // 切换单个选中状态
  toggleSelect: (id: string) => void
  // 全选（当前过滤后的全部生词）
  selectAll: () => void
  // 反选（当前过滤后的全部生词）
  invertSelection: () => void
  // 清空选中
  clearSelection: () => void
  // 删除所有选中的生词
  deleteSelected: () => Promise<void>
  // 删除单个生词
  removeWord: (id: string) => Promise<void>
}

// 按 filters 过滤与排序生词列表（纯函数，供组件派生显示列表）
// - 搜索匹配：单词前缀（首字母/全拼）或中文释义包含
// - 大小写不敏感
// - onlyFavorite 参数：为 true 时仅保留 favorite === 1 的单词（默认 false，不筛选）
export function filterAndSortWords(
  words: Word[],
  filters: WordbookFilters,
  onlyFavorite: boolean = false,
): Word[] {
  const { search, sortField, sortOrder } = filters
  const query = search.trim().toLowerCase()

  // 1. 过滤：onlyFavorite 为 true 时仅保留 favorite === 1 的单词
  //    （word.favorite 为 undefined 或 0 时不匹配，因为 undefined !== 1）
  const favoriteFiltered = onlyFavorite
    ? words.filter((w) => w.favorite === 1)
    : words

  // 2. 过滤：搜索关键字
  const searchFiltered = query
    ? favoriteFiltered.filter(
        (w) =>
          // 单词前缀匹配（覆盖首字母与全拼）
          w.word.toLowerCase().startsWith(query) ||
          // 中文释义包含匹配
          w.definition.toLowerCase().includes(query),
      )
    : favoriteFiltered

  // 3. 排序
  const sorted = [...searchFiltered].sort((a, b) => {
    let cmp = 0
    if (sortField === 'createdAt') {
      cmp = a.createdAt - b.createdAt
    } else if (sortField === 'lastReview') {
      cmp = a.lastReview - b.lastReview
    } else if (sortField === 'alphabetical') {
      cmp = a.word.localeCompare(b.word)
    } else {
      // mastery
      cmp = a.mastery - b.mastery
    }
    return sortOrder === 'asc' ? cmp : -cmp
  })

  return sorted
}

export const useWordbookStore = create<WordbookState>((set, get) => ({
  words: [],
  filters: DEFAULT_FILTERS,
  selectedIds: new Set<string>(),
  loading: false,

  loadWords: async () => {
    set({ loading: true })
    try {
      const words = await wordRepository.getAll()
      set({ words, loading: false })
    } catch (err) {
      logger.warn('[wordbookStore] 加载生词列表失败', err)
      set({ loading: false })
    }
  },

  setSearch: (search) =>
    set((state) => ({ filters: { ...state.filters, search } })),

  setSort: (field, order) =>
    set((state) => ({
      filters: { ...state.filters, sortField: field, sortOrder: order },
    })),

  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { selectedIds: next }
    }),

  selectAll: () =>
    set((state) => {
      const filtered = filterAndSortWords(state.words, state.filters)
      return { selectedIds: new Set(filtered.map((w) => w.id)) }
    }),

  invertSelection: () =>
    set((state) => {
      const filtered = filterAndSortWords(state.words, state.filters)
      const next = new Set<string>()
      for (const w of filtered) {
        if (state.selectedIds.has(w.id)) {
          continue
        }
        next.add(w.id)
      }
      return { selectedIds: next }
    }),

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  deleteSelected: async () => {
    const { selectedIds } = get()
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    await wordbookService.bulkRemove(ids)
    set({ selectedIds: new Set<string>() })
    await get().loadWords()
  },

  removeWord: async (id) => {
    await wordbookService.removeFromWordbook(id)
    // 删除后从 selectedIds 中移除并重新加载列表
    set((state) => {
      const next = new Set(state.selectedIds)
      next.delete(id)
      return { selectedIds: next }
    })
    await get().loadWords()
  },
}))
