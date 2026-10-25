// 生词 AI 补全服务：补全缺失/占位字段的音标、词性、释义、例句与短语
import { wordRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import type { Word } from '@/shared/types'

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
