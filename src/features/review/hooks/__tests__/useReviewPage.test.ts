// 复习页状态机 hook
//
// 覆盖队列加载（就绪 / 空 / 失败）、缺失字段异步补全、进入五步流程、完成评价、
// 返回列表、庆祝与成就、进度计算与卸载清理。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Achievement, Word } from '@/shared/types'
import { statsService, checkAndUnlockAchievements } from '@/features/stats'
import { wordbookService } from '@/features/wordbook'
import { useReviewStore } from '../../store'
import { useReviewPage } from '../useReviewPage'
import {
  applyWeightedReviewResult,
  getTodayReviewQueueInfo,
} from '../../services/reviewService'

vi.mock('@/features/stats', () => ({
  statsService: { buildAchievementContext: vi.fn() },
  checkAndUnlockAchievements: vi.fn(),
}))

vi.mock('@/features/wordbook', () => ({
  wordbookService: { enrichWord: vi.fn() },
}))

vi.mock('../../services/reviewService', () => ({
  getTodayReviewQueueInfo: vi.fn(),
  applyWeightedReviewResult: vi.fn(),
  recordStepReview: vi.fn().mockResolvedValue(undefined),
}))

const getQueueInfoMock = vi.mocked(getTodayReviewQueueInfo)
const applyWeightedMock = vi.mocked(applyWeightedReviewResult)
const enrichWordMock = vi.mocked(wordbookService.enrichWord)
const buildContextMock = vi.mocked(statsService.buildAchievementContext)
const checkAchievementsMock = vi.mocked(checkAndUnlockAchievements)

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

function makeQueueInfo(words: Word[], total = words.length) {
  return { words, total, limit: 10, reachedLimit: false }
}

const stepResult = { correct: true, correctRate: 1, timeSpent: 5 }

