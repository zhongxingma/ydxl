// statsService 测试共享内存 Mock
//
// 重写 statsRepository / articleRepository / wordRepository /
// readingSessionRepository / reviewRepository 单例上的方法，使用内存数组作为存储；
// 由 statsService.test.ts 拆分时抽出，供查询 / 趋势 / 记录三组测试复用。
import type { ReadingSession, Review, Stats } from '@/shared/types'
import {
  articleRepository,
  readingSessionRepository,
  reviewRepository,
  statsRepository,
  wordRepository,
} from '@/shared/services'

// ---------- 内存 Mock ----------

// 内存存储
export let mockStats: Stats[] = []
export let mockSessions: ReadingSession[] = []
export let mockReviews: Review[] = []
export let mockArticleCount = 0
export let mockMasteredCount = 0

// 供测试调整 installMock 重置后的计数 / 复习记录
export function setMockArticleCount(value: number): void {
  mockArticleCount = value
}

export function setMockMasteredCount(value: number): void {
  mockMasteredCount = value
}

export function setMockReviews(reviews: Review[]): void {
  mockReviews = reviews
}

// 保存原始方法引用
const originals = {
  statsGetById: statsRepository.getById,
  statsAdd: statsRepository.add,
  statsUpdate: statsRepository.update,
  statsWhereBetween: statsRepository.whereBetween,
  articleCount: articleRepository.count,
  wordCountWhereAbove: wordRepository.countWhereAbove,
  sessionAdd: readingSessionRepository.add,
  sessionWhereAbove: readingSessionRepository.whereAbove,
  sessionWhereAboveOrEqual: readingSessionRepository.whereAboveOrEqual,
  sessionWhereAboveOrEqualFiltered: readingSessionRepository.whereAboveOrEqualFiltered,
  sessionCount: readingSessionRepository.count,
  reviewWhereEqualsFiltered: reviewRepository.whereEqualsFiltered,
}

// 安装 mock
export function installMock(initialStats: Stats[] = [], initialSessions: ReadingSession[] = []): void {
  mockStats = [...initialStats]
  mockSessions = [...initialSessions]
  mockReviews = []
  mockArticleCount = 0
  mockMasteredCount = 0

  statsRepository.getById = async (id: string) =>
    mockStats.find((s) => s.id === id)

  statsRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Stats
    mockStats.push(item)
    return item
  }

  statsRepository.update = async (id, patch) => {
    const idx = mockStats.findIndex((s) => s.id === id)
    if (idx >= 0) {
      mockStats[idx] = { ...mockStats[idx], ...patch, updated_at: Date.now() } as Stats
      return mockStats[idx]
    }
    // idx < 0 模拟服务器返回的更新后对象
    return { ...patch, id, updated_at: Date.now() } as Stats
  }

  statsRepository.whereBetween = async (_field, lower, upper) =>
    mockStats.filter(
      (s) => s.id >= (lower as string) && s.id <= (upper as string),
    )

  articleRepository.count = async () => mockArticleCount

  wordRepository.countWhereAbove = async () => mockMasteredCount

  readingSessionRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as ReadingSession
    mockSessions.push(item)
    return item
  }

  readingSessionRepository.whereAbove = async (_field, value) =>
    mockSessions.filter((s) => s.reviewedAt > (value as number))

  readingSessionRepository.whereAboveOrEqual = async (_field, value) =>
    mockSessions.filter((s) => s.reviewedAt >= (value as number))

  readingSessionRepository.whereAboveOrEqualFiltered = async (
    _field,
    value,
    filter,
  ) => mockSessions.filter((s) => s.reviewedAt >= (value as number) && filter(s))

  readingSessionRepository.count = async () => mockSessions.length

  reviewRepository.whereEqualsFiltered = async (
    _field,
    _value,
    filter,
  ) => mockReviews.filter(filter as (r: unknown) => boolean)
}

// 恢复原始方法
export function restoreMock(): void {
  statsRepository.getById = originals.statsGetById
  statsRepository.add = originals.statsAdd
  statsRepository.update = originals.statsUpdate
  statsRepository.whereBetween = originals.statsWhereBetween
  articleRepository.count = originals.articleCount
  wordRepository.countWhereAbove = originals.wordCountWhereAbove
  readingSessionRepository.add = originals.sessionAdd
  readingSessionRepository.whereAbove = originals.sessionWhereAbove
  readingSessionRepository.whereAboveOrEqual = originals.sessionWhereAboveOrEqual
  readingSessionRepository.whereAboveOrEqualFiltered = originals.sessionWhereAboveOrEqualFiltered
  readingSessionRepository.count = originals.sessionCount
  reviewRepository.whereEqualsFiltered = originals.reviewWhereEqualsFiltered
}

// 构造 Stats 对象
export function makeStats(id: string, overrides: Partial<Stats> = {}): Stats {
  return {
    id,
    articlesRead: 0,
    wordsLearned: 0,
    wordsReviewed: 0,
    wordsMastered: 0,
    streak: 0,
    updated_at: 0,
    ...overrides,
  }
}

// 构造 ReadingSession 对象
export function makeSession(id: string, overrides: Partial<ReadingSession> = {}): ReadingSession {
  const now = Date.now()
  return {
    id,
    articleId: 'art-1',
    durationSec: 300,
    wordCount: 250,
    correctRate: 0.8,
    reviewedAt: now,
    updated_at: now,
    ...overrides,
  }
}

// 获取今日日期字符串（与 statsService.getTodayStr 行为一致）
export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 获取昨日日期字符串
export function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
