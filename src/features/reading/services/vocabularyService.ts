// 重点词汇自动整理服务
// 调用 AI 提取文章中的重点词汇，并持久化保存全部显示内容：
// 1. 文章实体 Article.vocabulary 字段（Dexie + 服务器 SQLite，主持久化）
// 2. localStorage 缓存（历史兼容，旧数据首次命中时自动迁移写入文章实体）
// 增强版：每个词汇条目附 exampleSentence（例句）与 emojiHint（emoji 助记）
import { logger } from '../../../shared/utils/logger'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import type { Article, ArticleVocabulary, HighlightedWord } from '@/shared/types'
import type { VocabularyItem } from '../types'

// localStorage 缓存 key 前缀，完整 key 为 `ydxl-vocab-${articleId}`
const CACHE_KEY_PREFIX = 'ydxl-vocab-'

/**
 * 读取本地缓存的词汇列表
 * 兼容旧版缓存（无 exampleSentence / emojiHint 字段）
 */
function readCache(articleId: string): VocabularyItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + articleId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VocabularyItem[]
    if (!Array.isArray(parsed)) return null
    return parsed
  } catch (err) {
    // JSON 解析失败（缓存损坏）时回退到 null，触发重新生成
    if (import.meta.env.DEV)
      logger.warn('[vocabularyService] 词汇缓存读取失败', err)
    return null
  }
}

/**
 * 写入本地缓存（包含新增字段 exampleSentence / emojiHint）
 */
function writeCache(articleId: string, items: VocabularyItem[]): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + articleId, JSON.stringify(items))
  } catch (err) {
    // 写入失败不阻塞，仅记录日志
    logger.warn('[vocabularyService] 词汇缓存写入失败', err)
  }
}

/**
 * 将词汇列表写回文章实体（Article.vocabulary 字段，Dexie + 服务器 SQLite 持久化）
 * best-effort：写入失败不阻塞阅读流程，仅记录日志（localStorage 缓存兜底仍在）
 */
async function persistToArticle(articleId: string, items: VocabularyItem[]): Promise<void> {
  try {
    await articleRepository.update(articleId, {
      vocabulary: items as ArticleVocabulary[],
    })
  } catch (err) {
    // 服务器异常时标记失败不影响主流程（best-effort）
    logger.warn('[vocabularyService] 词汇写回文章实体失败', err)
  }
}

/**
 * 将文章生成时的高亮生词（HighlightedWord）转换为基础版重点词汇（ArticleVocabulary）
 *
 * 与重点短语的持久化时机对齐：AI 生成文章时 phrases 直接随文章落库，
 * 词汇同样在保存文章时写入基础版（word/phonetic/pos/definition/example + 推断的 importance），
 * 保证读完文章后重点词汇页立即有数据可显示（不再依赖阅读页首次打开触发 AI 提取）。
 *
 * 基础版不含增强字段（exampleSentence / emojiHint / exampleTranslation），
 * 阅读页首次打开时 extractAndCacheVocabulary 检测到未增强仍会调 AI 升级并覆盖写回。
 *
 * importance 推断规则（临时展示用，AI 增强后会重新判定）：
 * - 第 1 个词 → high（核心）
 * - 第 2-3 个词 → medium（中等）
 * - 其余 → low（了解）
 */
export function buildVocabularyFromHighlighted(
  highlightedWords: HighlightedWord[] | undefined,
): ArticleVocabulary[] {
  if (!Array.isArray(highlightedWords) || highlightedWords.length === 0) {
    return []
  }
  return highlightedWords.map((w, idx) => ({
    word: w.word,
    phonetic: w.phonetic,
    pos: w.pos,
    definition: w.definition,
    example: w.example,
    importance: idx === 0 ? 'high' : idx < 3 ? 'medium' : 'low',
  }))
}

/**
 * 判断文章实体已持久化的词汇是否已通过 AI 增强
 * 增强后的条目必含 exampleSentence / exampleSentenceTranslation / emojiHint 字段（失败降级也会写入空值）；
 * 基础版（保存文章时由 highlightedWords 转换而来）不含这三个字段 → 需要继续增强
 */
function isEnhancedVocabulary(items: ArticleVocabulary[]): boolean {
  return items.every(
    (v) =>
      v.exampleSentence !== undefined &&
      v.exampleSentenceTranslation !== undefined &&
      v.emojiHint !== undefined,
  )
}

/**
 * 为单个词汇增强：异步生成例句、例句翻译与 emoji 助记
 * - 调用 aiProvider.generateExampleSentence 获取真题/自适应例句
 * - 对生成的例句调用 aiProvider.generateTranslation 获取中文翻译
 * - 调用 aiProvider.generateEmojiHint 获取 emoji 助记字符数组
 * - 任一调用失败则该字段降级为空字符串/空数组
 */
