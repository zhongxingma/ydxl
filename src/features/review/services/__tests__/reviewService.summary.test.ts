// reviewService 复习结果落库与逾期计算单元测试
//
// 覆盖场景：
// 1. getTodayReviewCount 返回截断前总数
// 2. applyWeightedReviewResult 未找到单词时跳过并告警（不调用 update）
// 3. 汇总 Review 写入失败时仅告警，单词更新仍生效
// 4. applyReviewResult 将五步结果按 0.3/0.3/0.4 加权换算后落库
// 5. recordStepReview 单步记录写入成功与失败兜底
// 6. getOverdueDays 未来 / 未逾期 / 逾期天数取整
//
// Mock 策略：复用 reviewServiceTestMocks 的内存仓储；mock statsService 避免真实统计写入。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Review, ReviewStep } from '@/shared/types'
import { wordRepository, reviewRepository } from '@/shared/services'
import {
  installWordMock,
  installReviewMock,
  restoreMock,
  makeWord,
  DAY_MS,
  mockWords,
} from './reviewServiceTestMocks'

vi.mock('@/features/stats', () => ({
  statsService: {
    recordWordReviewed: vi.fn(async () => {}),
    recordWordMastered: vi.fn(async () => {}),
  },
}))

import {
  getTodayReviewCount,
  applyWeightedReviewResult,
  applyReviewResult,
  recordStepReview,
  getOverdueDays,
} from '../reviewService'
import { statsService } from '@/features/stats'

const NOW = new Date('2026-10-26T12:00:00').getTime()

function makeStepResult(correct: boolean, correctRate: number) {
  return { correct, correctRate, timeSpent: 1200 }
}

function makeStepResults(overrides: Partial<Record<ReviewStep, ReturnType<typeof makeStepResult>>> = {}) {
  return {
    learn: makeStepResult(true, 1),
    read: makeStepResult(true, 1),
    practice: makeStepResult(true, 1),
    spell: makeStepResult(true, 1),
    write: makeStepResult(true, 1),
    ...overrides,
  }
}

describe('reviewService 复习结果与逾期计算', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    installWordMock([])
    installReviewMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreMock()
  })

  it('getTodayReviewCount 返回截断前到期总数', async () => {
    installWordMock([
      makeWord('w1', { nextReview: NOW - DAY_MS }),
      makeWord('w2', { nextReview: NOW - 1000 }),
      makeWord('w3', { nextReview: NOW + DAY_MS }),
    ])

    expect(await getTodayReviewCount()).toBe(2)
  })

  it('applyWeightedReviewResult 单词不存在时跳过并告警', async () => {
    const updateSpy = vi.spyOn(wordRepository, 'update')

    await applyWeightedReviewResult('missing', {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    expect(updateSpy).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('未找到单词'),
      'missing',
    )
  })

  it('汇总 Review 写入失败时单词更新仍生效', async () => {
    installWordMock([makeWord('w1', { definition: '苹果' })])
    reviewRepository.add = vi.fn().mockRejectedValue(new Error('db down'))

    await applyWeightedReviewResult('w1', {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    expect(mockWords[0].reviewCount).toBe(1)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('汇总 Review'),
      expect.any(Error),
    )
  })

  it('applyReviewResult 按三环节加权换算并落库', async () => {
    installWordMock([makeWord('w1', { definition: '苹果', mastery: 0 })])
    const addSpy = vi.fn(async (entity: Review) => ({ ...entity, updated_at: NOW }))
    reviewRepository.add = addSpy

    await applyReviewResult('w1', makeStepResults())

    expect(mockWords[0].reviewCount).toBe(1)
    expect(addSpy).toHaveBeenCalledTimes(1)
    const record = addSpy.mock.calls[0][0]
    expect(record.wordId).toBe('w1')
    expect(record.step).toBe('write')
    expect(record.correct).toBe(true)
    expect(record.correctRate).toBeCloseTo(1)
    expect(statsService.recordWordReviewed).toHaveBeenCalled()
  })

  it('applyReviewResult 缺失环节按全错计算正确率', async () => {
    installWordMock([makeWord('w1', { definition: '苹果', mastery: 0 })])
    const addSpy = vi.fn(async (entity: Review) => ({ ...entity, updated_at: NOW }))
    reviewRepository.add = addSpy

    await applyReviewResult('w1', makeStepResults({ spell: undefined, write: undefined }))

    const record = addSpy.mock.calls[0][0]
    // 仅 practice 得分：0.3 / 总权重 1.0 = 0.3 → 未达到 0.6 正确阈值
    expect(record.correctRate).toBeCloseTo(0.3)
    expect(record.correct).toBe(false)
  })

  it('recordStepReview 写入单步记录', async () => {
    const addSpy = vi.fn(async (entity: Review) => ({ ...entity, updated_at: NOW }))
    reviewRepository.add = addSpy

    await recordStepReview('w1', 'write', { correct: true, correctRate: 0.8, timeSpent: 500 })

    const record = addSpy.mock.calls[0][0]
    expect(record.id).toBe(`w1-write-${NOW}`)
    expect(record.step).toBe('write')
    expect(record.correctRate).toBe(0.8)
    expect(record.timeSpent).toBe(500)
  })

  it('recordStepReview 写入失败仅告警不抛错', async () => {
    reviewRepository.add = vi.fn().mockRejectedValue(new Error('write failed'))

    await expect(
      recordStepReview('w1', 'spell', { correct: false, correctRate: 0.2, timeSpent: 300 }),
    ).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('单步 Review'),
      expect.any(Error),
    )
  })

  it('getOverdueDays 未逾期返回 0，逾期按天向下取整', () => {
    expect(getOverdueDays(NOW + DAY_MS)).toBe(0)
    expect(getOverdueDays(NOW)).toBe(0)
    expect(getOverdueDays(NOW - DAY_MS * 2.5)).toBe(2)
  })
})
