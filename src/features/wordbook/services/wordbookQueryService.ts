// 生词本查询服务：列表分页/筛选/排序与统计计数
import { wordRepository } from '@/shared/services'
import type { Word } from '@/shared/types'
import type { WordbookSortBy, WordbookStats } from '../types'

// - limit/offset/keyword/sortBy 均为可选，不传参时返回全部未掌握单词
// - onlyFavorite 为 true 时仅返回 favorite === 1 的单词（扩展筛选）
export interface GetWordbookParams {
  // 分页大小（不传或 <=0 时返回全部）
  limit?: number
  // 分页偏移量（默认 0）
  offset?: number
  // 搜索关键字：在 word 字段中模糊匹配（大小写不敏感）
  keyword?: string
  // 排序方式：'alphabet' / 'createdAt-desc'（默认）/ 'nextReview-asc'
  sortBy?: WordbookSortBy
  // 仅看收藏：为 true 时仅返回 favorite === 1 的单词
  onlyFavorite?: boolean
}

export interface WordbookPage {
  // 当前页的生词列表
  items: Word[]
  // 过滤后（未掌握 + keyword + onlyFavorite）的生词总数
  total: number
  // 本次查询使用的 limit（未传时为 total）
  limit: number
  // 本次查询使用的 offset
  offset: number
}

/**
 * - 从 wordRepository.getAll() 获取全部生词（服务器为主，离线回退本地缓存）
 * - 过滤已掌握单词（mastery >= 5），仅返回未掌握单词
 * - 按 keyword 在 word 字段中模糊匹配（大小写不敏感）
 * - onlyFavorite 为 true 时仅保留 favorite === 1 的单词
 * - 按 sortBy 排序：'alphabet'（字母升序）/ 'createdAt-desc'（添加时间降序，默认）/ 'nextReview-asc'（下次复习时间升序）
 * - 应用 limit/offset 分页；不传 limit 或 limit <= 0 时返回全部
 * - 返回 { items, total, limit, offset }，total 为过滤后（未掌握 + keyword + onlyFavorite）的总数
 *
 * @param params 分页查询参数：limit、offset、keyword、sortBy、onlyFavorite（均可选）
 * @returns WordbookPage 包含 items/total/limit/offset
 * @throws 当 wordRepository.getAll 失败时抛出
 */
export async function getWordbook(params: GetWordbookParams = {}): Promise<WordbookPage> {
  const {
    limit,
    offset = 0,
    keyword,
    sortBy = 'createdAt-desc',
    onlyFavorite = false,
  } = params
  const query = keyword?.trim().toLowerCase()
  // 有效分页大小：limit 未传或 <= 0 时为 null（返回全部）
  const pageLimit: number | null =
    typeof limit === 'number' && limit > 0 ? limit : null

  // 统一的记录匹配条件：未掌握 + 收藏筛选 + 关键字模糊匹配
  const matchFilter = (w: Word): boolean =>
    w.mastery < 5 &&
    (!onlyFavorite || w.favorite === 1) &&
    (!query || w.word.toLowerCase().includes(query))

  // 1. 查询下沉：本地缓存非空时走 Dexie 索引有序扫描（orderBy + filter + offset/limit），
  //    首屏分页在命中 limit 后提前终止，避免 getAll 全表加载后在内存中过滤排序；
  //    triggerRefresh 保持原 SWR 语义（后台刷新完成后通过 cacheEvents 通知列表重载）
  const cachedCount = await wordRepository.countLocal()
  if (cachedCount > 0) {
    wordRepository.triggerRefresh()
    const total = await wordRepository.countMatching(matchFilter)

    if (sortBy === 'alphabet') {
      // 字母序需与 localeCompare 语义一致（索引按 UTF-16 码元排序，大小写顺序不同），
      // 故索引扫描后仍按 localeCompare 排序，再切片分页
      const matched = await wordRepository.queryOrdered({ orderBy: 'word', filter: matchFilter })
      matched.sort((a, b) => a.word.localeCompare(b.word))
      const items =
        pageLimit != null
          ? matched.slice(offset, offset + pageLimit)
          : matched.slice(offset)
      return { items, total, limit: pageLimit ?? total, offset }
    }

    // createdAt-desc（默认）/ nextReview-asc：数值索引序与业务排序一致，可直接分页
    const orderBy = sortBy === 'nextReview-asc' ? 'nextReview' : 'createdAt'
    const items = await wordRepository.queryOrdered({
      orderBy,
      reverse: sortBy === 'createdAt-desc',
      filter: matchFilter,
      offset: offset > 0 ? offset : undefined,
      limit: pageLimit ?? undefined,
    })
    return { items, total, limit: pageLimit ?? total, offset }
  }

  // 2. 回退：本地缓存为空（首次使用 / 缓存被清空）→ SWR 全量读取 + 内存过滤排序
  const all = await wordRepository.getAllLocalFirst()

  // 过滤已掌握单词（mastery >= 5 视为已掌握，不展示在生词本列表中）
  const nonMastered = all.filter((w) => w.mastery < 5)

  // onlyFavorite 筛选：为 true 时仅保留 favorite === 1 的单词
  const favoriteFiltered = onlyFavorite
    ? nonMastered.filter((w) => w.favorite === 1)
    : nonMastered

  // keyword 模糊匹配：在 word 字段中大小写不敏感 includes 匹配
  const searchFiltered = query
    ? favoriteFiltered.filter((w) => w.word.toLowerCase().includes(query))
    : favoriteFiltered

  // 排序
  const sorted = [...searchFiltered].sort((a, b) => {
    if (sortBy === 'alphabet') {
      // 字母升序
      return a.word.localeCompare(b.word)
    }
    if (sortBy === 'nextReview-asc') {
      // 下次复习时间升序
      return a.nextReview - b.nextReview
    }
    // 'createdAt-desc'（默认）：添加时间降序
    return b.createdAt - a.createdAt
  })

  // 分页：不传 limit 或 limit <= 0 时返回全部
  const total = sorted.length
  const effectiveLimit = pageLimit ?? total
  const items =
    pageLimit != null
      ? sorted.slice(offset, offset + pageLimit)
      : sorted.slice(offset)

  return {
    items,
    total,
    limit: effectiveLimit,
    offset,
  }
}

/**
 * 获取生词本统计数据
 * - total: 全部生词数（使用 Dexie count，避免全表加载）
 * - mastered: mastery >= 5 的数量（使用索引 countWhereAbove，mastery 是索引字段）
 * - pendingReview: nextReview <= 当前时间 的数量（使用索引 countWhereBelowOrEqual，nextReview 是索引字段）
 *
 * @returns WordbookStats 包含 total/mastered/pendingReview 三项计数
 * @throws 当 wordRepository.count/countWhereAbove/countWhereBelowOrEqual 任一查询失败时抛出
 */
export async function getWordbookStats(): Promise<WordbookStats> {
  const now = Date.now()
  const [total, mastered, pendingReview] = await Promise.all([
    wordRepository.count(),
    // mastery 是索引字段，mastery > 4 即 mastery >= 5
    wordRepository.countWhereAbove('mastery', 4),
    // nextReview 是索引字段
    wordRepository.countWhereBelowOrEqual('nextReview', now),
  ])
  return { total, mastered, pendingReview }
}
