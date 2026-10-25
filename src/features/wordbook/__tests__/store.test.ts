//
// 生词本状态管理
//
// 测试范围：
// 1. filterAndSortWords：搜索 / 收藏过滤 / 四种排序字段与方向
// 2. store actions：加载、搜索与排序、勾选、全选 / 反选 / 清空、批量与单个删除

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Word } from '@/shared/types'
import type { WordbookFilters } from '../types'

vi.mock('@/shared/services', () => ({
  wordRepository: {
    getAll: vi.fn(),
  },
}))

vi.mock('../services/wordbookService', () => ({
  wordbookService: {
    bulkRemove: vi.fn().mockResolvedValue(undefined),
    removeFromWordbook: vi.fn().mockResolvedValue(undefined),
  },
}))

import { wordRepository } from '@/shared/services'
import { wordbookService } from '../services/wordbookService'
import { filterAndSortWords, useWordbookStore } from '../store'

const getAllMock = vi.mocked(wordRepository.getAll)
const bulkRemoveMock = vi.mocked(wordbookService.bulkRemove)
const removeFromWordbookMock = vi.mocked(wordbookService.removeFromWordbook)

// 构造 Word 对象（提供合理默认值）
function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

function makeFilters(overrides: Partial<WordbookFilters> = {}): WordbookFilters {
  return {
    search: '',
    sortField: 'createdAt',
    sortOrder: 'desc',
    onlyFavorite: false,
    ...overrides,
  }
}

const DEFAULT_FILTERS = makeFilters()

function resetStore(): void {
  useWordbookStore.setState({
    words: [],
    filters: DEFAULT_FILTERS,
    selectedIds: new Set<string>(),
    loading: false,
  })
}

describe('wordbook store - filterAndSortWords', () => {
  it('alphabetical 升序：apple 排在 banana 前', () => {
    const words: Word[] = [
      makeWord('banana', { word: 'banana' }),
      makeWord('apple', { word: 'apple' }),
      makeWord('cherry', { word: 'cherry' }),
    ]
    const filters = makeFilters({ sortField: 'alphabetical', sortOrder: 'asc' })

    const result = filterAndSortWords(words, filters)

    expect(result.map((w) => w.word)).toEqual(['apple', 'banana', 'cherry'])
  })

  it('alphabetical 降序：banana 排在 apple 前', () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
      makeWord('cherry', { word: 'cherry' }),
    ]
    const filters = makeFilters({ sortField: 'alphabetical', sortOrder: 'desc' })

    const result = filterAndSortWords(words, filters)

    expect(result.map((w) => w.word)).toEqual(['cherry', 'banana', 'apple'])
  })

  it('搜索：按单词前缀匹配且大小写不敏感', () => {
    const words = [makeWord('apple', { word: 'Apple' }), makeWord('banana', { word: 'banana' })]
    const filters = makeFilters({ search: '  ap ' })

    expect(filterAndSortWords(words, filters).map((w) => w.word)).toEqual(['Apple'])
  })

  it('搜索：按中文释义包含匹配', () => {
    const words = [
      makeWord('apple', { word: 'apple', definition: '苹果' }),
      makeWord('banana', { word: 'banana', definition: '香蕉' }),
    ]
    const filters = makeFilters({ search: '苹果' })

    expect(filterAndSortWords(words, filters).map((w) => w.word)).toEqual(['apple'])
  })

  it('onlyFavorite 为 true 时仅保留 favorite === 1 的单词', () => {
    const words = [
      makeWord('fav', { favorite: 1 }),
      makeWord('not-fav', { favorite: 0 }),
      makeWord('unset'),
    ]

    expect(filterAndSortWords(words, makeFilters(), true).map((w) => w.id)).toEqual(['fav'])
    expect(filterAndSortWords(words, makeFilters(), false)).toHaveLength(3)
  })

  it('按 createdAt / lastReview / mastery 排序并支持升降序', () => {
    const words = [
      makeWord('a', { createdAt: 10, lastReview: 30, mastery: 2 }),
      makeWord('b', { createdAt: 30, lastReview: 10, mastery: 0 }),
      makeWord('c', { createdAt: 20, lastReview: 20, mastery: 1 }),
    ]

    expect(
      filterAndSortWords(words, makeFilters({ sortField: 'createdAt', sortOrder: 'asc' })).map((w) => w.id),
    ).toEqual(['a', 'c', 'b'])
    expect(
      filterAndSortWords(words, makeFilters({ sortField: 'createdAt', sortOrder: 'desc' })).map((w) => w.id),
    ).toEqual(['b', 'c', 'a'])
    expect(
      filterAndSortWords(words, makeFilters({ sortField: 'lastReview', sortOrder: 'asc' })).map((w) => w.id),
    ).toEqual(['b', 'c', 'a'])
    expect(
      filterAndSortWords(words, makeFilters({ sortField: 'mastery', sortOrder: 'desc' })).map((w) => w.id),
    ).toEqual(['a', 'c', 'b'])
  })
})

