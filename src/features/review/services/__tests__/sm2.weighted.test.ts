// SM-2 加权算法与边界
//
// 加权正确率映射、加权复习结果、stabilityScore 与 easeFactor / interval clamp 边界。
// 由 sm2.test.ts 按算法分组拆分而来，用例内容与断言未改动。

import { calculateSM2, calculateWeightedQuality, calculateWeightedReview, calculateStabilityScore, type SM2Input, type WeightedReviewInput } from '../sm2'

// ---------- 加权算法测试 ----------

describe('SM-2 加权算法', () => {
  // 10. 加权正确率映射 q 值
  it('加权正确率映射 q 值正确', () => {
    // 三环节全对 → 加权率 = 1.0 → q=5
    const allCorrect: WeightedReviewInput = {
      practiceCorrect: 10, practiceTotal: 10,
      spellCorrect: 10, spellTotal: 10,
      writeCorrect: 10, writeTotal: 10,
    }
    expect(calculateWeightedQuality(allCorrect)).toBe(5)

    // 三环节全错 → 加权率 = 0 → q=0
    const allWrong: WeightedReviewInput = {
      practiceCorrect: 0, practiceTotal: 10,
      spellCorrect: 0, spellTotal: 10,
      writeCorrect: 0, writeTotal: 10,
    }
    expect(calculateWeightedQuality(allWrong)).toBe(0)

    // 加权率约 0.85（practice 0.9, spell 0.8, write 0.85）→ q=4
    // 0.9*0.3 + 0.8*0.3 + 0.85*0.4 = 0.27 + 0.24 + 0.34 = 0.85
    const mid: WeightedReviewInput = {
      practiceCorrect: 9, practiceTotal: 10,
      spellCorrect: 8, spellTotal: 10,
      writeCorrect: 17, writeTotal: 20,
    }
    expect(calculateWeightedQuality(mid)).toBe(4)

    // 加权率 0.5 → q=2
    const half: WeightedReviewInput = {
      practiceCorrect: 5, practiceTotal: 10,
      spellCorrect: 5, spellTotal: 10,
      writeCorrect: 5, writeTotal: 10,
    }
    expect(calculateWeightedQuality(half)).toBe(2)
  })

  // 11. 三环节全对 → q=5，间隔递增
  it('加权全对 → q=5 且 interval 递增', () => {
    const input: WeightedReviewInput = {
      practiceCorrect: 10, practiceTotal: 10,
      spellCorrect: 10, spellTotal: 10,
      writeCorrect: 10, writeTotal: 10,
    }
    const result = calculateWeightedReview(input, {
      interval: 4,
      easeFactor: 2.5,
      reviewCount: 3,
    })
    expect(result.quality).toBe(5)
    expect(result.nextInterval > 4).toBe(true)
    expect(result.nextEaseFactor > 2.5).toBe(true)
    expect(result.masteryDelta).toBe(1)
  })

  // 12. 三环节全错 → q=0，间隔回到 1 天
  it('加权全错 → q=0 且 interval 回到 1 天', () => {
    const input: WeightedReviewInput = {
      practiceCorrect: 0, practiceTotal: 10,
      spellCorrect: 0, spellTotal: 10,
      writeCorrect: 0, writeTotal: 10,
    }
    const result = calculateWeightedReview(input, {
      interval: 15,
      easeFactor: 2.5,
      reviewCount: 5,
    })
    expect(result.quality).toBe(0)
    expect(result.nextInterval).toBe(1)
    expect(result.masteryDelta).toBe(-1)
    expect(result.nextEaseFactor < 2.5).toBe(true)
  })

  // 13. 加权计算 stabilityScore
  it('calculateStabilityScore 加权计算正确', () => {
    // reviewCount=5, easeFactor=2.5, interval=15
    // 5*5 + (2.5-1.3)*20 + (15/30)*30 = 25 + 24 + 15 = 64
    const score1 = calculateStabilityScore({
      reviewCount: 5,
      easeFactor: 2.5,
      interval: 15,
    })
    expect(score1).toBe(64)

    // 上限测试：reviewCount=30, easeFactor=2.8, interval=30
    // 30*5 + (2.8-1.3)*20 + (30/30)*30 = 150 + 30 + 30 = 210 → 限制为 100
    const score2 = calculateStabilityScore({
      reviewCount: 30,
      easeFactor: 2.8,
      interval: 30,
    })
    expect(score2).toBe(100)

    // 下限测试：reviewCount=0, easeFactor=1.3, interval=0
    // 0*5 + 0*20 + 0 = 0
    const score3 = calculateStabilityScore({
      reviewCount: 0,
      easeFactor: 1.3,
      interval: 0,
    })
    expect(score3).toBe(0)
  })

  // 14. 加权间隔梯度落在 [1, 2, 4, 7, 15, 30] 中
  it('加权 interval 落在阶梯 [1, 2, 4, 7, 15, 30] 中', () => {
    const validSteps = [1, 2, 4, 7, 15, 30]
    const cases: { input: WeightedReviewInput; word: { interval: number; easeFactor: number; reviewCount: number } }[] = [
      {
        input: { practiceCorrect: 10, practiceTotal: 10, spellCorrect: 10, spellTotal: 10, writeCorrect: 10, writeTotal: 10 },
        word: { interval: 1, easeFactor: 2.5, reviewCount: 1 },
      },
      {
        input: { practiceCorrect: 10, practiceTotal: 10, spellCorrect: 10, spellTotal: 10, writeCorrect: 10, writeTotal: 10 },
        word: { interval: 1, easeFactor: 2.5, reviewCount: 2 },
      },
      {
        input: { practiceCorrect: 8, practiceTotal: 10, spellCorrect: 8, spellTotal: 10, writeCorrect: 8, writeTotal: 10 },
        word: { interval: 7, easeFactor: 2.5, reviewCount: 5 },
      },
    ]
    for (const c of cases) {
      const result = calculateWeightedReview(c.input, c.word)
      expect(validSteps.includes(result.nextInterval)).toBe(true)
    }
  })

  // 15. 缺失环节（total=0）时不影响加权计算
  it('部分环节缺失时加权计算仍正确', () => {
    // 仅 write 环节有数据，全对 → 加权率 = 1.0 → q=5
    const onlyWrite: WeightedReviewInput = {
      practiceCorrect: 0, practiceTotal: 0,
      spellCorrect: 0, spellTotal: 0,
      writeCorrect: 10, writeTotal: 10,
    }
    expect(calculateWeightedQuality(onlyWrite)).toBe(5)

    // 全部环节缺失 → q=0
    const allEmpty: WeightedReviewInput = {
      practiceCorrect: 0, practiceTotal: 0,
      spellCorrect: 0, spellTotal: 0,
      writeCorrect: 0, writeTotal: 0,
    }
    expect(calculateWeightedQuality(allEmpty)).toBe(0)
  })
})

