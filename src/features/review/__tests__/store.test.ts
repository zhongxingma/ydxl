// 五步背诵状态机
//
// 覆盖 startReview / goToStep / completeStep / nextWord / skipWord / endReview
// 以及单步记录写入与未解锁步骤、无当前词等边界。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Word } from '@/shared/types'
import { useReviewStore } from '../store'
import { recordStepReview } from '../services/reviewService'
import type { StepResult } from '../types'

vi.mock('../services/reviewService', () => ({
  recordStepReview: vi.fn().mockResolvedValue(undefined),
}))

function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: '/test/',
    pos: 'n.',
    definition: '测试',
    example: 'example',
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

const result: StepResult = { correct: true, correctRate: 1, timeSpent: 5 }

function resetStore(): void {
  useReviewStore.getState().endReview()
}

describe('review store 状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('startReview：空队列直接标记全部完成', () => {
    useReviewStore.getState().startReview([])

    const state = useReviewStore.getState()
    expect(state.currentWord).toBeNull()
    expect(state.currentStep).toBeNull()
    expect(state.reviewQueue).toEqual([])
    expect(state.totalCount).toBe(0)
    expect(state.allComplete).toBe(true)
  })

  it('startReview：非空队列取首词并解锁识记步骤', () => {
    const words = [makeWord('a'), makeWord('b')]
    useReviewStore.getState().startReview(words)

    const state = useReviewStore.getState()
    expect(state.currentWord).toEqual(words[0])
    expect(state.currentStep).toBe('learn')
    expect(state.unlockedSteps).toEqual(new Set(['learn']))
    expect(state.completedSteps.size).toBe(0)
    expect(state.reviewQueue).toEqual(words)
    expect(state.totalCount).toBe(2)
    expect(state.allComplete).toBe(false)
  })

  it('goToStep：未解锁步骤不切换并输出告警', () => {
    useReviewStore.getState().startReview([makeWord('a')])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    useReviewStore.getState().goToStep('read')

    expect(useReviewStore.getState().currentStep).toBe('learn')
    expect(warnSpy).toHaveBeenCalledWith('[reviewStore] 步骤未解锁，无法切换', 'read')
  })

  it('goToStep：已解锁步骤正常切换', () => {
    useReviewStore.getState().startReview([makeWord('a')])

    useReviewStore.getState().goToStep('learn')

    expect(useReviewStore.getState().currentStep).toBe('learn')
  })

  it('completeStep：无当前词时告警且不推进', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useReviewStore.getState().completeStep('learn', result)

    const state = useReviewStore.getState()
    expect(state.completedSteps.size).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith('[reviewStore] 无当前单词，无法完成步骤')
  })

  it('completeStep：标记完成、记录结果并自动解锁下一步', async () => {
    const word = makeWord('learn-word')
    useReviewStore.getState().startReview([word])

    await useReviewStore.getState().completeStep('learn', result)

    const state = useReviewStore.getState()
    expect(state.completedSteps.has('learn')).toBe(true)
    expect(state.unlockedSteps.has('read')).toBe(true)
    expect(state.stepResults.learn).toEqual(result)
    expect(state.currentStep).toBe('read')
    expect(recordStepReview).toHaveBeenCalledWith('learn-word', 'learn', result)
  })

  it('completeStep：最后一步 write 完成后清空当前步骤', async () => {
    useReviewStore.getState().startReview([makeWord('write-word')])

    await useReviewStore.getState().completeStep('write', result)

    const state = useReviewStore.getState()
    expect(state.completedSteps.has('write')).toBe(true)
    expect(state.currentStep).toBeNull()
  })

  it('nextWord：队列非空时切到下一词并重置步骤状态', () => {
    const words = [makeWord('a'), makeWord('b')]
    useReviewStore.getState().startReview(words)
    useReviewStore.getState().goToStep('learn')

    useReviewStore.getState().nextWord()

    const state = useReviewStore.getState()
    expect(state.currentWord).toEqual(words[1])
    expect(state.reviewQueue).toEqual([words[1]])
    expect(state.reviewedCount).toBe(1)
    expect(state.currentStep).toBe('learn')
    expect(state.unlockedSteps).toEqual(new Set(['learn']))
    expect(state.allComplete).toBe(false)
  })

  it('nextWord：最后一个词完成后标记全部完成', () => {
    useReviewStore.getState().startReview([makeWord('only')])

    useReviewStore.getState().nextWord()

    const state = useReviewStore.getState()
    expect(state.currentWord).toBeNull()
    expect(state.reviewQueue).toEqual([])
    expect(state.reviewedCount).toBe(1)
    expect(state.allComplete).toBe(true)
  })

  it('skipWord：跳过不增加已复习计数', () => {
    const words = [makeWord('a'), makeWord('b')]
    useReviewStore.getState().startReview(words)

    useReviewStore.getState().skipWord()

    const state = useReviewStore.getState()
    expect(state.currentWord).toEqual(words[1])
    expect(state.reviewedCount).toBe(0)
    expect(state.allComplete).toBe(false)
  })

  it('skipWord：跳过最后一个词后标记全部完成且不增加计数', () => {
    useReviewStore.getState().startReview([makeWord('only')])

    useReviewStore.getState().skipWord()

    const state = useReviewStore.getState()
    expect(state.currentWord).toBeNull()
    expect(state.reviewedCount).toBe(0)
    expect(state.allComplete).toBe(true)
  })

  it('endReview：清空全部状态', () => {
    useReviewStore.getState().startReview([makeWord('a'), makeWord('b')])
    useReviewStore.getState().nextWord()

    useReviewStore.getState().endReview()

    const state = useReviewStore.getState()
    expect(state.currentWord).toBeNull()
    expect(state.currentStep).toBeNull()
    expect(state.unlockedSteps.size).toBe(0)
    expect(state.completedSteps.size).toBe(0)
    expect(state.reviewQueue).toEqual([])
    expect(state.stepResults).toEqual({})
    expect(state.reviewedCount).toBe(0)
    expect(state.totalCount).toBe(0)
    expect(state.allComplete).toBe(false)
  })
})
