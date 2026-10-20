// 复习服务：今日待复习队列查询、复习结果应用（SM-2 更新）
// 综合 5 步结果计算最终 correctRate，调用 SM-2 更新 word，并写入汇总 Review 记录
import { reviewRepository, wordRepository, getSettings } from '@/shared/services'
import { statsService } from '@/features/stats'
import type { Review, ReviewStep, Word } from '@/shared/types'
import { calculateWeightedReview, calculateStabilityScore } from './sm2'
import type { WeightedReviewInput } from './sm2'
import type { StepResult } from '../types'

// 一天的毫秒数
const DAY_MS = 24 * 60 * 60 * 1000

// 今日待复习队列的详细信息（含上限信息）
export interface TodayReviewQueueInfo {
  // 截断后的待复习单词列表
  words: Word[]
  // 待复习总数（截断前）
  total: number
  // 每日复习上限
  limit: number
  // 是否已达到上限
  reachedLimit: boolean
}

/**
 * 获取今日待复习队列（含上限信息）
 * - 查询 nextReview <= now 的单词（使用 Dexie 索引 whereBelowOrEqual，避免全表扫描）
 * - 排序：顽固词优先（stubbornCount desc），其次按 nextReview 升序（逾期越久越优先）；
 *        同 nextReview 时 reviewCount 少的优先（新词优先）
 * - 根据 settings.dailyReviewLimit 截断
 * - SWR 模式：触发后台刷新（30 秒节流），刷新完成后通过 cacheEvents 通知订阅方更新 UI
 *
 * @returns TodayReviewQueueInfo 包含截断后的 words、截断前 total、limit、reachedLimit
 * @throws 当 wordRepository.whereBelowOrEqual 查询失败时抛出
 */
export async function getTodayReviewQueueInfo(): Promise<TodayReviewQueueInfo> {
  const now = Date.now()
  // 触发后台刷新本地缓存（fire-and-forget，30 秒节流）：
  // whereBelowOrEqual 是本地索引查询不会发起 HTTP，需单独触发后台刷新
  // 以保证跨终端场景下本地缓存不至于长期陈旧
  wordRepository.triggerRefresh()
  // nextReview 是索引字段，whereBelowOrEqual('nextReview', now) 查询到期单词
  const due = await wordRepository.whereBelowOrEqual('nextReview', now)
  // 排序：顽固词优先（stubbornCount 降序）；其次 nextReview 升序；其次 reviewCount 升序
  due.sort((a, b) => {
    const sa = a.stubbornCount ?? 0
    const sb = b.stubbornCount ?? 0
    if (sa !== sb) return sb - sa
    if (a.nextReview !== b.nextReview) return a.nextReview - b.nextReview
    return a.reviewCount - b.reviewCount
  })

  const settings = getSettings()
  const limit = settings.dailyReviewLimit
  const total = due.length
  const words = limit > 0 ? due.slice(0, limit) : due

  return {
    words,
    total,
    limit,
    // limit <= 0 表示不限制，此时永远不算达到上限
    reachedLimit: limit > 0 && total > limit,
  }
}

/**
 * 获取今日待复习队列（向后兼容版本）
 * - 返回截断后的 Word[]，便于不关心上限信息的调用方使用
 *
 * @returns 截断后的 Word 数组（按每日复习上限）
 */
export async function getTodayReviewQueue(): Promise<Word[]> {
  const info = await getTodayReviewQueueInfo()
  return info.words
}

/**
 * 获取今日待复习数量（截断前总数）
 *
 * @returns 待复习单词总数（未截断）
 */
export async function getTodayReviewCount(): Promise<number> {
  const info = await getTodayReviewQueueInfo()
  return info.total
}

/**
 * 判断单词是否逾期超过 1 天
 * - nextReview 早于 now - 24h 视为逾期
 *
 * @param word 单词
 * @param now 当前时间戳（毫秒），默认 Date.now()；测试中可传入固定值避免时间漂移
 * @returns 是否逾期超过 1 天
 */
