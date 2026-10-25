// reviewService 加权复习结果
//
// applyWeightedReviewResult 的 stabilityScore 更新、掌握流转与 stubbornCount 重置。
// 由 reviewService.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Word } from '@/shared/types'
import { getTodayReviewQueueInfo, isOverdue, applyWeightedReviewResult } from '../reviewService'
import { DAY_MS, mockWords, installWordMock, installReviewMock, restoreMock, makeWord } from './reviewServiceTestMocks'

describe('reviewService 加权复习结果', () => {
  // 5. applyWeightedReviewResult 调用后 word.stabilityScore 被更新
  it('applyWeightedReviewResult 调用后 word.stabilityScore 被更新', async () => {
    const now = Date.now()
    // 初始 word：reviewCount=2, interval=4, easeFactor=2.5, mastery=3
    const word: Word = makeWord('test-word', {
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
      mastery: 3,
      nextReview: now - 1000,
      stabilityScore: 30, // 初始值较低
    })
    installWordMock([word])
    installReviewMock()
    try {
      // 三环节全对 → 加权率=1.0 → q=5
      await applyWeightedReviewResult('test-word', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      // 从 mock 存储中读取更新后的 word
      const updated = mockWords.find((w) => w.id === 'test-word')
      expect(updated).toBeDefined()

      // 验证 stabilityScore 已被写入（不为初始值 30）
      expect(updated!.stabilityScore).toBeDefined()
      expect(updated!.stabilityScore !== 30).toBe(true)
      expect(
        updated!.stabilityScore! >= 0 && updated!.stabilityScore! <= 100
      ).toBe(true)

      // 精确值验证：
      // - reviewCount 由 2 增至 3（word.reviewCount + 1）
      // - easeFactor 由 2.5 提升至 2.6（q=5 → easeDelta=0.1）
      // - interval: reviewCount=3 (非首次/第二次)，raw=round(4*2.6)=10，snap(10)=15
      // - stabilityScore = 3*5 + (2.6-1.3)*20 + (15/30)*30 = 15 + 26 + 15 = 56
      expect(updated!.stabilityScore).toBe(56)

      // 顺带验证其他字段也被更新
      expect(updated!.reviewCount).toBe(3)
      expect(updated!.interval).toBe(15)
      expect(updated!.easeFactor).toBe(2.6)
      expect(updated!.mastery).toBe(4)
    } finally {
      restoreMock()
    }
  })

  // 6. 复习完成后再次查询今日队列不包含该单词（验证复习流程闭环）
  it('applyWeightedReviewResult 后该单词不再出现在今日复习队列（已掌握）', async () => {
    const now = Date.now()
    // 两个到期单词
    const words: Word[] = [
      makeWord('word-a', {
        nextReview: now - 1000,
        reviewCount: 2,
        interval: 4,
        easeFactor: 2.5,
      }),
      makeWord('word-b', {
        nextReview: now - 500,
        reviewCount: 2,
        interval: 4,
        easeFactor: 2.5,
      }),
    ]
    installWordMock(words)
    installReviewMock()
    try {
      // 复习前：队列包含两个到期单词
      const before = await getTodayReviewQueueInfo()
      expect(before.total).toBe(2)
      expect(before.words.map((w) => w.id)).toContain('word-a')

      // 复习 word-a：三环节全对 → quality=5 → nextReview 推到未来
      await applyWeightedReviewResult('word-a', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      // 复习后：word-a 不应再出现在今日队列（nextReview 已推到未来）
      const after = await getTodayReviewQueueInfo()
      expect(after.words.map((w) => w.id)).not.toContain('word-a')
      // word-b 仍在队列
      expect(after.words.map((w) => w.id)).toContain('word-b')
      // 总数减一
      expect(after.total).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 7. "还需复习"（全错）场景：nextInterval=1，下次复习在明天，今日队列同样闭合
  it('applyWeightedReviewResult 后该单词不再出现在今日复习队列（还需复习）', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('word-c', {
        nextReview: now - 1000,
        reviewCount: 2,
        interval: 4,
        easeFactor: 2.5,
      }),
    ]
    installWordMock(words)
    installReviewMock()
    try {
      // 复习 word-c：全错 → quality=0 → nextInterval=1（明天）
      await applyWeightedReviewResult('word-c', {
        practiceCorrect: 0, practiceTotal: 10,
        spellCorrect: 0, spellTotal: 10,
        writeCorrect: 0, writeTotal: 10,
      })

      // 验证 nextReview 已推到未来（>= now + 1 天）
      const updated = mockWords.find((w) => w.id === 'word-c')
      expect(updated!.nextReview).toBeGreaterThan(now)

      // 今日队列不应再包含 word-c
      const after = await getTodayReviewQueueInfo()
      expect(after.words.map((w) => w.id)).not.toContain('word-c')
      expect(after.total).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 8. 达到掌握（mastery >= 5）时重置 stubbornCount 为 0
  // 记忆逻辑合理性：已掌握的单词不再需要强化，顽固词计数应清零
  it('applyWeightedReviewResult 达到掌握时重置 stubbornCount 为 0', async () => {
    // 初始 mastery=4，三环节全对 → masteryDelta=+1 → newMastery=5（达到掌握）
    // stubbornCount=5（顽固词），掌握后应重置为 0
    const word = makeWord('test', {
      mastery: 4,
      stubbornCount: 5,
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
    })
    installWordMock([word])
    installReviewMock()
    try {
      await applyWeightedReviewResult('test', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      const updated = mockWords.find((w) => w.id === 'test')
      expect(updated).toBeDefined()
      // 达到掌握
      expect(updated!.mastery).toBe(5)
      // stubbornCount 被重置为 0
      expect(updated!.stubbornCount).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 9. 未达到掌握时 stubbornCount 保持不变
  // 验证：仅当 mastery >= 5 时才重置 stubbornCount，未掌握时保留顽固词计数
  it('applyWeightedReviewResult 未达到掌握时 stubbornCount 保持不变', async () => {
    // 初始 mastery=3，三环节全对 → newMastery=4（未达到掌握）
    // stubbornCount=5 应保持不变
    const word = makeWord('test', {
      mastery: 3,
      stubbornCount: 5,
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
    })
    installWordMock([word])
    installReviewMock()
    try {
      await applyWeightedReviewResult('test', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      const updated = mockWords.find((w) => w.id === 'test')
      expect(updated).toBeDefined()
      // 未达到掌握
      expect(updated!.mastery).toBe(4)
      // stubbornCount 保持不变
      expect(updated!.stubbornCount).toBe(5)
    } finally {
      restoreMock()
    }
  })

  // 10. 逾期单词复习后逾期状态消除（验证修复：学习后 nextReview 被推到未来，isOverdue 返回 false）
  it('applyWeightedReviewResult 逾期单词复习后逾期状态消除', async () => {
    const now = Date.now()
    // 逾期 2 天的单词
    const word = makeWord('overdue-word', {
      nextReview: now - 2 * DAY_MS,
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
    })
    installWordMock([word])
    installReviewMock()
    try {
      // 复习前：单词逾期
      expect(isOverdue(mockWords[0], now)).toBe(true)

      // 复习：三环节全对 → nextInterval 推到未来
      await applyWeightedReviewResult('overdue-word', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      // 复习后：nextReview 被推到未来
      const updated = mockWords.find((w) => w.id === 'overdue-word')
      expect(updated).toBeDefined()
      expect(updated!.nextReview).toBeGreaterThan(now)
      // 逾期状态已消除
      expect(isOverdue(updated!, now)).toBe(false)
    } finally {
      restoreMock()
    }
  })
})
