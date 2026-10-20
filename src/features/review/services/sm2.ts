// SM-2 间隔复习算法
// 基于正确率与用时计算 quality，再调整 easeFactor、interval 与 mastery
// 算法参考：https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method

import type { Word } from '@/shared/types'

// 一天的毫秒数
const DAY_MS = 24 * 60 * 60 * 1000

// "timeSpent 合理"的阈值：<= 30 秒视为合理（速答），> 30 秒视为迟疑
const REASONABLE_TIME_THRESHOLD = 30

// 间隔阶梯：quality >= 3 时 interval 必须落在这些值上（向上取最近值）
const INTERVAL_STEPS = [1, 2, 4, 7, 15, 30] as const

// SM-2 算法输入
export interface SM2Input {
  correctRate: number // 0-1，正确率
  timeSpent: number // 秒，用时
  currentInterval: number // 当前间隔天数
  currentEaseFactor: number // 当前难度系数
  reviewCount: number // 本次复习后的累计复习次数
}

// SM-2 算法输出
export interface SM2Result {
  quality: number // 0-5，本次复习质量评分
  nextInterval: number // 下次间隔天数
  nextEaseFactor: number // 下次难度系数
  nextReviewAt: number // 下次复习时间戳（毫秒）
  masteryDelta: number // 掌握度变化（正数表示进步，负数表示退步）
}

// 三环节加权输入：炼/拼/写三环节的正确数与总数
export interface WeightedReviewInput {
  practiceCorrect: number // 练习环节正确数
  practiceTotal: number // 练习环节总题数
  spellCorrect: number // 拼写环节正确数
  spellTotal: number // 拼写环节总题数
  writeCorrect: number // 默写环节正确数
  writeTotal: number // 默写环节总题数
}

/**
 * 根据 correctRate 与 timeSpent 计算 quality（0-5）
 * - 5：完美（correctRate === 1 且 timeSpent 合理）
 * - 4：正确但有迟疑（correctRate === 1 但 timeSpent 偏长，或 correctRate >= 0.8）
 * - 3：勉强正确（correctRate >= 0.6）
 * - 2：错误但接近（correctRate >= 0.4）
 * - 1：错误（correctRate > 0 且 < 0.4）
 * - 0：完全不会（correctRate === 0）
 */
export function calculateQuality(correctRate: number, timeSpent: number): number {
  // 完全不会
  if (correctRate <= 0) return 0
  // 错误
  if (correctRate < 0.4) return 1
  // 错误但接近
  if (correctRate < 0.6) return 2
  // 勉强正确
  if (correctRate < 0.8) return 3
  // 正确但有迟疑：0.8 <= correctRate < 1
  if (correctRate < 1) return 4
  // correctRate === 1：根据用时判定 5 或 4
  return timeSpent <= REASONABLE_TIME_THRESHOLD ? 5 : 4
}

/**
 * 将目标间隔向上取最近值，落入 [1, 2, 4, 7, 15, 30] 阶梯
 * - target <= 1 → 1
 * - target = 3 → 4
 * - target > 30 → 30（封顶）
 */
export function snapToInterval(target: number): number {
  for (const step of INTERVAL_STEPS) {
    if (target <= step) return step
  }
  return INTERVAL_STEPS[INTERVAL_STEPS.length - 1]
}

/**
 * 计算 SM-2 结果
 *
 * 简化版逻辑：
 * 1. 根据 correctRate/timeSpent 计算 quality
 * 2. 调整 easeFactor：EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))，下限 1.3
 * 3. 计算 interval：
 *    - quality < 3 → 1（重置）
 *    - reviewCount === 1 → 1（首次复习）
 *    - reviewCount === 2 → 2（第二次复习）
 *    - 否则 → round(prevInterval * nextEaseFactor)，再 snap 到阶梯
 * 4. nextReviewAt = now + interval * DAY_MS
 * 5. masteryDelta：quality >= 4 → +1（上限 5），quality <= 2 → -1（下限 0），其余 0
 */
export function calculateSM2(input: SM2Input): SM2Result {
  const { correctRate, timeSpent, currentInterval, currentEaseFactor, reviewCount } = input

  // 1. 计算 quality
  const quality = calculateQuality(correctRate, timeSpent)

  // 2. 调整 easeFactor（标准 SM-2 公式）
  const q = quality
  const easeDelta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  // clamp 到 [1.3, 3.0]：下限 1.3 防止难度过低无法推进，上限 3.0 避免极端值导致复习间隔过长
  const nextEaseFactor = Math.max(1.3, Math.min(3.0, currentEaseFactor + easeDelta))

  // 3. 计算 interval
  let nextInterval: number
  if (quality < 3) {
    // 答错：重置间隔为 1
    nextInterval = 1
  } else if (reviewCount <= 1) {
    // 首次复习：1 天
    nextInterval = 1
  } else if (reviewCount === 2) {
    // 第二次复习：2 天
    nextInterval = 2
  } else {
    // 后续：基于上次间隔 × 难度系数，并 snap 到阶梯
    const raw = Math.max(1, Math.round(currentInterval * nextEaseFactor))
    nextInterval = snapToInterval(raw)
  }
  // clamp 上限 365 天，避免极端值导致复习间隔过长
  nextInterval = Math.min(365, nextInterval)

  // 4. 计算下次复习时间
  const nextReviewAt = Date.now() + nextInterval * DAY_MS

  // 5. 计算掌握度变化
  let masteryDelta = 0
  if (quality >= 4) masteryDelta = 1
  else if (quality <= 2) masteryDelta = -1

  return {
    quality,
    nextInterval,
    nextEaseFactor,
    nextReviewAt,
    masteryDelta,
  }
}

