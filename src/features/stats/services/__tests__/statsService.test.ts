//
// 测试范围：
// 1. getStatsOverview 空数据 → 返回默认值（全 0）
// 2. getStatsOverview 有今日 stats → 返回今日字段
// 3. getStatsOverview 今日 stats 缺失 → 回退昨日 streak
// 4. getStatsByDateRange 区间查询 → 返回范围内记录
// 5. getStatsByDateRange 空区间 → 返回空数组
// 6. getRecentReadingSessions 返回升序会话列表
// 7. getRecentReadingSessions 无会话 → 返回空数组
// 8. buildAchievementContext 空数据 → 全 0
// 9. buildAchievementContext 多维度聚合 → 各字段正确
// 10. recordArticleRead 不存在今日 stats → 创建初始记录并累加
// 11. recordArticleRead 已存在今日 stats → articlesRead + 1
// 12. recordWordLearned → wordsLearned + 1
// 13. recordWordReviewed → wordsReviewed + 1
// 14. recordWordMastered → wordsMastered + 1
// 15. updateStreak 昨天有打卡 → 今日 streak = 昨日 + 1
// 16. updateStreak 昨天无打卡 → 今日 streak = 1
// 17. recordReadingSession → 写入会话并触发 recordArticleRead
// 18. getTodayStats 不存在 → 返回初始值
// 19. getTodayStats 已存在 → 返回数据库记录
//
// Mock 策略：重写 statsRepository / articleRepository / wordRepository /
// readingSessionRepository / reviewRepository 单例上的方法，使用内存数组作为存储
// 参考 wordbookService.test.ts / reviewService.test.ts 的 mock 模式

import type { ReadingSession, Review, Stats } from '@/shared/types'
import {
  recordArticleRead,
  recordWordLearned,
  recordWordReviewed,
  recordWordMastered,
  updateStreak,
  getStatsByDateRange,
  recordReadingSession,
  getRecentReadingSessions,
  getReadingAbilityTrend,
  getTodayStats,
  getStatsOverview,
  buildAchievementContext,
} from '../statsService'
import {
  articleRepository,
  readingSessionRepository,
  reviewRepository,
  statsRepository,
  wordRepository,
} from '@/shared/services'

// ---------- 内存 Mock ----------

