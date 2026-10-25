// 跨模块流程 2：阅读→统计流转（markAsRead→最近阅读→阅读能力曲线）
//
// 验证文章标记已读、最近阅读查询与阅读会话写入后的统计联动。
// 由 crossModuleFlow.test.ts 按流程拆分而来，用例内容与断言未改动。

import { markAsRead, getRecentlyReadArticles } from '@/features/reading/services/articleService'
import { recordReadingSession, getReadingAbilityTrend, getTodayStats } from '@/features/stats/services/statsService'
import { mockArticles, mockSessions, installMock, restoreMock, todayStr, makeArticle } from './crossModuleFlowTestMocks'

describe('跨模块流程 2：阅读→统计流转（markAsRead→最近阅读→阅读能力曲线）', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 主流程：生成文章 → 标记已读 → 最近阅读返回 → 记录阅读会话 → 阅读能力曲线更新
  it('阅读文章 → 标记已读 → getRecentlyReadArticles 返回 → recordReadingSession → getReadingAbilityTrend 更新', async () => {
    // === 步骤 1：预置一篇文章（未读状态） ===
    const article = makeArticle({ id: '2024-06-06', readAt: null })
    mockArticles.push(article)

    // 验证初始：未读，最近阅读不返回
    expect(mockArticles[0].readAt).toBeNull()
    const recentBefore = await getRecentlyReadArticles(5)
    expect(recentBefore).toHaveLength(0)

    // === 步骤 2：标记为已读 ===
    await markAsRead('2024-06-06')

    // 验证 readAt 已写入
    const updated = mockArticles.find((a) => a.id === '2024-06-06')
    expect(updated).toBeDefined()
    expect(updated!.readAt).not.toBeNull()
    expect(typeof updated!.readAt).toBe('number')

    // === 步骤 3：验证最近阅读区块返回该文章 ===
    const recentAfter = await getRecentlyReadArticles(5)
    expect(recentAfter).toHaveLength(1)
    expect(recentAfter[0].id).toBe('2024-06-06')
    expect(recentAfter[0].title).toBe('测试文章标题')
    expect(recentAfter[0].readAt).toBe(updated!.readAt)
    // 验证返回精简字段
    expect(recentAfter[0]).not.toHaveProperty('content')
    expect(recentAfter[0]).not.toHaveProperty('translation')

    // === 步骤 4：记录一次完整阅读会话 ===
    // recordReadingSession 会写入 session 并触发 recordArticleRead（累加 articlesRead + 维护 streak）
    await recordReadingSession('2024-06-06', 300, 250, 0.8)

    // 验证会话已写入
    expect(mockSessions.length).toBe(1)
    expect(mockSessions[0].articleId).toBe('2024-06-06')
    expect(mockSessions[0].durationSec).toBe(300)
    expect(mockSessions[0].wordCount).toBe(250)
    expect(mockSessions[0].correctRate).toBeCloseTo(0.8)

    // === 步骤 5：验证今日 stats 已更新（articlesRead=1，streak>=1） ===
    const today = todayStr()
    const todayStats = await getTodayStats()
    expect(todayStats.articlesRead).toBe(1)
    expect(todayStats.streak).toBeGreaterThanOrEqual(1)

    // === 步骤 6：验证阅读能力增长曲线包含本次会话 ===
    const trend = await getReadingAbilityTrend(30)
    expect(trend.length).toBeGreaterThanOrEqual(1)
    // 找到今日数据点
    const todayPoint = trend.find((p) => p.date === today)
    expect(todayPoint).toBeDefined()
    expect(todayPoint!.count).toBe(1)
    expect(todayPoint!.score).toBeCloseTo(0.8, 3)
    expect(todayPoint!.wordCount).toBe(250)
    expect(todayPoint!.durationSec).toBe(300)
  })

  // 边界场景：未读文章不在最近阅读列表中
  it('未读文章（readAt=null）不出现在最近阅读列表', async () => {
    mockArticles.push(makeArticle({ id: 'unread-1', readAt: null }))
    mockArticles.push(makeArticle({ id: 'read-1', readAt: Date.now() }))

    const recent = await getRecentlyReadArticles(5)
    expect(recent).toHaveLength(1)
    expect(recent[0].id).toBe('read-1')
  })

  // 边界场景：多次阅读会话聚合到同一日数据点
  it('多次阅读会话 → 同一日数据点聚合（平均 score / 累加 wordCount 与 durationSec）', async () => {
    mockArticles.push(makeArticle({ id: 'a1', readAt: Date.now() }))
    mockArticles.push(makeArticle({ id: 'a2', readAt: Date.now() }))

    // 记录两次阅读会话
    await recordReadingSession('a1', 300, 200, 1.0)
    await recordReadingSession('a2', 600, 300, 0.6)

    const today = todayStr()
    const trend = await getReadingAbilityTrend(30)
    const todayPoint = trend.find((p) => p.date === today)
    expect(todayPoint).toBeDefined()
    expect(todayPoint!.count).toBe(2)
    // 平均正确率 (1.0 + 0.6) / 2 = 0.8
    expect(todayPoint!.score).toBeCloseTo(0.8, 3)
    // 累加字数与时长
    expect(todayPoint!.wordCount).toBe(500)
    expect(todayPoint!.durationSec).toBe(900)

    // 验证今日 stats：articlesRead=2
    const todayStats = await getTodayStats()
    expect(todayStats.articlesRead).toBe(2)
  })
})

// ====================================================================
// 验证 vocabularyService → wordbookService → reviewService 的数据流转
// ====================================================================