export function isOverdue(word: Word, now: number = Date.now()): boolean {
  return word.nextReview < now - DAY_MS
}

/**
 * 获取顽固词列表（stubbornCount >= 3）
 * - 按 stubbornCount 降序排序
 *
 * @returns 顽固词数组，按 stubbornCount 降序
 * @throws 当 wordRepository.getAllLocalFirst 查询失败时抛出
 */
export async function getStubbornWords(): Promise<Word[]> {
  // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
  const allWords = await wordRepository.getAllLocalFirst()
  const stubborn = allWords.filter((w) => (w.stubbornCount ?? 0) >= 3)
  stubborn.sort((a, b) => (b.stubbornCount ?? 0) - (a.stubbornCount ?? 0))
  return stubborn
}

/**
 * 应用三环节加权复习结果到单词与复习记录（新版）
 * - 调用 calculateWeightedReview 基于炼/拼/写三环节加权质量更新 SM-2
 * - 写入 word.stabilityScore（记忆稳固度 0-100）
 * - 写入 word.updated_at 保持同步
 * - 写入 reviewRepository 一条汇总 Review 记录
 *
 * @param wordId 单词 id
 * @param weightedInput 三环节（练习/拼写/默写）正确数与总数
 * @returns 无返回值；单词不存在时仅记录日志不抛错
 * @throws 当 wordRepository.update 失败时抛出
 */
export async function applyWeightedReviewResult(
  wordId: string,
  weightedInput: WeightedReviewInput,
): Promise<void> {
  // 本地优先读取：复习队列通过 whereBelowOrEqual 从本地索引查询，
  // 若服务器返回 404 但本地缓存命中，仍可应用复习结果，避免逾期状态无法消除
  const word = await wordRepository.getByIdLocalFirst(wordId)
  if (!word) {
    console.warn('[reviewService] 未找到单词，跳过复习结果应用', wordId)
    return
  }

  // 1. 调用加权 SM-2 计算
  const result = calculateWeightedReview(weightedInput, word)

  // 2. 计算稳固度（使用更新后的字段）
  const stabilityScore = calculateStabilityScore({
    reviewCount: word.reviewCount + 1,
    easeFactor: result.nextEaseFactor,
    interval: result.nextInterval,
  })

  // 3. 更新 word 字段
  const newMastery = Math.max(0, Math.min(5, word.mastery + result.masteryDelta))
  const now = Date.now()
  // 构造更新字段：SM-2 核心字段 + 顽固词计数管理
  const patch: Partial<Word> = {
    mastery: newMastery,
    nextReview: result.nextReviewAt,
    lastReview: now,
    reviewCount: word.reviewCount + 1,
    interval: result.nextInterval,
    easeFactor: result.nextEaseFactor,
    stabilityScore,
  }
  // 顽固词计数管理：达到掌握（mastery >= 5）时重置 stubbornCount 为 0，
  // 避免已掌握的单词仍被标记为顽固词（记忆逻辑合理性：掌握后不再需要强化）
  if (newMastery >= 5 && (word.stubbornCount ?? 0) > 0) {
    patch.stubbornCount = 0
  }
  await wordRepository.update(wordId, patch)

  // 4. 写入汇总 Review 记录
  // 计算加权正确率用于记录展示
  const segments: { rate: number; weight: number }[] = []
  if (weightedInput.practiceTotal > 0) {
    segments.push({ rate: weightedInput.practiceCorrect / weightedInput.practiceTotal, weight: 0.3 })
  }
  if (weightedInput.spellTotal > 0) {
    segments.push({ rate: weightedInput.spellCorrect / weightedInput.spellTotal, weight: 0.3 })
  }
  if (weightedInput.writeTotal > 0) {
    segments.push({ rate: weightedInput.writeCorrect / weightedInput.writeTotal, weight: 0.4 })
  }
  const weightSum = segments.reduce((s, seg) => s + seg.weight, 0)
  const finalCorrectRate = weightSum > 0
    ? segments.reduce((s, seg) => s + seg.rate * seg.weight, 0) / weightSum
    : 0

  const summaryReview: Omit<Review, 'id' | 'updated_at'> & { updated_at?: number } = {
    wordId,
    step: 'write',
    correct: finalCorrectRate >= 0.6,
    correctRate: finalCorrectRate,
    timeSpent: 0,
    reviewedAt: now,
  }
  const reviewId = `${wordId}-summary-${now}`
  try {
    await reviewRepository.add({ ...summaryReview, id: reviewId } as Review)
  } catch (err) {
    console.warn('[reviewService] 写入汇总 Review 记录失败', err)
  }

  // 5. 记录统计指标（best-effort，失败不阻塞主流程）
  // 每次复习完成累加今日复习数；首次达到掌握（mastery >= 5）时累加今日掌握数
  try {
    await statsService.recordWordReviewed()
    // 首次达到掌握（newMastery >= 5 且原 mastery < 5）时记录掌握数
    if (newMastery >= 5 && word.mastery < 5) {
      await statsService.recordWordMastered()
    }
  } catch (err) {
    console.warn('[reviewService] 统计记录调用失败', err)
  }
}

