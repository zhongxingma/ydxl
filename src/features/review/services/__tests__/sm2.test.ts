// SM-2 基础算法
//
// calculateSM2 主流程、calculateQuality 边界与 snapToInterval 阶梯。
// 由 sm2.test.ts 按算法分组拆分而来，用例内容与断言未改动。

import { calculateSM2, calculateQuality, snapToInterval, type SM2Input } from '../sm2'

describe('SM-2 算法', () => {
  // 1. 完美复习（correctRate=1, timeSpent=5s）应得 quality=5，interval 增加
  it('完美复习应得 quality=5 且 interval 增加', () => {
    const input: SM2Input = {
      correctRate: 1,
      timeSpent: 5,
      currentInterval: 1,
      currentEaseFactor: 2.5,
      reviewCount: 3,
    }
    const result = calculateSM2(input)
    expect(result.quality).toBe(5)
    expect(result.nextInterval > input.currentInterval).toBe(true)
    // easeFactor 应提升（+0.1）
    expect(result.nextEaseFactor > input.currentEaseFactor).toBe(true)
    expect(result.masteryDelta).toBe(1)
  })

  // 2. 错误复习（correctRate=0）应得 quality=0，interval 重置为 1
  it('错误复习应得 quality=0 且 interval 重置为 1', () => {
    const input: SM2Input = {
      correctRate: 0,
      timeSpent: 10,
      currentInterval: 15,
      currentEaseFactor: 2.5,
      reviewCount: 5,
    }
    const result = calculateSM2(input)
    expect(result.quality).toBe(0)
    expect(result.nextInterval).toBe(1)
    expect(result.masteryDelta).toBe(-1)
    // easeFactor 应下降但不低于 1.3
    expect(result.nextEaseFactor < input.currentEaseFactor).toBe(true)
  })

  // 3. easeFactor 不低于 1.3
  it('easeFactor 不低于 1.3', () => {
    // 即使持续答错，easeFactor 也不应低于 1.3
    const input: SM2Input = {
      correctRate: 0,
      timeSpent: 30,
      currentInterval: 15,
      currentEaseFactor: 1.3, // 已是下限
      reviewCount: 5,
    }
    const result = calculateSM2(input)
    expect(result.nextEaseFactor >= 1.3).toBe(true)
  })

  // 4. 间隔梯度落在 [1, 2, 4, 7, 15, 30] 中
  it('间隔梯度落在 [1, 2, 4, 7, 15, 30] 中', () => {
    const validSteps = [1, 2, 4, 7, 15, 30]
    // 遍历多种复习次数与 correctRate 组合
    const testCases: SM2Input[] = [
      { correctRate: 1, timeSpent: 5, currentInterval: 1, currentEaseFactor: 2.5, reviewCount: 1 },
      { correctRate: 1, timeSpent: 5, currentInterval: 1, currentEaseFactor: 2.5, reviewCount: 2 },
      { correctRate: 1, timeSpent: 5, currentInterval: 2, currentEaseFactor: 2.5, reviewCount: 3 },
      { correctRate: 1, timeSpent: 5, currentInterval: 4, currentEaseFactor: 2.5, reviewCount: 4 },
      { correctRate: 0.8, timeSpent: 20, currentInterval: 7, currentEaseFactor: 2.5, reviewCount: 5 },
      { correctRate: 0.6, timeSpent: 40, currentInterval: 15, currentEaseFactor: 2.5, reviewCount: 6 },
    ]
    for (const input of testCases) {
      const result = calculateSM2(input)
      expect(validSteps.includes(result.nextInterval)).toBe(true)
    }
  })

  // 5. calculateQuality 边界测试
  it('calculateQuality 边界值正确', () => {
    expect(calculateQuality(0, 10)).toBe(0)
    expect(calculateQuality(0.3, 10)).toBe(1)
    expect(calculateQuality(0.4, 10)).toBe(2)
    expect(calculateQuality(0.6, 10)).toBe(3)
    expect(calculateQuality(0.8, 10)).toBe(4)
    expect(calculateQuality(1, 5)).toBe(5)
    expect(calculateQuality(1, 60)).toBe(4)
  })

  // 6. snapToInterval 边界测试
  it('snapToInterval 向上取最近阶梯值', () => {
    expect(snapToInterval(0)).toBe(1)
    expect(snapToInterval(1)).toBe(1)
    expect(snapToInterval(2)).toBe(2)
    expect(snapToInterval(3)).toBe(4)
    expect(snapToInterval(5)).toBe(7)
    expect(snapToInterval(10)).toBe(15)
    expect(snapToInterval(20)).toBe(30)
    expect(snapToInterval(100)).toBe(30) // 封顶
  })

  // 7. 首次复习（reviewCount=1）应得 interval=1
  it('首次复习 interval=1', () => {
    const result = calculateSM2({
      correctRate: 1,
      timeSpent: 5,
      currentInterval: 0,
      currentEaseFactor: 2.5,
      reviewCount: 1,
    })
    expect(result.nextInterval).toBe(1)
  })

  // 8. 第二次复习（reviewCount=2）应得 interval=2
  it('第二次复习 interval=2', () => {
    const result = calculateSM2({
      correctRate: 1,
      timeSpent: 5,
      currentInterval: 1,
      currentEaseFactor: 2.5,
      reviewCount: 2,
    })
    expect(result.nextInterval).toBe(2)
  })

  // 9. masteryDelta 上下限处理（由调用方负责限制，SM-2 仅返回 delta）
  it('masteryDelta 正确计算', () => {
    // quality >= 4 → +1
    const good = calculateSM2({
      correctRate: 1,
      timeSpent: 5,
      currentInterval: 1,
      currentEaseFactor: 2.5,
      reviewCount: 3,
    })
    expect(good.masteryDelta).toBe(1)

    // quality <= 2 → -1
    const bad = calculateSM2({
      correctRate: 0.3,
      timeSpent: 10,
      currentInterval: 1,
      currentEaseFactor: 2.5,
      reviewCount: 3,
    })
    expect(bad.masteryDelta).toBe(-1)

    // quality = 3 → 0
    const mid = calculateSM2({
      correctRate: 0.7,
      timeSpent: 10,
      currentInterval: 1,
      currentEaseFactor: 2.5,
      reviewCount: 3,
    })
    expect(mid.masteryDelta).toBe(0)
  })
})

