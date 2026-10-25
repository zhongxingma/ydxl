// statsService 学习记录写入
//
// 文章阅读、单词学习 / 复习 / 掌握、连续打卡、阅读会话写入与 getTodayStats。
// 由 statsService.test.ts 按职责拆分而来，用例内容与断言未改动。

import { recordArticleRead, recordWordLearned, recordWordReviewed, recordWordMastered, updateStreak, recordReadingSession, getTodayStats } from '../statsService'
import { mockStats, mockSessions, installMock, restoreMock, makeStats, todayStr } from './statsServiceTestMocks'

describe('statsService 学习记录写入', () => {
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
