// 本地存储管理服务：持久化存储请求、空间估算、过期数据清理
//
// 设计目标：
// 1. 通过 navigator.storage.persist() 请求持久化存储，避免浏览器在低存储压力下自动清理用户数据
// 2. 监控存储使用率，超过阈值（85%）时触发清理
// 3. 清理派生数据（超期 questions、vocab 缓存），保留核心数据（articles/words/reviews/stats）
// 4. 强制数量上限，防止无限制增长
//
// 数据治理策略：
// - 核心数据（articles/words/reviews/stats/readingSessions/achievements）：用户主动产生，不清理
// - 派生数据（questions、vocab 缓存）：可由 AI 重新生成，超期或存储紧张时清理
// - 数量上限：articles/questions 表超过阈值时按 updated_at 升序清理最旧记录（articles 仅清理未读重复）
//
// 循环依赖说明：
// storageManager ← repository ← repositories ← storageManager
// ES module live binding 机制下此循环是安全的：
// - storageManager 仅在函数体内使用 localQuestionRepo 等（非模块加载时）
// - repository 仅在方法体内使用 StorageQuotaError / cleanupDerivedData（非模块加载时）
// - repositories 在模块加载时创建实例，此时 repository 已完成加载
import { logger } from '../utils/logger'
import { localQuestionRepo, localArticleRepo } from './repositories'
import { cleanupExpired, enforceScenarioLimit, clearCache } from './ai/responseCache'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const VOCAB_CACHE_PREFIX = 'ydxl-vocab-'
// wordLookup scenario 在 aiCache（IndexedDB）中的最大条目数
// 超出时按 updatedAt 升序淘汰最久未写入的条目（LRU）
const WORD_LOOKUP_MAX_ENTRIES = 500
// wordLookup scenario 标识（与 wordLookup.ts 中 setCached 的 scenario 参数保持一致）
const WORD_LOOKUP_SCENARIO = 'wordLookup'

/**
 * 存储空间不足错误
 * 当 Dexie 写入抛出 QuotaExceededError，且经过 cleanupDerivedData 紧急清理后重试仍失败时抛出。
 * 上层（如 CachedRemoteRepository）捕获此错误后可采用 best-effort 策略降级，不影响主流程。
 */
export class StorageQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageQuotaError'
    // 修复 TS 编译为 ES5 时 Error 子类原型链丢失的问题
    Object.setPrototypeOf(this, StorageQuotaError.prototype)
  }
}

export interface StorageEstimateInfo {
  usage: number
  quota: number
  usageRatio: number
}

/**
 * 请求持久化存储，避免浏览器在低存储压力下自动清理用户数据。
 * 在不支持 navigator.storage 的环境下返回 null，不抛错。
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null
    return await navigator.storage.persist()
  } catch (err) {
    logger.warn('[storageManager] requestPersistentStorage 失败', err)
    return null
  }
}

/**
 * 获取存储使用估算。不支持时返回 null。
 */
export async function getStorageEstimate(): Promise<StorageEstimateInfo | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage ?? 0
    const quota = estimate.quota ?? 0
    const usageRatio = quota > 0 ? usage / quota : 0
    return { usage, quota, usageRatio }
  } catch (err) {
    logger.warn('[storageManager] getStorageEstimate 失败', err)
    return null
  }
}

/**
 * 判断存储是否紧张（usageRatio > 0.85）。不支持时返回 false（不触发清理）。
 */
export async function isStorageLow(): Promise<boolean> {
  const estimate = await getStorageEstimate()
  if (!estimate) return false
  return estimate.usageRatio > 0.85
}

/**
 * 清理派生数据：超期 questions（30 天未更新）+ 超期 vocab 缓存 + 超期 AI 响应缓存
 * + wordLookup scenario 条目数上限（500 条）。
 *
 * 核心数据（articles/words/reviews/stats/readingSessions）不清理。
 * 失败时 console.warn，不抛错。
 *
 * 注意：vocab 缓存结构为 VocabularyItem[]（无 timestamp 字段，纯派生缓存），
 * 由于可由 AI 重新生成，触发清理时统一移除所有 ydxl-vocab-* 缓存。
 * AI 响应缓存（IndexedDB aiCache 表）仅清理已过期项，保留未过期项。
 * wordLookup scenario 在过期清理后额外强制 500 条上限，按 updatedAt 升序淘汰（LRU）。
 */
export async function cleanupDerivedData(): Promise<{
  cleanedQuestions: number
  cleanedVocab: number
  cleanedAiCache: number
  cleanedWordLookupOverflow: number
}> {
  const result = {
    cleanedQuestions: 0,
    cleanedVocab: 0,
    cleanedAiCache: 0,
    cleanedWordLookupOverflow: 0,
  }
  const cutoff = Date.now() - THIRTY_DAYS_MS

  // 清理 questions 表中超期记录（30 天未更新）
  try {
    const allQuestions = await localQuestionRepo.getAll()
    const expiredIds = allQuestions
      .filter((q) => (q.updated_at ?? 0) < cutoff)
      .map((q) => q.id)
    if (expiredIds.length > 0) {
      await localQuestionRepo.bulkDelete(expiredIds)
      result.cleanedQuestions = expiredIds.length
    }
  } catch (err) {
    logger.warn('[storageManager] cleanupDerivedData questions 清理失败', err)
  }

  // 清理 localStorage 中 ydxl-vocab-* 前缀缓存
  // vocab 缓存无 timestamp 字段（结构为 VocabularyItem[]），统一清理（可由 AI 重新生成）
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(VOCAB_CACHE_PREFIX)) {
          keysToRemove.push(key)
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key)
        result.cleanedVocab++
      }
    }
  } catch (err) {
    logger.warn('[storageManager] cleanupDerivedData vocab 清理失败', err)
  }

  // 清理 AI 响应缓存中超期项（IndexedDB aiCache 表）
  // 仅清理已过期项，保留未过期项（避免清空用户刚查询的缓存）
  try {
    result.cleanedAiCache = await cleanupExpired()
  } catch (err) {
    logger.warn('[storageManager] cleanupDerivedData AI 缓存清理失败', err)
  }

  // 强制 wordLookup scenario 条目数上限
  // 永久缓存长期使用后可能积累大量条目，限制为 500 条避免 IndexedDB 无限增长
  // 按 updatedAt 升序淘汰最久未写入的条目（LRU，价值最低）
  try {
    result.cleanedWordLookupOverflow = await enforceScenarioLimit(
      WORD_LOOKUP_SCENARIO,
      WORD_LOOKUP_MAX_ENTRIES,
    )
  } catch (err) {
    logger.warn('[storageManager] cleanupDerivedData wordLookup 上限清理失败', err)
  }

  return result
}