// 内存存储
let mockStats: Stats[] = []
let mockSessions: ReadingSession[] = []
let mockReviews: Review[] = []
let mockArticleCount = 0
let mockMasteredCount = 0

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
function installMock(initialStats: Stats[] = [], initialSessions: ReadingSession[] = []): void {
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
function restoreMock(): void {
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
function makeStats(id: string, overrides: Partial<Stats> = {}): Stats {
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
function makeSession(id: string, overrides: Partial<ReadingSession> = {}): ReadingSession {
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
function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 获取昨日日期字符串
function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------- 主测试流程 ----------

describe('statsService', () => {
  // 1. getStatsOverview 空数据 → 返回默认值
  it('getStatsOverview 空数据 → 返回默认值（全 0）', async () => {
    installMock([])
    try {
      const overview = await getStatsOverview()
      expect(overview.totalArticles).toBe(0)
      expect(overview.totalWordsMastered).toBe(0)
      expect(overview.currentStreak).toBe(0)
      expect(overview.todayArticlesRead).toBe(0)
      expect(overview.todayWordsLearned).toBe(0)
      expect(overview.todayWordsReviewed).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 2. getStatsOverview 有今日 stats → 返回今日字段
  it('getStatsOverview 有今日 stats → 返回今日字段', async () => {
    const today = todayStr()
    const todayStats = makeStats(today, {
      articlesRead: 3,
      wordsLearned: 10,
      wordsReviewed: 20,
      streak: 5,
    })
    mockArticleCount = 8
    mockMasteredCount = 15
    installMock([todayStats])
    // 重设被 installMock 重置的计数
    mockArticleCount = 8
    mockMasteredCount = 15
    articleRepository.count = async () => mockArticleCount
    wordRepository.countWhereAbove = async () => mockMasteredCount
    try {
      const overview = await getStatsOverview()
      expect(overview.totalArticles).toBe(8)
      expect(overview.totalWordsMastered).toBe(15)
      expect(overview.currentStreak).toBe(5)
      expect(overview.todayArticlesRead).toBe(3)
      expect(overview.todayWordsLearned).toBe(10)
      expect(overview.todayWordsReviewed).toBe(20)
    } finally {
      restoreMock()
    }
  })

  // 3. getStatsOverview 今日 stats 缺失 → 回退昨日 streak
  it('getStatsOverview 今日 stats 缺失 → 回退昨日 streak', async () => {
    const yesterday = yesterdayStr()
    const yesterdayStats = makeStats(yesterday, { streak: 7 })
    installMock([yesterdayStats])
    try {
      const overview = await getStatsOverview()
      expect(overview.currentStreak).toBe(7)
      // 今日字段为 0（今日 stats 不存在）
      expect(overview.todayArticlesRead).toBe(0)
      expect(overview.todayWordsLearned).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 4. getStatsByDateRange 区间查询 → 返回范围内记录
  it('getStatsByDateRange 区间查询 → 返回范围内记录', async () => {
    const stats = [
      makeStats('2024-01-01', { articlesRead: 1 }),
      makeStats('2024-01-02', { articlesRead: 2 }),
      makeStats('2024-01-03', { articlesRead: 3 }),
      makeStats('2024-01-04', { articlesRead: 4 }),
    ]
    installMock(stats)
    try {
      const result = await getStatsByDateRange('2024-01-02', '2024-01-03')
      expect(result.length).toBe(2)
      expect(result.map((s) => s.id)).toEqual(['2024-01-02', '2024-01-03'])
    } finally {
      restoreMock()
    }
  })

  // 5. getStatsByDateRange 空区间 → 返回空数组
  it('getStatsByDateRange 空区间 → 返回空数组', async () => {
    installMock([makeStats('2024-01-01')])
    try {
      const result = await getStatsByDateRange('2024-02-01', '2024-02-28')
      expect(result).toEqual([])
    } finally {
      restoreMock()
    }
  })

  // 6. getRecentReadingSessions 返回升序会话列表
  it('getRecentReadingSessions 返回升序会话列表', async () => {
    const now = Date.now()
    // 倒序插入，验证返回时按 reviewedAt 升序排序
    const sessions = [
      makeSession('s-3', { reviewedAt: now - 100 }),
      makeSession('s-1', { reviewedAt: now - 1000 }),
      makeSession('s-2', { reviewedAt: now - 500 }),
    ]
    installMock([], sessions)
    try {
      const result = await getRecentReadingSessions(30)
      expect(result.length).toBe(3)
      // 验证按 reviewedAt 升序排序
      expect(result[0].id).toBe('s-1')
      expect(result[1].id).toBe('s-2')
      expect(result[2].id).toBe('s-3')
    } finally {
      restoreMock()
    }
  })

  // 7. getRecentReadingSessions 无会话 → 返回空数组
  it('getRecentReadingSessions 无会话 → 返回空数组', async () => {
    installMock([], [])
    try {
      const result = await getRecentReadingSessions(30)
      expect(result).toEqual([])
    } finally {
      restoreMock()
    }
  })

  //
  // 验证要点：
  // - 单篇/多篇/跨天/无数据 场景下的聚合
  // - 时间窗口 cutoff 边界（>=，包含边界值）
  // - 缺失字段兜底（correctRate NaN/undefined → 0；wordCount NaN/≤0/undefined → 200；
  //   durationSec NaN/undefined/<0 → 0）
  // - 阅读时长累计
  // - 输出按 date 升序

  // 计算今日本地 00:00 时间戳（与 statsService.getReadingAbilityTrend 内部一致）
  function startOfTodayTs(): number {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
  }

  // 计算今日日期字符串 YYYY-MM-DD（本地时区）
  function todayDateStr(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // 计算昨日日期字符串 YYYY-MM-DD（本地时区）
  function yesterdayDateStr(): string {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // 20. getReadingAbilityTrend 单篇阅读 → 单日单点聚合
  it('getReadingAbilityTrend 单篇阅读 → 单日单点聚合（score/wordCount/durationSec/count 正确）', async () => {
    const today = todayDateStr()
    const sessions = [
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: 250,
        durationSec: 300,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      expect(trend[0].score).toBeCloseTo(0.8, 3)
      expect(trend[0].wordCount).toBe(250)
      expect(trend[0].durationSec).toBe(300)
      expect(trend[0].count).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 21. getReadingAbilityTrend 多篇同日 → 平均 score / 累加 wordCount 与 durationSec
  it('getReadingAbilityTrend 多篇同日 → 平均 score 与累加 wordCount/durationSec', async () => {
    const today = todayDateStr()
    const sessions = [
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: 300,
      }),
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: 1.0,
        wordCount: 300,
        durationSec: 600,
      }),
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 0.5,
        wordCount: 100,
        durationSec: 120,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 平均正确率 (0.8 + 1.0 + 0.5) / 3 ≈ 0.767
      expect(trend[0].score).toBeCloseTo(0.767, 2)
      // 累加字数与时长
      expect(trend[0].wordCount).toBe(600)
      expect(trend[0].durationSec).toBe(1020)
      expect(trend[0].count).toBe(3)
    } finally {
      restoreMock()
    }
  })

  // 22. getReadingAbilityTrend 跨天会话 → 多日数据点按 date 升序
  it('getReadingAbilityTrend 跨天会话 → 多日数据点按 date 升序', async () => {
    const start = startOfTodayTs()
    const yesterday = yesterdayDateStr()
    const today = todayDateStr()
    // 倒序插入，验证返回按 date 升序
    const sessions = [
      makeSession('s-today', {
        reviewedAt: start + 5000,
        correctRate: 1.0,
        wordCount: 250,
        durationSec: 300,
      }),
      makeSession('s-yesterday', {
        reviewedAt: start - 24 * 60 * 60 * 1000 + 5000,
        correctRate: 0.5,
        wordCount: 150,
        durationSec: 200,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(2)
      // 升序：昨天在前，今天在后
      expect(trend[0].date).toBe(yesterday)
      expect(trend[1].date).toBe(today)
      // 验证字段正确
      expect(trend[0].score).toBeCloseTo(0.5, 3)
      expect(trend[0].count).toBe(1)
      expect(trend[1].score).toBeCloseTo(1.0, 3)
      expect(trend[1].count).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 23. getReadingAbilityTrend 无数据 → 空数组
  it('getReadingAbilityTrend 无数据 → 空数组', async () => {
    installMock([], [])
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend).toEqual([])
    } finally {
      restoreMock()
    }
  })

  // 24. getReadingAbilityTrend 缺失字段 correctRate（NaN/undefined/越界）→ 兜底 0
  it('getReadingAbilityTrend correctRate NaN/undefined/越界 → 兜底 0 不污染聚合', async () => {
    const today = todayDateStr()
    const sessions = [
      // NaN 正确率
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: NaN,
        wordCount: 200,
        durationSec: 100,
      }),
      // undefined 正确率（通过 as 绕过类型，模拟历史脏数据）
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: undefined as unknown as number,
        wordCount: 200,
        durationSec: 100,
      }),
      // 越界（>1）正确率
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 5,
        wordCount: 200,
        durationSec: 100,
      }),
      // 负数正确率
      makeSession('s-4', {
        reviewedAt: startOfTodayTs() + 4000,
        correctRate: -0.5,
        wordCount: 200,
        durationSec: 100,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 全部兜底为 0/1/0，平均正确率应为 0
      // NaN→0, undefined→0, 5→1（裁剪到 [0,1]）, -0.5→0
      // 平均 = (0 + 0 + 1 + 0) / 4 = 0.25
      expect(trend[0].score).toBeCloseTo(0.25, 3)
      expect(trend[0].count).toBe(4)
      // 字数应为 4 * 200 = 800（无 NaN 污染）
      expect(trend[0].wordCount).toBe(800)
      expect(trend[0].durationSec).toBe(400)
    } finally {
      restoreMock()
    }
  })

  // 25. getReadingAbilityTrend 缺失字段 wordCount（NaN/≤0/undefined）→ 兜底 200
  it('getReadingAbilityTrend wordCount NaN/≤0/undefined → 兜底 200 不产生 NaN', async () => {
    const today = todayDateStr()
    const sessions = [
      // NaN 字数
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: NaN,
        durationSec: 100,
      }),
      // undefined 字数
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: 0.8,
        wordCount: undefined as unknown as number,
        durationSec: 100,
      }),
      // 0 字数
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 0.8,
        wordCount: 0,
        durationSec: 100,
      }),
      // 负数字数
      makeSession('s-4', {
        reviewedAt: startOfTodayTs() + 4000,
        correctRate: 0.8,
        wordCount: -50,
        durationSec: 100,
      }),
      // 有效字数（应原样累加）
      makeSession('s-5', {
        reviewedAt: startOfTodayTs() + 5000,
        correctRate: 0.8,
        wordCount: 300,
        durationSec: 100,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 4 个无效字段兜底为 200，1 个有效为 300，合计 4*200 + 300 = 1100
      expect(trend[0].wordCount).toBe(1100)
      // 不应出现 NaN
      expect(Number.isNaN(trend[0].wordCount)).toBe(false)
      expect(Number.isNaN(trend[0].score)).toBe(false)
    } finally {
      restoreMock()
    }
  })

  // 26. getReadingAbilityTrend cutoff 边界 → 30 天窗口首日 00:00 的会话被包含
  it('getReadingAbilityTrend cutoff 边界 → 30 天窗口首日 00:00 的会话被包含（>=）', async () => {
    const start = startOfTodayTs()
    // 30 天窗口：cutoff = start - 29 * 86400000
    const cutoff = start - 29 * 24 * 60 * 60 * 1000
    // 在 cutoff 时刻恰好有一条会话（应被包含，验证 >= 而非 >）
    const boundarySession = makeSession('s-boundary', {
      reviewedAt: cutoff,
      correctRate: 0.5,
      wordCount: 200,
      durationSec: 100,
    })
    // 比 cutoff 早 1ms 的会话（应被排除）
    const tooOldSession = makeSession('s-too-old', {
      reviewedAt: cutoff - 1,
      correctRate: 1.0,
      wordCount: 200,
      durationSec: 100,
    })
    installMock([], [boundarySession, tooOldSession])
    try {
      const trend = await getReadingAbilityTrend(30)
      // 仅 boundarySession 被包含
      expect(trend.length).toBe(1)
      expect(trend[0].count).toBe(1)
      expect(trend[0].score).toBeCloseTo(0.5, 3)
    } finally {
      restoreMock()
    }
  })

  // 27. getReadingAbilityTrend 超出窗口的会话被过滤
  it('getReadingAbilityTrend 超出窗口的会话被过滤', async () => {
    const start = startOfTodayTs()
    const today = todayDateStr()
    // 30 天前 00:00 之前 1ms 的会话（应被排除）
    const outOfRange = makeSession('s-old', {
      reviewedAt: start - 30 * 24 * 60 * 60 * 1000,
      correctRate: 1.0,
      wordCount: 200,
      durationSec: 100,
    })
    // 今日会话（应被包含）
    const todaySession = makeSession('s-today', {
      reviewedAt: start + 1000,
      correctRate: 0.7,
      wordCount: 250,
      durationSec: 200,
    })
    installMock([], [outOfRange, todaySession])
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      expect(trend[0].count).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 28. getReadingAbilityTrend days=1 → 仅今日
  it('getReadingAbilityTrend days=1 → 仅今日窗口', async () => {
    const start = startOfTodayTs()
    const today = todayDateStr()
    const yesterday = yesterdayDateStr()
    // 昨日会话（应被排除）
    const yesterdaySession = makeSession('s-y', {
      reviewedAt: start - 24 * 60 * 60 * 1000 + 1000,
      correctRate: 1.0,
      wordCount: 200,
      durationSec: 100,
    })
    // 今日会话（应被包含）
    const todaySession = makeSession('s-t', {
      reviewedAt: start + 1000,
      correctRate: 0.6,
      wordCount: 180,
      durationSec: 240,
    })
    installMock([], [yesterdaySession, todaySession])
    try {
      const trend = await getReadingAbilityTrend(1)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      expect(trend[0].count).toBe(1)
      expect(yesterday).not.toBe(today)
    } finally {
      restoreMock()
    }
  })

  // 29. getReadingAbilityTrend 缺失 durationSec → 兜底 0 不污染累加
  it('getReadingAbilityTrend durationSec NaN/undefined/<0 → 兜底 0', async () => {
    const today = todayDateStr()
    const sessions = [
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: NaN,
      }),
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: undefined as unknown as number,
      }),
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: -100,
      }),
      makeSession('s-4', {
        reviewedAt: startOfTodayTs() + 4000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: 500,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 3 个无效兜底为 0，1 个有效为 500，合计 500
      expect(trend[0].durationSec).toBe(500)
      expect(Number.isNaN(trend[0].durationSec)).toBe(false)
    } finally {
      restoreMock()
    }
  })

  // 8. buildAchievementContext 空数据 → 全 0
  it('buildAchievementContext 空数据 → 全 0', async () => {
    installMock([], [])
    try {
      const ctx = await buildAchievementContext()
      expect(ctx.todayReadCount).toBe(0)
      expect(ctx.todayReviewCount).toBe(0)
      expect(ctx.todayPerfectCount).toBe(0)
      expect(ctx.streakDays).toBe(0)
      expect(ctx.totalReadCount).toBe(0)
      expect(ctx.totalMasteredWords).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 9. buildAchievementContext 多维度聚合 → 各字段正确
  it('buildAchievementContext 多维度聚合 → 各字段正确', async () => {
    const today = todayStr()
    const todayStats = makeStats(today, { streak: 4 })
    // 今天 00:00 之后创建的会话
    const now = new Date()
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    ).getTime()
    const sessions = [
      makeSession('s-1', { reviewedAt: startOfToday + 1000, correctRate: 0.8 }),
      makeSession('s-2', { reviewedAt: startOfToday + 2000, correctRate: 1 }),
      makeSession('s-3', { reviewedAt: startOfToday + 3000, correctRate: 1 }),
      // 早期会话（应被过滤）
      makeSession('s-old', { reviewedAt: startOfToday - 10000, correctRate: 1 }),
    ]
    mockReviews = [
      { id: 'r-1', wordId: 'w-1', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 500, updated_at: 0 },
      { id: 'r-2', wordId: 'w-2', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 600, updated_at: 0 },
      // 早期复习记录应被过滤
      { id: 'r-old', wordId: 'w-3', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday - 1000, updated_at: 0 },
    ]
    installMock([todayStats], sessions)
    // 重新注入 reviews（installMock 会清空）
    mockReviews = [
      { id: 'r-1', wordId: 'w-1', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 500, updated_at: 0 },
      { id: 'r-2', wordId: 'w-2', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday + 600, updated_at: 0 },
      { id: 'r-old', wordId: 'w-3', step: 'write', correct: true, correctRate: 1, timeSpent: 1000, reviewedAt: startOfToday - 1000, updated_at: 0 },
    ]
    // 重写 reviewRepository.whereEqualsFiltered 使其读取 mockReviews
    reviewRepository.whereEqualsFiltered = async (
      _field,
      _value,
      filter,
    ) => mockReviews.filter(filter as (r: unknown) => boolean)
    try {
      const ctx = await buildAchievementContext()
      // 今日阅读 3 篇（s-1/s-2/s-3，s-old 被过滤）
      expect(ctx.todayReadCount).toBe(3)
      // 今日全对 2 次（s-2/s-3）
      expect(ctx.todayPerfectCount).toBe(2)
      // 今日复习 2 个（r-1/r-2，r-old 被过滤）
      expect(ctx.todayReviewCount).toBe(2)
      // streak 来自今日 stats
      expect(ctx.streakDays).toBe(4)
      // 总阅读篇数（全部 sessions）
      expect(ctx.totalReadCount).toBe(4)
    } finally {
      restoreMock()
    }
  })

  // 10. recordArticleRead 不存在今日 stats → 创建初始记录并累加
  it('recordArticleRead 不存在今日 stats → 创建初始记录并累加', async () => {
    const today = todayStr()
    installMock([])
    try {
      await recordArticleRead(today)
      // 验证今日 stats 已创建
      const stats = mockStats.find((s) => s.id === today)
      expect(stats).toBeDefined()
      expect(stats!.articlesRead).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 11. recordArticleRead 已存在今日 stats → articlesRead + 1
  it('recordArticleRead 已存在今日 stats → articlesRead + 1', async () => {
    const today = todayStr()
    const existing = makeStats(today, { articlesRead: 5, streak: 2 })
    installMock([existing])
    try {
      await recordArticleRead(today)
      const stats = mockStats.find((s) => s.id === today)
      expect(stats!.articlesRead).toBe(6)
    } finally {
      restoreMock()
    }
  })

  // 12. recordWordLearned → wordsLearned + 1
  it('recordWordLearned → wordsLearned + 1', async () => {
    const today = todayStr()
    const existing = makeStats(today, { wordsLearned: 10 })
    installMock([existing])
    try {
      await recordWordLearned(today)
      const stats = mockStats.find((s) => s.id === today)
      expect(stats!.wordsLearned).toBe(11)
    } finally {
      restoreMock()
    }
  })

  // 13. recordWordReviewed → wordsReviewed + 1
  it('recordWordReviewed → wordsReviewed + 1', async () => {
    const today = todayStr()
    const existing = makeStats(today, { wordsReviewed: 7 })
    installMock([existing])
    try {
      await recordWordReviewed(today)
      const stats = mockStats.find((s) => s.id === today)
      expect(stats!.wordsReviewed).toBe(8)
    } finally {
      restoreMock()
    }
  })

  // 14. recordWordMastered → wordsMastered + 1
  it('recordWordMastered → wordsMastered + 1', async () => {
    const today = todayStr()
    const existing = makeStats(today, { wordsMastered: 3 })
    installMock([existing])
    try {
      await recordWordMastered(today)
      const stats = mockStats.find((s) => s.id === today)
      expect(stats!.wordsMastered).toBe(4)
    } finally {
      restoreMock()
    }
  })

  // 15. updateStreak 昨天有打卡 → 今日 streak = 昨日 + 1
  it('updateStreak 昨天有打卡 → 今日 streak = 昨日 + 1', async () => {
    const today = '2024-05-10'
    const yesterday = '2024-05-09'
    const yesterdayStats = makeStats(yesterday, { streak: 4 })
    installMock([yesterdayStats])
    try {
      await updateStreak(today)
      // updateStreak 内部今日不存在时 add 一条新记录
      const todayStats = mockStats.find((s) => s.id === today)
      expect(todayStats).toBeDefined()
      expect(todayStats!.streak).toBe(5)
    } finally {
      restoreMock()
    }
  })

  // 16. updateStreak 昨天无打卡 → 今日 streak = 1
  it('updateStreak 昨天无打卡 → 今日 streak = 1', async () => {
    const today = '2024-05-10'
    installMock([])
    try {
      await updateStreak(today)
      const todayStats = mockStats.find((s) => s.id === today)
      expect(todayStats).toBeDefined()
      expect(todayStats!.streak).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 17. recordReadingSession → 写入会话并触发 recordArticleRead
  it('recordReadingSession → 写入会话并触发 recordArticleRead', async () => {
    const today = todayStr()
    installMock([])
    try {
      await recordReadingSession('art-2024-01-01', 300, 250, 0.8)

      // 验证会话已写入
      expect(mockSessions.length).toBe(1)
      expect(mockSessions[0].articleId).toBe('art-2024-01-01')
      expect(mockSessions[0].durationSec).toBe(300)
      expect(mockSessions[0].wordCount).toBe(250)
      expect(mockSessions[0].correctRate).toBeCloseTo(0.8)
      // 验证 recordArticleRead 被触发：今日 stats 创建且 articlesRead=1
      const stats = mockStats.find((s) => s.id === today)
      expect(stats).toBeDefined()
      expect(stats!.articlesRead).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 18. getTodayStats 不存在 → 返回初始值
  it('getTodayStats 不存在 → 返回初始值', async () => {
    installMock([])
    try {
      const stats = await getTodayStats()
      expect(stats.articlesRead).toBe(0)
      expect(stats.wordsLearned).toBe(0)
      expect(stats.wordsReviewed).toBe(0)
      expect(stats.wordsMastered).toBe(0)
      expect(stats.streak).toBe(0)
      // 验证未写入数据库（仅返回初始值）
      expect(mockStats.length).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 19. getTodayStats 已存在 → 返回数据库记录
  it('getTodayStats 已存在 → 返回数据库记录', async () => {
    const today = todayStr()
    const existing = makeStats(today, {
      articlesRead: 2,
      wordsLearned: 5,
      streak: 3,
    })
    installMock([existing])
    try {
      const stats = await getTodayStats()
      expect(stats.articlesRead).toBe(2)
      expect(stats.wordsLearned).toBe(5)
      expect(stats.streak).toBe(3)
    } finally {
      restoreMock()
    }
  })
})