/**
 * 应用本次复习结果到单词与复习记录（向后兼容版本）
 * - 接受旧的 5 步 stepResults 签名，内部转换为三环节加权输入
 * - 三环节（practice/spell/write）的 correctRate 转换为正确数/总数（基数 10）
 * - 缺失的环节视为全错
 *
 * @param wordId 单词 id
 * @param stepResults 各步骤结果
 * @returns 无返回值
 * @throws 当内部 applyWeightedReviewResult 调用失败时抛出
 */
export async function applyReviewResult(
  wordId: string,
  stepResults: Record<ReviewStep, StepResult>,
): Promise<void> {
  // 将 correctRate（0-1）转换为正确数（基数 10，便于保留小数精度）
  const toCount = (rate: number, total = 10): number => Math.round(rate * total)

  const weightedInput: WeightedReviewInput = {
    practiceCorrect: toCount(stepResults.practice?.correctRate ?? 0),
    practiceTotal: 10,
    spellCorrect: toCount(stepResults.spell?.correctRate ?? 0),
    spellTotal: 10,
    writeCorrect: toCount(stepResults.write?.correctRate ?? 0),
    writeTotal: 10,
  }
  await applyWeightedReviewResult(wordId, weightedInput)
}

/**
 * 写入单步 Review 记录
 *
 * @param wordId 单词 id
 * @param step 复习步骤（practice/spell/write/recall/recite 等）
 * @param result 步骤结果（含 correct、correctRate、timeSpent）
 * @returns 无返回值；写入失败时仅记录日志不抛错
 */
export async function recordStepReview(
  wordId: string,
  step: ReviewStep,
  result: StepResult,
): Promise<void> {
  const now = Date.now()
  const reviewId = `${wordId}-${step}-${now}`
  const review: Omit<Review, 'id' | 'updated_at'> & { updated_at?: number } = {
    wordId,
    step,
    correct: result.correct,
    correctRate: result.correctRate,
    timeSpent: result.timeSpent,
    reviewedAt: now,
  }
  try {
    await reviewRepository.add({ ...review, id: reviewId } as Review)
  } catch (err) {
    console.warn('[reviewService] 写入单步 Review 记录失败', err)
  }
}

/**
 * 计算单词的逾期天数（用于 UI 展示）
 *
 * @param nextReview 下次复习时间戳（毫秒）
 * @returns 逾期天数；未逾期返回 0
 */
export function getOverdueDays(nextReview: number): number {
  const now = Date.now()
  if (nextReview >= now) return 0
  return Math.floor((now - nextReview) / DAY_MS)
}

export const reviewService = {
  getTodayReviewQueue,
  getTodayReviewQueueInfo,
  getTodayReviewCount,
  applyReviewResult,
  applyWeightedReviewResult,
  recordStepReview,
  getOverdueDays,
  isOverdue,
  getStubbornWords,
}
