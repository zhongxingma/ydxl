// 生词本服务：封装生词的添加、笔记更新、删除、统计等业务逻辑
// 基于 wordRepository 提供更友好的调用接口，供 wordbook 模块及阅读模块复用
import { wordRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import { statsService } from '@/features/stats'
import type { Word } from '@/shared/types'
import type { WordbookSortBy, WordbookStats } from '../types'

// 加入生词本参数
export interface AddToWordbookParams {
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  example?: string
  sourceArticleId?: string
  note?: string
  // true 时，写入后若 phonetic/pos/definition/example 任一缺失或为占位值，
  // 自动调用 enrichWord 用 AI 补全（best-effort，失败仅 warn 不抛错）。
  // 用于选词加入生词本场景，确保生词本中可见音标/词义/例句。
  enrichIfMissing?: boolean
}

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
 * 加入生词本
 * - id 使用 word 本身的小写形式
 * - 若该词已存在则更新 note 字段（合并已有笔记与新笔记）
 * - 新词初始化：mastery=0、nextReview=当前时间（立即可复习）、lastReview=0、reviewCount=0、interval=0、easeFactor=2.5
 * - enrichIfMissing 为 true 时，写入后若字段缺失或为占位值，自动调用 enrichWord 用 AI 补全
 *
 * @param params 生词参数：word、phonetic、pos、definition、example、sourceArticleId、note、enrichIfMissing
 * @returns 写入后的 Word 实体
 * @throws 当 wordRepository.add 失败且降级 update 也失败时抛出原始 add 错误
 */
export async function addToWordbook(params: AddToWordbookParams): Promise<Word> {
  const {
    word,
    phonetic = '',
    pos = '',
    definition = '',
    example = '',
    sourceArticleId,
    note,
    enrichIfMissing = false,
  } = params

  // id 统一使用小写形式，避免大小写差异导致的重复
  const id = word.toLowerCase()
  const now = Date.now()

  // 检查是否已存在
  const existing = await wordRepository.getById(id)
  let result: Word
  if (existing) {
    // 已存在：合并笔记（新笔记非空时追加到原笔记后）
    const mergedNote =
      note && note.trim()
        ? existing.note
          ? `${existing.note}\n${note.trim()}`
          : note.trim()
        : existing.note

    await wordRepository.update(id, { note: mergedNote })
    // 重新读取返回最新实体
    const updated = await wordRepository.getById(id)
    result = updated ?? existing
  } else {
    // 新增生词实体（含 updated_at 以构成完整 Word）
    const entity: Word = {
      id,
      word,
      phonetic,
      pos,
      definition,
      example,
      mastery: 0,
      nextReview: now, // 立即可复习
      lastReview: 0,
      reviewCount: 0,
      interval: 0,
      easeFactor: 2.5,
      sourceArticleId,
      note: note && note.trim() ? note.trim() : undefined,
      createdAt: now,
      updated_at: now,
    }

    try {
      await wordRepository.add(entity)
      result = entity
    } catch (addErr) {
      // add 失败（可能是重复主键竞态）：降级 update 重试
      console.warn('[wordbookService] add 失败，降级 update 重试', addErr)
      try {
        await wordRepository.update(id, entity)
        const updated = await wordRepository.getById(id)
        result = updated ?? entity
      } catch (updateErr) {
        // update 也失败：抛出原始 add 错误，保持错误链清晰
        throw addErr
      }
    }
    // 新增单词成功后记录统计（best-effort，失败不阻塞主流程）
    // 仅在新增分支调用，已存在分支不调用，避免重复计数
    try {
      await statsService.recordWordLearned()
    } catch (err) {
      console.warn('[wordbookService] recordWordLearned 调用失败', err)
    }
  }

  // enrichIfMissing 为 true 时，best-effort 调用 enrichWord 补全缺失/占位字段
  // 用于选词加入生词本场景：查词未命中本地字典时字段为空或占位，需 AI 补全音标/词义/例句
  if (enrichIfMissing) {
    try {
      result = await enrichWord(id)
    } catch (err) {
      // 补全失败不阻塞主流程，返回已写入的基础实体
      console.warn('[wordbookService] enrichWord 补全失败', err)
    }
  }

  return result
}

/**
 * 更新指定单词的笔记
 *
 * @param wordId 单词 id（小写形式）
 * @param note 笔记内容；空字符串或纯空白将清除笔记
 * @returns 无返回值
 * @throws 当 wordRepository.update 失败时抛出
 */
export async function updateNote(wordId: string, note: string): Promise<void> {
  await wordRepository.update(wordId, { note: note.trim() || undefined })
}

/**
 * 从生词本移除单个单词
 *
 * @param wordId 单词 id（小写形式）
 * @returns 无返回值
 * @throws 当 wordRepository.delete 失败时抛出
 */
export async function removeFromWordbook(wordId: string): Promise<void> {
  await wordRepository.delete(wordId)
}

/**
 * 批量从生词本移除单词
 *
 * @param wordIds 单词 id 数组
 * @returns 无返回值
 * @throws 当 wordRepository.bulkDelete 失败时抛出
 */
export async function bulkRemove(wordIds: string[]): Promise<void> {
  await wordRepository.bulkDelete(wordIds)
}

/**
 * 批量加入生词本
 * - 输入：原始单词数组（可能包含标点或非单词字符，由调用方负责过滤）
 * - 调用 wordRepository.bulkAdd 走批量端点 POST /api/words/bulk（事务 + INSERT OR IGNORE），
 *   消除 N+1 HTTP 调用，单次请求完成全部插入
 * - 已存在的词被跳过（INSERT OR IGNORE），不覆盖已有复习进度与笔记
 * - 行为差异：单条 addToWordbook 对已存在词会合并笔记并计为 added；
 *   批量接口为追求性能直接跳过已存在词，计为 failed（导入场景可接受）
 * - 服务端返回 `{ added, skipped }`，此处映射为 `{ added, failed }`，
 *   `failed` = 跳过数（已存在 + 字段校验失败）
 *
 * @param words 单词字符串数组
 * @returns { added: 新增数, failed: 跳过/失败数 }
 * @throws 当 wordRepository.bulkAdd 网络请求失败时抛出
 */
export async function bulkAddToWordbook(
  words: string[]
): Promise<{ added: number; failed: number }> {
  if (!words || words.length === 0) {
    return { added: 0, failed: 0 }
  }

  const now = Date.now()
  // 为每个单词字符串构造 Word 实体（默认值与 addToWordbook 一致）
  const items: Word[] = words.map((w) => ({
    id: w.toLowerCase(),
    word: w,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview: now, // 立即可复习
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
  }))

  const { added, skipped } = await wordRepository.bulkAdd(items)
  return { added, failed: skipped }
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

  // 1. 获取全部生词（本地优先：本地有缓存时立即返回，后台静默刷新）
  const all = await wordRepository.getAllLocalFirst()

  // 2. 过滤已掌握单词（mastery >= 5 视为已掌握，不展示在生词本列表中）
  const nonMastered = all.filter((w) => w.mastery < 5)

  // 3. onlyFavorite 筛选：为 true 时仅保留 favorite === 1 的单词
  const favoriteFiltered = onlyFavorite
    ? nonMastered.filter((w) => w.favorite === 1)
    : nonMastered

  // 4. keyword 模糊匹配：在 word 字段中大小写不敏感 includes 匹配
  const query = keyword?.trim().toLowerCase()
  const searchFiltered = query
    ? favoriteFiltered.filter((w) => w.word.toLowerCase().includes(query))
    : favoriteFiltered

  // 5. 排序
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

  // 6. 分页：不传 limit 或 limit <= 0 时返回全部
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

/**
 * 判断字段是否为缺失或占位值，需要 AI 补全
 * 占位值来源：lookupWord 未命中本地字典时返回的占位数据
 * - 空字符串 / undefined
 * - '/-/'（音标占位）
 * - '未知'（词性占位）
 * - 包含 '暂未收录'（释义占位）
 */
function isMissingField(value: string | undefined): boolean {
  if (!value) return true
  const trimmed = value.trim()
  if (!trimmed) return true
  if (trimmed === '/-/') return true
  if (trimmed === '未知') return true
  if (trimmed.includes('暂未收录')) return true
  return false
}

/**
 * AI 词义补全：当 word 缺失 phonetic/pos/definition 时调用 AI 获取并写回
 * - 读取现有 word，若 phonetic/pos/definition 全部已存在且非占位值则直接返回（无需补全）
 * - 调用 aiProvider.enrichSingleWord 获取该单词的完整信息（音标/词性/释义/例句）
 * - 调用 wordRepository.update(wordId, patch) 写回仅缺失或占位的字段
 * - 返回更新后的 word（重新 getById）
 * - 失败时抛出 Error，由 UI 层处理提示
 *
 * @param wordId 单词 id（小写形式）
 * @returns 更新后的 Word 实体
 * @throws 当 AI 调用失败时抛出 Error
 */
export async function enrichWord(wordId: string): Promise<Word> {
  // 1. 读取现有 word（本地优先：enrichWord 的调用方通常已通过本地索引查询获得单词，
  //    若服务器返回 404 但本地缓存命中，仍可继续补全，避免 "Word not found" 误报）
  const existing = await wordRepository.getByIdLocalFirst(wordId)
  if (!existing) {
    throw new Error(`Word not found: ${wordId}`)
  }

  // 2. 若字段已完整（且非占位值）则直接返回
  if (
    !isMissingField(existing.phonetic) &&
    !isMissingField(existing.pos) &&
    !isMissingField(existing.definition)
  ) {
    return existing
  }

  // 3. 调用 AI 获取该单词的完整信息（专为单词补全设计，不依赖文章上下文）
  const enriched = await aiProvider.enrichSingleWord(existing.word)

  // 4. 构造更新字段（仅更新缺失或占位的字段）
  const patch: Partial<Word> = {}
  if (isMissingField(existing.phonetic) && enriched.phonetic) {
    patch.phonetic = enriched.phonetic
  }
  if (isMissingField(existing.pos) && enriched.pos) {
    patch.pos = enriched.pos
  }
  if (isMissingField(existing.definition) && enriched.definition) {
    patch.definition = enriched.definition
  }
  if (isMissingField(existing.example) && enriched.example) {
    patch.example = enriched.example
  }
  // 例句翻译：与 example 同步写回（仅当 example 被更新或已有 example 但缺翻译时）
  if (enriched.exampleTranslation) {
    if (isMissingField(existing.exampleTranslation)) {
      patch.exampleTranslation = enriched.exampleTranslation
    }
  }
  // 相关短语：AI 返回则写回（仅当现有 phrases 缺失时）
  // VocabularyItem.phrases 为可选字段，enrichSingleWord 补全时会生成 0-3 个相关短语
  const enrichedPhrases = enriched.phrases
  if (enrichedPhrases && enrichedPhrases.length > 0 && (!existing.phrases || existing.phrases.length === 0)) {
    patch.phrases = enrichedPhrases
  }

  // 5. 写回并返回更新后的 word（本地优先读取，确保服务器 404 时仍可从本地缓存获取）
  await wordRepository.update(wordId, patch)
  const updated = await wordRepository.getByIdLocalFirst(wordId)
  if (!updated) {
    throw new Error(`Word not found after update: ${wordId}`)
  }
  return updated
}

/**
 * 切换单词收藏状态
 * - 读取现有 word，若 favorite === 1 则更新为 0，否则更新为 1
 * - 调用 wordRepository.update(wordId, { favorite }) 写回
 * - 失败时抛出 Error，由 UI 层处理提示
 *
 * @param wordId 单词 id（小写形式）
 * @returns 无返回值
 * @throws 当 wordRepository.getById 查不到记录或 update 写入失败时抛出
 */
export async function toggleFavorite(wordId: string): Promise<void> {
  // 1. 读取现有 word
  const existing = await wordRepository.getById(wordId)
  if (!existing) {
    throw new Error(`Word not found: ${wordId}`)
  }

  // 2. 切换收藏状态：favorite === 1 → 0，否则（0 或 undefined）→ 1
  const next: 0 | 1 = existing.favorite === 1 ? 0 : 1

  // 3. 写回
  await wordRepository.update(wordId, { favorite: next })
}

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