async function enhanceVocabularyItem(item: VocabularyItem): Promise<VocabularyItem> {
  // 并行获取例句与 emoji 助记
  const [exampleSentence, emojiHint] = await Promise.all([
    // 例句失败降级为空字符串
    aiProvider
      .generateExampleSentence(item.word, item.definition)
      .catch((err) => {
        logger.warn(`[vocabularyService] 生成例句失败：${item.word}`, err)
        return ''
      }),
    // emoji 助记失败降级为空数组
    aiProvider
      .generateEmojiHint(item.word, item.definition)
      .catch((err) => {
        logger.warn(`[vocabularyService] 生成 emoji 助记失败：${item.word}`, err)
        return [] as string[]
      }),
  ])

  const safeSentence = exampleSentence?.trim() || ''

  // 例句翻译：对已生成的例句调 AI 翻译（例句为空则跳过）
  let exampleSentenceTranslation = ''
  if (safeSentence) {
    try {
      exampleSentenceTranslation = (await aiProvider.generateTranslation(safeSentence))?.trim() || ''
    } catch (err) {
      // 例句翻译失败降级为空字符串，不影响其他字段
      logger.warn(`[vocabularyService] 生成例句翻译失败：${item.word}`, err)
    }
  }

  return {
    ...item,
    exampleSentence: safeSentence,
    exampleSentenceTranslation,
    emojiHint: Array.isArray(emojiHint) ? emojiHint : [],
  }
}

/**
 * 提取并持久化重点词汇（增强版）
 * 1. 文章实体已含 vocabulary（Article.vocabulary）→ 直接返回，不调 AI
 * 2. 否则优先从 localStorage 读取缓存（旧数据），命中后迁移写回文章实体
 * 3. 未命中则调用 aiProvider.extractVocabulary 生成
 * 4. 为每个词汇并行调用 AI 生成例句与 emoji 助记（失败优雅降级）
 * 5. 写入 localStorage 缓存 + 写回文章实体（全部显示内容持久化）
 *
 * @param article 文章实体
 */
export async function extractAndCacheVocabulary(article: Article): Promise<VocabularyItem[]> {
  // 0. 文章实体已持久化且已增强的词汇（含全部显示内容）→ 直接返回
  //    基础版词汇（保存文章时由 highlightedWords 转换，缺增强字段）继续走 AI 增强流程
  if (article.vocabulary && article.vocabulary.length > 0) {
    if (isEnhancedVocabulary(article.vocabulary)) {
      return article.vocabulary as VocabularyItem[]
    }
    // 基础版兜底：AI 增强失败时至少返回已有数据（不返回空数组覆盖显示）
    // 走下方 AI 提取增强流程，若失败则回退当前基础版
  }

  // 1. 读取缓存
  const cached = readCache(article.id)
  if (cached) {
    // 旧数据迁移：localStorage 命中但文章实体尚未持久化时，写回文章实体
    // （best-effort，失败不影响本次返回）
    await persistToArticle(article.id, cached)
    return cached
  }

  // 2. AI 提取
  let baseItems: VocabularyItem[]
  try {
    baseItems = await aiProvider.extractVocabulary(article.content)
  } catch (err) {
    // AI 提取失败：若文章已有基础版词汇（保存时由高亮生词转换），回退返回基础版
    // 保证阅读页/词汇汇总页仍有数据可显示（与重点短语的可用性一致）
    if (article.vocabulary && article.vocabulary.length > 0) {
      logger.warn('[vocabularyService] AI 词汇提取失败，回退文章基础词汇', err)
      return article.vocabulary as VocabularyItem[]
    }
    logger.warn('[vocabularyService] AI 词汇提取失败，返回空数组', err)
    return []
  }

  // 校验返回结构（结构异常时同样回退基础版）
  if (!Array.isArray(baseItems)) {
    if (article.vocabulary && article.vocabulary.length > 0) {
      return article.vocabulary as VocabularyItem[]
    }
    return []
  }

  // 3. 为每个词汇增强：生成例句与 emoji 助记（并行，单个失败不影响其他词）
  // 使用 Promise.allSettled 确保单个失败不会让整个增强流程崩溃
  const enhancedResults = await Promise.allSettled(
    baseItems.map((item) => enhanceVocabularyItem(item))
  )
  const enhancedItems: VocabularyItem[] = enhancedResults.map((result, idx) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    // 增强失败的词汇，降级为基础字段 + 空的增强字段
    logger.warn(`[vocabularyService] 词汇增强失败：${baseItems[idx]?.word}`, result.reason)
    return {
      ...baseItems[idx],
      exampleSentence: '',
      exampleSentenceTranslation: '',
      emojiHint: [],
    }
  })

  // 4. 写入缓存 + 写回文章实体（全部显示内容持久化，写回失败由缓存兜底）
  writeCache(article.id, enhancedItems)
  await persistToArticle(article.id, enhancedItems)
  return enhancedItems
}

export const vocabularyService = {
  extractAndCacheVocabulary,
}