/**
 * 根据三环节（炼/拼/写）加权正确率计算 quality（0-5）
 *
 * 加权权重：练习 0.3、拼写 0.3、默写 0.4
 * 映射规则：
 *   rate >= 0.9 → 5
 *   rate >= 0.8 → 4
 *   rate >= 0.6 → 3
 *   rate >= 0.4 → 2
 *   rate >= 0.2 → 1
 *   else        → 0
 *
 * 若某环节 total 为 0，则该环节不参与加权（权重重新分配到其他环节）
 */
export function calculateWeightedQuality(input: WeightedReviewInput): number {
  const { practiceCorrect, practiceTotal, spellCorrect, spellTotal, writeCorrect, writeTotal } = input

  // 计算各环节正确率与权重，跳过 total=0 的环节
  const segments: { rate: number; weight: number }[] = []
  if (practiceTotal > 0) {
    segments.push({ rate: practiceCorrect / practiceTotal, weight: 0.3 })
  }
  if (spellTotal > 0) {
    segments.push({ rate: spellCorrect / spellTotal, weight: 0.3 })
  }
  if (writeTotal > 0) {
    segments.push({ rate: writeCorrect / writeTotal, weight: 0.4 })
  }

  // 全部环节都没有题目时，视为完全不会
  if (segments.length === 0) return 0

  // 加权平均正确率
  const weightSum = segments.reduce((s, seg) => s + seg.weight, 0)
  const weightedRate = segments.reduce((s, seg) => s + seg.rate * seg.weight, 0) / weightSum

  // 映射到 0-5
  if (weightedRate >= 0.9) return 5
  if (weightedRate >= 0.8) return 4
  if (weightedRate >= 0.6) return 3
  if (weightedRate >= 0.4) return 2
  if (weightedRate >= 0.2) return 1
  return 0
}

/**
 * 基于三环节加权输入计算 SM-2 结果
 *
 * - 用 calculateWeightedQuality 得到 quality（0-5）
 * - easeFactor 调整：EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))，下限 1.3
 * - 间隔梯度保留原 1/2/4/7/15/30 天，但 q=0 时回到 1 天重新开始
 * - 其余规则与 calculateSM2 一致
 */
export function calculateWeightedReview(
  input: WeightedReviewInput,
  word: Pick<Word, 'interval' | 'easeFactor' | 'reviewCount'>,
): SM2Result {
  const { currentInterval, currentEaseFactor, reviewCount } = {
    currentInterval: word.interval,
    currentEaseFactor: word.easeFactor,
    reviewCount: word.reviewCount + 1,
  }

  // 1. 计算加权 quality
  const quality = calculateWeightedQuality(input)

  // 2. 调整 easeFactor（标准 SM-2 公式）
  const q = quality
  const easeDelta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  // clamp 到 [1.3, 3.0]：下限 1.3 防止难度过低无法推进，上限 3.0 避免极端值导致复习间隔过长
  const nextEaseFactor = Math.max(1.3, Math.min(3.0, currentEaseFactor + easeDelta))

  // 3. 计算 interval
  let nextInterval: number
  if (quality === 0) {
    // q=0：回到 1 天重新开始
    nextInterval = 1
  } else if (quality < 3) {
    // 答错：重置间隔为 1
    nextInterval = 1
  } else if (reviewCount <= 1) {
    // 首次复习：1 天
    nextInterval = 1
  } else if (reviewCount === 2) {
    // 第二次复习：2 天
    nextInterval = 2
  } else {
    // 后续：基于上次间隔 × 难度系数，并 snap 到阶梯
    const raw = Math.max(1, Math.round(currentInterval * nextEaseFactor))
    nextInterval = snapToInterval(raw)
  }
  // clamp 上限 365 天，避免极端值导致复习间隔过长
  nextInterval = Math.min(365, nextInterval)

  // 4. 计算下次复习时间
  const nextReviewAt = Date.now() + nextInterval * DAY_MS

  // 5. 计算掌握度变化
  let masteryDelta = 0
  if (quality >= 4) masteryDelta = 1
  else if (quality <= 2) masteryDelta = -1

  return {
    quality,
    nextInterval,
    nextEaseFactor,
    nextReviewAt,
    masteryDelta,
  }
}

/**
 * 计算单词的记忆稳固度（0-100），用于进度条展示
 *
 * 公式：min(100, (reviewCount * 5) + (easeFactor - 1.3) * 20 + (interval / 30) * 30)
 *
 * - reviewCount：复习次数越多，稳固度越高（每次 +5）
 * - easeFactor：难度系数越高（掌握越好），稳固度越高
 * - interval：当前间隔越长（能扛住越久不复习），稳固度越高
 */
export function calculateStabilityScore(word: Pick<Word, 'reviewCount' | 'easeFactor' | 'interval'>): number {
  const reviewCount = word.reviewCount ?? 0
  const easeFactor = word.easeFactor ?? 1.3
  const interval = word.interval ?? 0

  const score = reviewCount * 5 + (easeFactor - 1.3) * 20 + (interval / 30) * 30
  // 限制在 0-100 之间
  return Math.max(0, Math.min(100, Math.round(score)))
}