// ---------- 加权算法边界场景补充 ----------

describe('SM-2 加权算法边界场景', () => {
  // 16. 加权正确率刚好 0.9 → q=5（边界）
  it('加权正确率刚好 0.9 → q=5（边界）', () => {
    // 三环节正确率均为 0.9：加权率 = (0.9*0.3 + 0.9*0.3 + 0.9*0.4) / 1.0 = 0.9 → q=5
    const input: WeightedReviewInput = {
      practiceCorrect: 9, practiceTotal: 10,
      spellCorrect: 9, spellTotal: 10,
      writeCorrect: 9, writeTotal: 10,
    }
    expect(calculateWeightedQuality(input)).toBe(5)
  })

  // 17. 加权正确率刚好 0.8 → q=4（边界）
  it('加权正确率刚好 0.8 → q=4（边界）', () => {
    // 三环节正确率均为 0.8：加权率 = 0.8 → q=4
    const input: WeightedReviewInput = {
      practiceCorrect: 8, practiceTotal: 10,
      spellCorrect: 8, spellTotal: 10,
      writeCorrect: 8, writeTotal: 10,
    }
    expect(calculateWeightedQuality(input)).toBe(4)
  })

  // 18. 加权正确率 0.0 → q=0（边界，显式覆盖）
  it('加权正确率 0.0 → q=0（边界）', () => {
    // 三环节 correct 均为 0 但 total 非零：加权率 = 0 → q=0
    const input: WeightedReviewInput = {
      practiceCorrect: 0, practiceTotal: 10,
      spellCorrect: 0, spellTotal: 10,
      writeCorrect: 0, writeTotal: 10,
    }
    expect(calculateWeightedQuality(input)).toBe(0)
  })

  // 19. stabilityScore 在不同 easeFactor 下的计算（固定 reviewCount 与 interval，仅变 easeFactor）
  it('calculateStabilityScore 在不同 easeFactor 下计算正确', () => {
    // 固定 reviewCount=5, interval=15，仅变 easeFactor
    // 公式：reviewCount*5 + (easeFactor-1.3)*20 + (interval/30)*30
    //       = 25 + (easeFactor-1.3)*20 + 15 = 40 + (easeFactor-1.3)*20

    // easeFactor=1.3（下限）：40 + 0 = 40
    const scoreLow = calculateStabilityScore({
      reviewCount: 5,
      easeFactor: 1.3,
      interval: 15,
    })
    expect(scoreLow).toBe(40)

    // easeFactor=2.0：40 + (2.0-1.3)*20 = 40 + 14 = 54
    const scoreMid = calculateStabilityScore({
      reviewCount: 5,
      easeFactor: 2.0,
      interval: 15,
    })
    expect(scoreMid).toBe(54)

    // easeFactor=2.5（默认值）：40 + (2.5-1.3)*20 = 40 + 24 = 64
    const scoreDefault = calculateStabilityScore({
      reviewCount: 5,
      easeFactor: 2.5,
      interval: 15,
    })
    expect(scoreDefault).toBe(64)

    // easeFactor=2.8（接近上限）：40 + (2.8-1.3)*20 = 40 + 30 = 70
    const scoreHigh = calculateStabilityScore({
      reviewCount: 5,
      easeFactor: 2.8,
      interval: 15,
    })
    expect(scoreHigh).toBe(70)

    // 验证 stabilityScore 随 easeFactor 单调递增
    expect(
      scoreLow < scoreMid && scoreMid < scoreDefault && scoreDefault < scoreHigh
    ).toBe(true)
  })
})


