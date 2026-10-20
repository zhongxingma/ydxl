// 已掌握单词/短语服务：封装「已掌握」单词的分页查询逻辑
// 与 wordbookService.getWordbook 保持一致的「已掌握」判定：mastery >= 5
// 基于 wordRepository.getAll() 提供分页、搜索、排序能力，供 MasteredPage 使用
import { wordRepository } from '@/shared/services'
import type { Word } from '@/shared/types'
import type { MasteredSortBy } from '../types'

// 已掌握分页查询参数
export interface GetMasteredWordsParams {
  // 分页大小（不传或 <=0 时返回全部，向后兼容）
  limit?: number
  // 分页偏移量（默认 0）
  offset?: number
  // 搜索关键字：在 word 字段中模糊匹配（大小写不敏感）
  keyword?: string
  // 排序方式：'alphabet'（字母升序）/ 'masteredAt-desc'（最近掌握时间降序，默认）/ 'createdAt-desc'（添加时间降序）
  sortBy?: MasteredSortBy
}

// 已掌握分页响应
export interface MasteredWordsPage {
  // 当前页的已掌握单词列表
  items: Word[]
  // 过滤后（已掌握 + keyword）的单词总数
  total: number
  // 本次查询使用的 limit（未传或 <=0 时为 total）
  limit: number
  // 本次查询使用的 offset
  offset: number
}

/**
 * 获取已掌握单词分页列表（Task 5.2）
 * - 从 wordRepository.getAll() 获取全部单词（服务器为主，离线回退本地缓存）
 * - 过滤已掌握单词（mastery >= 5），与 wordbookService.getWordbook 的判定保持一致
 * - 按 keyword 在 word 字段中模糊匹配（大小写不敏感）
 * - 按 sortBy 排序：
 *   - 'alphabet'：字母升序
 *   - 'masteredAt-desc'（默认）：按 lastReview 降序（最近掌握时间代理）
 *   - 'createdAt-desc'：按添加时间降序
 * - 应用 limit/offset 分页；不传 limit 或 limit <= 0 时返回全部
 * - 返回 { items, total, limit, offset }，total 为过滤后（已掌握 + keyword）的总数
 *
 * @param params 分页查询参数：limit、offset、keyword、sortBy（均可选）
 * @returns MasteredWordsPage 包含 items/total/limit/offset
 * @throws 当 wordRepository.getAll 失败时抛出
 */
export async function getMasteredWords(
  params: GetMasteredWordsParams = {},
): Promise<MasteredWordsPage> {
  const {
    limit,
    offset = 0,
    keyword,
    sortBy = 'masteredAt-desc',
  } = params

  // 1. 获取全部单词（本地优先：本地有缓存时立即返回，后台静默刷新）
  const all = await wordRepository.getAllLocalFirst()

  // 2. 过滤已掌握单词（mastery >= 5 视为已掌握，与 wordbookService 保持一致）
  const mastered = all.filter((w) => w.mastery >= 5)

  // 3. keyword 模糊匹配：在 word 字段中大小写不敏感 includes 匹配
  const query = keyword?.trim().toLowerCase()
  const searchFiltered = query
    ? mastered.filter((w) => w.word.toLowerCase().includes(query))
    : mastered

  // 4. 排序
  const sorted = [...searchFiltered].sort((a, b) => {
    if (sortBy === 'alphabet') {
      // 字母升序
      return a.word.localeCompare(b.word)
    }
    if (sortBy === 'createdAt-desc') {
      // 添加时间降序
      return b.createdAt - a.createdAt
    }
    // 'masteredAt-desc'（默认）：按 lastReview 降序（最近掌握时间代理）
    // lastReview 缺失视为 0，排在最后
    return (b.lastReview ?? 0) - (a.lastReview ?? 0)
  })

  // 5. 分页：不传 limit 或 limit <= 0 时返回全部
  const total = sorted.length
  const effectiveLimit = typeof limit === 'number' && limit > 0 ? limit : total
  const items =
    typeof limit === 'number' && limit > 0
      ? sorted.slice(offset, offset + limit)
      : sorted.slice(offset)

  return {
    items,
    total,
    limit: effectiveLimit,
    offset,
  }
}

export const masteredService = {
  getMasteredWords,
}