describe('useReviewPage 复习页状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useReviewStore.getState().endReview()
    getQueueInfoMock.mockResolvedValue(makeQueueInfo([]))
    applyWeightedMock.mockResolvedValue(undefined)
    enrichWordMock.mockImplementation(async (id: string) => makeWord(id, { phonetic: '/enriched/' }))
    buildContextMock.mockResolvedValue({
      todayReadCount: 0,
      todayReviewCount: 0,
      todayPerfectCount: 0,
      streakDays: 0,
      totalReadCount: 0,
      totalMasteredWords: 0,
    })
    checkAchievementsMock.mockResolvedValue([])
  })

  it('队列就绪：写入队列信息并显示待复习', async () => {
    const word = makeWord('a')
    getQueueInfoMock.mockResolvedValue(makeQueueInfo([word], 1))

    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.queueInfo?.words).toEqual([word])
    expect(result.current.view).toBe('list')
    expect(result.current.stageLabel).toBe('待复习')
    expect(result.current.initialTotal).toBe(1)
    expect(result.current.reviewProgress).toBe(0)
    expect(result.current.isReviewComplete).toBe(false)
    expect(result.current.errorMsg).toBeNull()
  })

  it('队列为空：状态为 empty', async () => {
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('empty'))

    expect(result.current.queueInfo?.total).toBe(0)
    expect(result.current.stageLabel).toBe('待复习')
  })

  it('队列加载失败：状态为 error 并给出提示', async () => {
    getQueueInfoMock.mockRejectedValue(new Error('network'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.errorMsg).toBe('加载复习队列失败，请稍后重试')
  })

  it('字段缺失的单词异步补全；单个失败保留原词并告警', async () => {
    const needsEnrich = makeWord('need', { phonetic: '', definition: '测试', example: 'example' })
    const failedEnrich = makeWord('fail', { phonetic: '/ok/', definition: '', example: 'example' })
    getQueueInfoMock.mockResolvedValue(makeQueueInfo([needsEnrich, failedEnrich], 2))
    enrichWordMock.mockImplementation(async (id: string) => {
      if (id === 'fail') throw new Error('enrich failed')
      return makeWord(id, { phonetic: '/enriched/' })
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await waitFor(() =>
      expect(result.current.queueInfo?.words[0].phonetic).toBe('/enriched/'),
    )

    expect(result.current.queueInfo?.words[1]).toEqual(failedEnrich)
    expect(warnSpy).toHaveBeenCalledWith(
      '[ReviewPage] enrichWord 补全失败',
      'fail',
      expect.any(Error),
    )
  })

  it('点击单词进入五步流程，其余词作为队列尾', async () => {
    const first = makeWord('a')
    const second = makeWord('b')
    getQueueInfoMock.mockResolvedValue(makeQueueInfo([first, second], 2))
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => result.current.handleWordClick(second))

    expect(result.current.view).toBe('review')
    expect(useReviewStore.getState().currentWord).toEqual(second)
    expect(useReviewStore.getState().reviewQueue.map((w) => w.id)).toEqual(['b', 'a'])
    expect(result.current.stageLabel).toBe('识记')
  })

  it('逐步完成后进入完成评价视图', async () => {
    const word = makeWord('a')
    getQueueInfoMock.mockResolvedValue(makeQueueInfo([word], 1))
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))

    await act(async () => {
      await result.current.handleComplete('learn', stepResult)
    })
    expect(result.current.stageLabel).toBe('朗读')

    await act(async () => {
      await result.current.handleComplete('read', stepResult)
      await result.current.handleComplete('practice', stepResult)
      await result.current.handleComplete('spell', stepResult)
      await result.current.handleComplete('write', stepResult)
    })

    expect(result.current.view).toBe('complete')
    expect(result.current.stageLabel).toBe('完成评价')
  })

  it('返回列表：结束复习并重新加载队列', async () => {
    const word = makeWord('a')
    getQueueInfoMock.mockResolvedValue(makeQueueInfo([word], 1))
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))

    act(() => result.current.handleBackToList())
    await waitFor(() =>
      expect(getQueueInfoMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    )

    expect(result.current.view).toBe('list')
    expect(useReviewStore.getState().currentWord).toBeNull()
  })

  it('已掌握评价：按三环节正确率提交 SM-2 并触发庆祝与成就', async () => {
    const word = makeWord('mastered')
    const achievement = {
      id: 'ach-1',
      name: '成就',
      description: '描述',
      icon: '⭐',
      unlockedAt: 0,
      updated_at: Date.now(),
    } as Achievement
    getQueueInfoMock
      .mockResolvedValueOnce(makeQueueInfo([word], 1))
      .mockResolvedValue(makeQueueInfo([], 0))
    checkAchievementsMock.mockResolvedValue([achievement])
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))
    useReviewStore.setState({
      stepResults: {
        practice: { correct: true, correctRate: 0.8, timeSpent: 1 },
        spell: { correct: true, correctRate: 0.5, timeSpent: 1 },
        write: { correct: true, correctRate: 1, timeSpent: 1 },
      },
    })

    await act(async () => {
      await result.current.handleRating('mastered')
    })

    expect(applyWeightedMock).toHaveBeenCalledWith('mastered', {
      practiceCorrect: 8,
      practiceTotal: 10,
      spellCorrect: 5,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })
    expect(result.current.sessionReviewedCount).toBe(1)
    expect(result.current.celebrating).toBe(true)
    expect(result.current.celebrationText).not.toBe('')
    expect(result.current.unlockedAchievements).toEqual([achievement])
    expect(buildContextMock).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(result.current.isReviewComplete).toBe(true))
    expect(result.current.reviewProgress).toBe(100)
    expect(result.current.stageLabel).toBe('已完成')
    expect(useReviewStore.getState().currentWord).toBeNull()
  })

  it('还需复习评价：三环节全 0 且不触发庆祝与成就', async () => {
    const word = makeWord('again')
    getQueueInfoMock
      .mockResolvedValueOnce(makeQueueInfo([word], 1))
      .mockResolvedValue(makeQueueInfo([], 0))
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))

    await act(async () => {
      await result.current.handleRating('review')
    })

    expect(applyWeightedMock).toHaveBeenCalledWith('again', {
      practiceCorrect: 0,
      practiceTotal: 10,
      spellCorrect: 0,
      spellTotal: 10,
      writeCorrect: 0,
      writeTotal: 10,
    })
    expect(result.current.celebrating).toBe(false)
    expect(result.current.unlockedAchievements).toEqual([])
    expect(checkAchievementsMock).not.toHaveBeenCalled()
  })

  it('评价时无当前词：直接返回列表', async () => {
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('empty'))

    await act(async () => {
      await result.current.handleRating('mastered')
    })

    expect(result.current.view).toBe('list')
    expect(applyWeightedMock).not.toHaveBeenCalled()
  })

  it('应用复习结果失败：告警并仍返回列表', async () => {
    const word = makeWord('fail')
    getQueueInfoMock
      .mockResolvedValueOnce(makeQueueInfo([word], 1))
      .mockResolvedValue(makeQueueInfo([], 0))
    applyWeightedMock.mockRejectedValue(new Error('apply failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))

    await act(async () => {
      await result.current.handleRating('mastered')
    })

    expect(warnSpy).toHaveBeenCalledWith('[ReviewPage] 应用复习结果失败', expect.any(Error))
    expect(result.current.sessionReviewedCount).toBe(0)
    expect(result.current.view).toBe('list')
    expect(useReviewStore.getState().currentWord).toBeNull()
  })

  it('成就检查失败仅记录错误，不影响庆祝动画', async () => {
    const word = makeWord('ach-fail')
    getQueueInfoMock
      .mockResolvedValueOnce(makeQueueInfo([word], 1))
      .mockResolvedValue(makeQueueInfo([], 0))
    buildContextMock.mockRejectedValue(new Error('stats down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))

    await act(async () => {
      await result.current.handleRating('mastered')
    })

    expect(errorSpy).toHaveBeenCalledWith('[Achievement]', expect.any(Error))
    expect(result.current.celebrating).toBe(true)
    expect(result.current.unlockedAchievements).toEqual([])
  })

  it('庆祝动画结束回调关闭浮层', async () => {
    const word = makeWord('celebrate')
    getQueueInfoMock
      .mockResolvedValueOnce(makeQueueInfo([word], 1))
      .mockResolvedValue(makeQueueInfo([], 0))
    const { result } = renderHook(() => useReviewPage())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.handleWordClick(word))
    await act(async () => {
      await result.current.handleRating('mastered')
    })
    expect(result.current.celebrating).toBe(true)

    act(() => result.current.handleCelebrationComplete())

    expect(result.current.celebrating).toBe(false)
  })
})