describe('wordbook store - actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    getAllMock.mockResolvedValue([])
  })

  it('loadWords：加载成功写入列表并结束 loading', async () => {
    const words = [makeWord('a')]
    getAllMock.mockResolvedValue(words)

    await useWordbookStore.getState().loadWords()

    expect(useWordbookStore.getState().words).toEqual(words)
    expect(useWordbookStore.getState().loading).toBe(false)
  })

  it('loadWords：加载失败告警、结束 loading 且保留原列表', async () => {
    const existing = [makeWord('existing')]
    useWordbookStore.setState({ words: existing })
    getAllMock.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useWordbookStore.getState().loadWords()

    expect(warnSpy).toHaveBeenCalledWith('[wordbookStore] 加载生词列表失败', expect.any(Error))
    expect(useWordbookStore.getState().words).toEqual(existing)
    expect(useWordbookStore.getState().loading).toBe(false)
  })

  it('setSearch / setSort 仅更新对应过滤条件', () => {
    useWordbookStore.getState().setSearch('apple')
    expect(useWordbookStore.getState().filters).toEqual({
      ...DEFAULT_FILTERS,
      search: 'apple',
    })

    useWordbookStore.getState().setSort('mastery', 'asc')
    expect(useWordbookStore.getState().filters).toEqual({
      ...DEFAULT_FILTERS,
      search: 'apple',
      sortField: 'mastery',
      sortOrder: 'asc',
    })
  })

  it('toggleSelect：点击切换选中状态', () => {
    useWordbookStore.getState().toggleSelect('a')
    expect(useWordbookStore.getState().selectedIds.has('a')).toBe(true)

    useWordbookStore.getState().toggleSelect('a')
    expect(useWordbookStore.getState().selectedIds.has('a')).toBe(false)
  })

  it('selectAll：仅选中当前过滤结果', () => {
    useWordbookStore.setState({
      words: [makeWord('apple', { word: 'apple' }), makeWord('banana', { word: 'banana' })],
      filters: makeFilters({ search: 'ap' }),
    })

    useWordbookStore.getState().selectAll()

    expect([...useWordbookStore.getState().selectedIds]).toEqual(['apple'])
  })

  it('invertSelection：对当前过滤结果反选', () => {
    useWordbookStore.setState({
      words: [makeWord('apple', { word: 'apple' }), makeWord('banana', { word: 'banana' })],
      selectedIds: new Set(['apple']),
    })

    useWordbookStore.getState().invertSelection()

    expect([...useWordbookStore.getState().selectedIds]).toEqual(['banana'])
  })

  it('clearSelection：清空选中集合', () => {
    useWordbookStore.setState({ selectedIds: new Set(['a', 'b']) })

    useWordbookStore.getState().clearSelection()

    expect(useWordbookStore.getState().selectedIds.size).toBe(0)
  })

  it('deleteSelected：无选中时不调用删除接口', async () => {
    await useWordbookStore.getState().deleteSelected()

    expect(bulkRemoveMock).not.toHaveBeenCalled()
  })

  it('deleteSelected：批量删除后清空选中并重新加载', async () => {
    useWordbookStore.setState({
      words: [makeWord('a'), makeWord('b')],
      selectedIds: new Set(['a', 'b']),
    })

    await useWordbookStore.getState().deleteSelected()

    expect(bulkRemoveMock).toHaveBeenCalledWith(['a', 'b'])
    expect(useWordbookStore.getState().selectedIds.size).toBe(0)
    expect(getAllMock).toHaveBeenCalledTimes(1)
  })

  it('removeWord：删除单个词、移除选中并重新加载', async () => {
    useWordbookStore.setState({
      words: [makeWord('a'), makeWord('b')],
      selectedIds: new Set(['a', 'b']),
    })

    await useWordbookStore.getState().removeWord('a')

    expect(removeFromWordbookMock).toHaveBeenCalledWith('a')
    expect(useWordbookStore.getState().selectedIds.has('a')).toBe(false)
    expect(useWordbookStore.getState().selectedIds.has('b')).toBe(true)
    expect(getAllMock).toHaveBeenCalledTimes(1)
  })
})