/**
 * 强制 articles 表数量上限。仅清理"未读（readAt 为 null）且 contentHash 重复"的旧文章。
 * 保留所有已读文章。返回清理数量。
 *
 * 清理规则：
 * 1. 总数 <= maxArticles 时返回 0
 * 2. 按 updated_at 升序遍历（最旧优先删除）
 * 3. 已读文章（readAt != null）一律保留
 * 4. 无 contentHash 的文章无法判断重复，保留
 * 5. 未读文章的 contentHash 与任意已读文章重复时，删除该未读文章
 * 6. 未读文章的 contentHash 与更早的未读文章重复时，删除较新的未读文章
 * 7. 达到 maxArticles 上限后停止
 */
export async function enforceArticleLimit(maxArticles = 500): Promise<number> {
  try {
    const all = await localArticleRepo.getAll()
    if (all.length <= maxArticles) return 0

    // 预统计每个 contentHash 的已读文章数（用于判断未读重复时是否删除）
    const hashReadCount = new Map<string, number>()
    for (const a of all) {
      if (a.readAt != null && a.contentHash) {
        hashReadCount.set(a.contentHash, (hashReadCount.get(a.contentHash) ?? 0) + 1)
      }
    }

    // 按 updated_at 升序排序（最旧优先删除）
    const sorted = [...all].sort((a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0))
    const toDelete: string[] = []
    // 已保留（首次出现）的未读 contentHash 集合
    const hashUnreadKept = new Set<string>()

    for (const article of sorted) {
      // 已达到清理目标，停止
      if (all.length - toDelete.length <= maxArticles) break
      // 已读文章一律保留
      if (article.readAt != null) continue
      // 无 contentHash 的文章不参与去重，保留
      if (!article.contentHash) continue
      // 如果该 contentHash 已有已读文章，删除此未读重复
      if ((hashReadCount.get(article.contentHash) ?? 0) > 0) {
        toDelete.push(article.id)
        continue
      }
      // 如果该 contentHash 已保留一篇未读文章，删除此重复
      if (hashUnreadKept.has(article.contentHash)) {
        toDelete.push(article.id)
        continue
      }
      // 首次出现的未读文章，保留
      hashUnreadKept.add(article.contentHash)
    }

    if (toDelete.length > 0) {
      await localArticleRepo.bulkDelete(toDelete)
    }
    return toDelete.length
  } catch (err) {
    logger.warn('[storageManager] enforceArticleLimit 失败', err)
    return 0
  }
}

/**
 * 强制 questions 表数量上限。按 updated_at 升序清理最旧记录。
 * @param maxQuestions 数量上限，默认 1000
 * @returns 实际清理数量
 */
export async function enforceQuestionLimit(maxQuestions = 1000): Promise<number> {
  try {
    const all = await localQuestionRepo.getAll()
    if (all.length <= maxQuestions) return 0

    // 按 updated_at 升序排序，清理最旧的
    const sorted = [...all].sort((a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0))
    const toDeleteCount = all.length - maxQuestions
    const toDelete = sorted.slice(0, toDeleteCount).map((q) => q.id)

    if (toDelete.length > 0) {
      await localQuestionRepo.bulkDelete(toDelete)
    }
    return toDelete.length
  } catch (err) {
    logger.warn('[storageManager] enforceQuestionLimit 失败', err)
    return 0
  }
}

/**
 * 存储维护聚合方法：仅在存储紧张时触发清理。
 * 应用启动后延迟调用。
 *
 * 策略：
 * - 存储紧张（usageRatio > 0.85）：清理派生数据 + 强制数量上限 + 紧急清空全部 AI 缓存
 * - 存储不紧张：仅检查数量上限（防止无限制增长）
 */
export async function runStorageMaintenance(): Promise<void> {
  try {
    const low = await isStorageLow()
    if (!low) {
      // 即使存储不紧张，也检查数量上限（防止无限制增长）
      await enforceQuestionLimit()
      await enforceArticleLimit()
      return
    }
    // 存储紧张：清理派生数据（含 AI 缓存过期项）+ 强制数量上限
    await cleanupDerivedData()
    await enforceQuestionLimit()
    await enforceArticleLimit()
    // 紧急释放：清空全部 AI 响应缓存（AI 缓存为派生数据，可由下次调用重建）
    try {
      await clearCache()
    } catch (err) {
      logger.warn('[storageManager] runStorageMaintenance 紧急清空 AI 缓存失败', err)
    }
  } catch (err) {
    logger.warn('[storageManager] runStorageMaintenance 失败', err)
  }
}
