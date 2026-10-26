// useProfileStats 个人中心统计 hook 单元测试
//
// 覆盖场景：
// 1. 首次渲染 loading 为 true
// 2. 并行加载会话 / 生词总量 / 掌握数 / 成就并计算时长文案
// 3. 单数据源失败时告警、loading 结束且保持空统计
// 4. 卸载后丢弃异步结果
// 5. formatDuration 各档格式化
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Achievement, ReadingSession } from '@/shared/types'

vi.mock('@/shared/services', () => ({
  readingSessionRepository: { getAll: vi.fn() },
  wordRepository: { count: vi.fn(), countWhereAbove: vi.fn() },
}))

vi.mock('@/features/stats/services/achievementService', () => ({
  getUnlockedAchievements: vi.fn(),
}))

import { useProfileStats, formatDuration } from '../useProfileStats'
import { readingSessionRepository, wordRepository } from '@/shared/services'
import { getUnlockedAchievements } from '@/features/stats/services/achievementService'

const sessionsMock = vi.mocked(readingSessionRepository.getAll)
const wordCountMock = vi.mocked(wordRepository.count)
const masteredCountMock = vi.mocked(wordRepository.countWhereAbove)
const achievementsMock = vi.mocked(getUnlockedAchievements)

function makeSession(id: string, durationSec: number): ReadingSession {
  return {
    id,
    updated_at: Date.now(),
    articleId: id,
    durationSec,
    wordCount: 100,
    correctRate: 0.8,
    reviewedAt: Date.now(),
  }
}

const achievement: Achievement = {
  id: 'reading-star',
  updated_at: Date.now(),
  name: '阅读之星',
  description: '读完 10 篇',
  icon: '⭐',
  unlockedAt: Date.now(),
}

describe('useProfileStats 个人统计', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sessionsMock.mockResolvedValue([makeSession('s1', 60), makeSession('s2', 120)])
    wordCountMock.mockResolvedValue(42)
    masteredCountMock.mockResolvedValue(7)
    achievementsMock.mockResolvedValue([achievement])
  })

  it('首次渲染 loading 为 true 且统计为空', async () => {
    const { result } = renderHook(() => useProfileStats())

    expect(result.current.loading).toBe(true)
    expect(result.current.stats).toBeNull()
    expect(result.current.durationText).toBe('--')

    // 等待异步完成，避免 act 警告
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('加载完成后计算阅读数、生词数、时长与成就', async () => {
    const { result } = renderHook(() => useProfileStats())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.stats).toEqual({
      totalReadCount: 2,
      totalWords: 42,
      totalDurationSec: 180,
      totalMasteredWords: 7,
    })
    expect(result.current.achievements).toEqual([achievement])
    expect(result.current.durationText).toBe('3 分钟')
    expect(masteredCountMock).toHaveBeenCalledWith('mastery', 4)
  })

  it('时长为 0 时文案为 0 分钟', async () => {
    sessionsMock.mockResolvedValue([makeSession('s1', 0)])
    const { result } = renderHook(() => useProfileStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.durationText).toBe('0 分钟')
  })

  it('数据源失败时告警并结束 loading，统计保持为空', async () => {
    wordCountMock.mockRejectedValue(new Error('db down'))
    const { result } = renderHook(() => useProfileStats())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.stats).toBeNull()
    expect(result.current.achievements).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('加载统计数据失败'),
      expect.any(Error)
    )
  })

  it('卸载后异步结果被丢弃', async () => {
    let resolveSessions: ((sessions: ReadingSession[]) => void) | undefined
    sessionsMock.mockReturnValue(
      new Promise<ReadingSession[]>((resolve) => {
        resolveSessions = resolve
      })
    )

    const { unmount } = renderHook(() => useProfileStats())
    unmount()

    expect(() => {
      resolveSessions?.([makeSession('s1', 30)])
    }).not.toThrow()
  })
})

describe('formatDuration 时长格式化', () => {
  it('按秒 / 分钟 / 小时分档', () => {
    expect(formatDuration(0)).toBe('0 分钟')
    expect(formatDuration(-10)).toBe('0 分钟')
    expect(formatDuration(45)).toBe('45 秒')
    expect(formatDuration(125)).toBe('2 分钟')
    expect(formatDuration(3725)).toBe('1 小时 2 分钟')
    expect(formatDuration(3600)).toBe('1 小时 0 分钟')
  })
})