describe('SM-2 clamp 边界', () => {
  // 20. easeFactor 低于 1.3 时 clamp 到 1.3
  // 构造场景：currentEaseFactor 接近下限，连续答错（quality=0）会让 easeFactor 降到 1.3 以下
  // easeDelta = 0.1 - (5-0)*(0.08 + (5-0)*0.02) = 0.1 - 5*0.18 = -0.8
  // raw = 1.4 + (-0.8) = 0.6 → clamp 到 1.3
  it('easeFactor 低于 1.3 时 clamp 到 1.3（连续答错）', () => {
    const input: SM2Input = {
      correctRate: 0, // 完全答错 → quality=0
      timeSpent: 30,
      currentInterval: 15,
      currentEaseFactor: 1.4, // 接近下限
      reviewCount: 5,
    }
    const result = calculateSM2(input)

    // 验证 easeFactor 被 clamp 到 1.3，不会低于 1.3
    expect(result.nextEaseFactor).toBe(1.3)
    // 验证 quality=0
    expect(result.quality).toBe(0)
  })

  // 21. easeFactor 超过 3.0 时 clamp 到 3.0（上限）
  // 构造场景：currentEaseFactor 接近上限，连续答对（quality=5）会让 easeFactor 超过 3.0
  // easeDelta = 0.1 - (5-5)*(...) = 0.1
  // raw = 2.95 + 0.1 = 3.05 → clamp 到 3.0
  it('easeFactor 超过 3.0 时 clamp 到 3.0（连续答对）', () => {
    const input: SM2Input = {
      correctRate: 1, // 完美答对 → quality=5
      timeSpent: 5,
      currentInterval: 15,
      currentEaseFactor: 2.95, // 接近上限
      reviewCount: 5,
    }
    const result = calculateSM2(input)

    // 验证 easeFactor 被 clamp 到 3.0，不会超过 3.0
    expect(result.nextEaseFactor).toBe(3.0)
    // 验证 quality=5
    expect(result.quality).toBe(5)
  })

  // 22. interval 不超过 365 天（clamp 上限）
  // 构造场景：currentInterval 极大（500），easeFactor=3.0，连续答对
  // 注意：snapToInterval 会先把 interval 限制到最高 30，所以 365 的 clamp 在正常路径下不会触发
  // 但 Math.min(365, nextInterval) 确保了即使输入极端值，nextInterval 也不会超过 365
  it('interval 不超过 365 天（即使输入极端大的 currentInterval）', () => {
    const input: SM2Input = {
      correctRate: 1, // 完美答对 → quality=5
      timeSpent: 5,
      currentInterval: 500, // 极端大的当前间隔
      currentEaseFactor: 3.0, // 上限值
      reviewCount: 10,
    }
    const result = calculateSM2(input)

    // 验证 nextInterval 不超过 365（clamp 上限生效）
    expect(result.nextInterval).toBeLessThanOrEqual(365)
    // 验证 nextInterval 落在合法阶梯 [1, 2, 4, 7, 15, 30] 中（snapToInterval 封顶 30）
    expect([1, 2, 4, 7, 15, 30].includes(result.nextInterval)).toBe(true)
  })
})

