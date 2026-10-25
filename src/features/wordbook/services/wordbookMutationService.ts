// 生词本写入服务：添加、批量添加、笔记更新、删除与收藏切换
import { wordRepository } from '@/shared/services'
import { statsService } from '@/features/stats'
import type { Word } from '@/shared/types'
import { enrichWord } from './wordEnrichmentService'

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
