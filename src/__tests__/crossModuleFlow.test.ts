//
// 验证多个 service 协作完成完整业务闭环时数据的正确流转：
//
// 测试策略：
// - 完全 mock 各 Repository 单例方法（不依赖真实 IndexedDB 或网络）
// - 使用内存数组作为存储，保持各 service 间的数据流转真实可验证
// - 参考现有 e2e-flow.test.ts / reviewService.test.ts / statsService.test.ts 的 mock 模式
// - mastery 判定一致性：所有模块统一使用 `mastery >= 5` 作为已掌握标准

import type {
  Article,
  Question,
  ReadingSession,
  Review,
  Stats,
  Word,
} from '@/shared/types'
import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import {
  articleRepository,
  questionRepository,
  readingSessionRepository,
  reviewRepository,
  statsRepository,
  wordRepository,
} from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import { markAsRead, getRecentlyReadArticles } from '@/features/reading/services/articleService'
import { extractAndCacheVocabulary } from '@/features/reading/services/vocabularyService'
import { addToWordbook, getWordbook } from '@/features/wordbook/services/wordbookService'
import { getMasteredWords } from '@/features/mastered/services/masteredService'
import { applyWeightedReviewResult } from '@/features/review/services/reviewService'
import {
  recordReadingSession,
  getReadingAbilityTrend,
  getTodayStats,
} from '@/features/stats/services/statsService'

// ---------- 内存 Mock 存储 ----------

let mockArticles: Article[] = []
let mockQuestions: Question[] = []
let mockWords: Word[] = []
let mockReviews: Review[] = []
let mockStats: Stats[] = []
let mockSessions: ReadingSession[] = []

// 保存原始方法引用，便于恢复
const originals = {
  // article
  articleGetAll: articleRepository.getAll,
  articleGetAllLocalFirst: articleRepository.getAllLocalFirst,
  articleGetById: articleRepository.getById,
  articleGetByIdLocalFirst: articleRepository.getByIdLocalFirst,
  articleAdd: articleRepository.add,
  articleUpdate: articleRepository.update,
  articleCount: articleRepository.count,
  // question
  questionWhereEquals: questionRepository.whereEquals,
  questionAdd: questionRepository.add,
  // word
  wordGetAll: wordRepository.getAll,
  wordGetAllLocalFirst: wordRepository.getAllLocalFirst,
  wordGetById: wordRepository.getById,
  wordGetByIdLocalFirst: wordRepository.getByIdLocalFirst,
  wordAdd: wordRepository.add,
  wordUpdate: wordRepository.update,
  wordWhereBelowOrEqual: wordRepository.whereBelowOrEqual,
  wordCountWhereAbove: wordRepository.countWhereAbove,
  wordTriggerRefresh: wordRepository.triggerRefresh,
  // review
  reviewAdd: reviewRepository.add,
  reviewWhereEqualsFiltered: reviewRepository.whereEqualsFiltered,
  // stats
  statsGetById: statsRepository.getById,
  statsAdd: statsRepository.add,
  statsUpdate: statsRepository.update,
  statsWhereBetween: statsRepository.whereBetween,
  // readingSession
  sessionAdd: readingSessionRepository.add,
  sessionWhereAbove: readingSessionRepository.whereAbove,
  sessionWhereAboveOrEqual: readingSessionRepository.whereAboveOrEqual,
  sessionWhereAboveOrEqualFiltered: readingSessionRepository.whereAboveOrEqualFiltered,
  sessionCount: readingSessionRepository.count,
  // AI
  aiExtractVocabulary: aiProvider.extractVocabulary,
  aiGenerateExampleSentence: aiProvider.generateExampleSentence,
  aiGenerateEmojiHint: aiProvider.generateEmojiHint,
}

// 安装 mock：重写各 Repository 单例方法，使用内存数组作为存储
function installMock(): void {
  mockArticles = []
  mockQuestions = []
  mockWords = []
  mockReviews = []
  mockStats = []
  mockSessions = []

  // articleRepository mock
  articleRepository.getAll = async () => [...mockArticles]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  articleRepository.getAllLocalFirst = async () => [...mockArticles]
  articleRepository.getById = async (id: string) =>
    mockArticles.find((a) => a.id === id)
  // SWR 模式：getByIdLocalFirst 与 getById 行为一致（测试中不触发后台刷新）
  articleRepository.getByIdLocalFirst = async (id: string) =>
    mockArticles.find((a) => a.id === id)
  articleRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Article
    mockArticles.push(item)
    return item
  }
  articleRepository.update = async (id, patch) => {
    const idx = mockArticles.findIndex((a) => a.id === id)
    if (idx >= 0) {
      mockArticles[idx] = { ...mockArticles[idx], ...patch, updated_at: Date.now() } as Article
      return mockArticles[idx]
    }
    // 模拟 CachedRemoteRepository 的 404 兜底：返回 fallback 对象
    return { ...patch, id, updated_at: Date.now() } as Article
  }
  articleRepository.count = async () => mockArticles.length

  // questionRepository mock
  questionRepository.whereEquals = async (_field, value) =>
    mockQuestions.filter((q) => q.articleId === (value as string))
  questionRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Question
    mockQuestions.push(item)
    return item
  }

  // wordRepository mock
  wordRepository.getAll = async () => [...mockWords]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  wordRepository.getAllLocalFirst = async () => [...mockWords]
  wordRepository.getById = async (id: string) => mockWords.find((w) => w.id === id)
  // SWR 模式：getByIdLocalFirst 与 getById 行为一致（测试中不触发后台刷新）
  // enrichWord/applyWeightedReviewResult 使用 getByIdLocalFirst，必须 mock 否则访问真实 Dexie
  wordRepository.getByIdLocalFirst = async (id: string) =>
    mockWords.find((w) => w.id === id)
  wordRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Word
    mockWords.push(item)
    return item
  }
  wordRepository.update = async (id, patch) => {
    const idx = mockWords.findIndex((w) => w.id === id)
    if (idx >= 0) {
      mockWords[idx] = { ...mockWords[idx], ...patch, updated_at: Date.now() } as Word
      return mockWords[idx]
    }
    return { ...patch, id, updated_at: Date.now() } as Word
  }
  wordRepository.whereBelowOrEqual = async (field, value) =>
    mockWords.filter((w) => (w[field] as unknown as number) <= (value as unknown as number))
  wordRepository.countWhereAbove = async (_field, value) =>
    mockWords.filter((w) => (w.mastery as number) > (value as unknown as number)).length
  // triggerRefresh 在测试中为 no-op（避免触发后台刷新与 cacheEvents）
  wordRepository.triggerRefresh = () => {}

  // reviewRepository mock
  reviewRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Review
    mockReviews.push(item)
    return item
  }
  reviewRepository.whereEqualsFiltered = async (
    _field,
    _value,
    filter,
  ) => mockReviews.filter(filter as (r: unknown) => boolean)

  // statsRepository mock
  statsRepository.getById = async (id: string) => mockStats.find((s) => s.id === id)
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
    return { ...patch, id, updated_at: Date.now() } as Stats
  }
  statsRepository.whereBetween = async (_field, lower, upper) =>
    mockStats.filter(
      (s) => s.id >= (lower as string) && s.id <= (upper as string),
    )

  // readingSessionRepository mock
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
}

// 恢复原始方法
function restoreMock(): void {
  articleRepository.getAll = originals.articleGetAll
  articleRepository.getAllLocalFirst = originals.articleGetAllLocalFirst
  articleRepository.getById = originals.articleGetById
  articleRepository.getByIdLocalFirst = originals.articleGetByIdLocalFirst
  articleRepository.add = originals.articleAdd
  articleRepository.update = originals.articleUpdate
  articleRepository.count = originals.articleCount
  questionRepository.whereEquals = originals.questionWhereEquals
  questionRepository.add = originals.questionAdd
  wordRepository.getAll = originals.wordGetAll
  wordRepository.getAllLocalFirst = originals.wordGetAllLocalFirst
  wordRepository.getById = originals.wordGetById
  wordRepository.getByIdLocalFirst = originals.wordGetByIdLocalFirst
  wordRepository.add = originals.wordAdd
  wordRepository.update = originals.wordUpdate
  wordRepository.whereBelowOrEqual = originals.wordWhereBelowOrEqual
  wordRepository.countWhereAbove = originals.wordCountWhereAbove
  wordRepository.triggerRefresh = originals.wordTriggerRefresh
  reviewRepository.add = originals.reviewAdd
  reviewRepository.whereEqualsFiltered = originals.reviewWhereEqualsFiltered
  statsRepository.getById = originals.statsGetById
  statsRepository.add = originals.statsAdd
  statsRepository.update = originals.statsUpdate
  statsRepository.whereBetween = originals.statsWhereBetween
  readingSessionRepository.add = originals.sessionAdd
  readingSessionRepository.whereAbove = originals.sessionWhereAbove
  readingSessionRepository.whereAboveOrEqual = originals.sessionWhereAboveOrEqual
  readingSessionRepository.whereAboveOrEqualFiltered = originals.sessionWhereAboveOrEqualFiltered
  readingSessionRepository.count = originals.sessionCount
  aiProvider.extractVocabulary = originals.aiExtractVocabulary
  aiProvider.generateExampleSentence = originals.aiGenerateExampleSentence
  aiProvider.generateEmojiHint = originals.aiGenerateEmojiHint
}

// 获取今日日期字符串 YYYY-MM-DD（本地时区，与 statsService.getTodayStr 行为一致）
function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 构造合法 Article（提供合理默认值）
function makeArticle(overrides: Partial<Article> = {}): Article {
  const now = Date.now()
  return {
    id: 'default-article-id',
    title: '测试文章标题',
    content: 'This is a test article content for cross-module flow.',
    translation: '这是一篇用于跨模块流程测试的文章。',
    genre: 'narrative',
    wordCount: 250,
    createdAt: now,
    updated_at: now,
    topic: 'campus',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [],
    contentHash: undefined,
    readAt: null,
    ...overrides,
  }
}

// vocabularyService 缓存 key 前缀（与 vocabularyService 保持一致）
const VOCAB_CACHE_KEY_PREFIX = 'ydxl-vocab-'

// 清理指定 articleId 的词汇缓存
function clearVocabCache(articleId: string): void {
  localStorage.removeItem(VOCAB_CACHE_KEY_PREFIX + articleId)
}

// ====================================================================
// 验证 mastery 字段在 review/wordbook/mastered 三个模块间的数据一致性
// ====================================================================

describe('跨模块流程 1：复习→掌握流转（生词本⇄已掌握模块）', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 主流程：添加生词 → 复习 5 次全对达到掌握 → 生词本不再显示 → 已掌握模块显示
  it('添加生词 → 复习 5 次全对达到 mastery=5 → 生词本不再返回 → 已掌握模块返回', async () => {
    // === 步骤 1：添加生词（mastery=0） ===
    const word = await addToWordbook({
      word: 'Master',
      phonetic: '/ˈmɑːstə(r)/',
      pos: 'v.',
      definition: '掌握',
      example: 'I master English.',
    })

    // 验证初始状态：mastery=0，在生词本中，不在已掌握中
    expect(word.id).toBe('master')
    expect(word.mastery).toBe(0)
    expect(word.reviewCount).toBe(0)

    // 初始：生词本包含该词
    const wordbookBefore = await getWordbook()
    expect(wordbookBefore.items.map((w) => w.id)).toContain('master')
    expect(wordbookBefore.total).toBe(1)

    // 初始：已掌握模块不包含该词
    const masteredBefore = await getMasteredWords()
    expect(masteredBefore.items.map((w) => w.id)).not.toContain('master')
    expect(masteredBefore.total).toBe(0)

    // === 步骤 2：复习 5 次，每次三环节全对 → mastery 每次提升 +1 直至 5 ===
    // 全对 → 加权率=1.0 → quality=5 → masteryDelta=+1
    // 起始 mastery=0，5 次复习后 mastery=5
    for (let i = 1; i <= 5; i++) {
      await applyWeightedReviewResult('master', {
        practiceCorrect: 10,
        practiceTotal: 10,
        spellCorrect: 10,
        spellTotal: 10,
        writeCorrect: 10,
        writeTotal: 10,
      })
      const current = mockWords.find((w) => w.id === 'master')
      expect(current).toBeDefined()
      // 验证 mastery 按预期递增（clamp 在 [0,5]）
      expect(current!.mastery).toBe(Math.min(5, i))
      expect(current!.reviewCount).toBe(i)
    }

    // 验证复习完成后 word 字段
    const mastered = mockWords.find((w) => w.id === 'master')
    expect(mastered!.mastery).toBe(5)
    expect(mastered!.reviewCount).toBe(5)
    // nextReview 应被推到未来
    expect(mastered!.nextReview).toBeGreaterThan(Date.now())
    // 汇总 Review 记录应写入 5 条
    expect(mockReviews.length).toBe(5)

    // === 步骤 3：验证生词本不再返回该词（mastery >= 5 被过滤） ===
    const wordbookAfter = await getWordbook()
    expect(wordbookAfter.items.map((w) => w.id)).not.toContain('master')
    expect(wordbookAfter.total).toBe(0)

    // === 步骤 4：验证已掌握模块返回该词 ===
    const masteredAfter = await getMasteredWords()
    expect(masteredAfter.items.map((w) => w.id)).toContain('master')
    expect(masteredAfter.total).toBe(1)
    expect(masteredAfter.items[0].mastery).toBe(5)

    // === 步骤 5：验证统计：今日复习数=5，今日掌握数=1（首次达到 mastery=5） ===
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats).toBeDefined()
    expect(todayStats!.wordsReviewed).toBe(5)
    // recordWordMastered 仅在首次达到 mastery >= 5 时调用一次
    expect(todayStats!.wordsMastered).toBe(1)
  })

  // 边界场景：复习中答错不会让 mastery 达到 5，仍在生词本中
  it('复习中答错（quality=0）→ mastery 不增反减，仍在生词本中，不在已掌握中', async () => {
    // 添加生词
    await addToWordbook({ word: 'Hard', definition: '困难' })

    // 复习 3 次全错 → quality=0 → masteryDelta=-1，mastery 从 0 减到 0（clamp 下限）
    for (let i = 0; i < 3; i++) {
      await applyWeightedReviewResult('hard', {
        practiceCorrect: 0,
        practiceTotal: 10,
        spellCorrect: 0,
        spellTotal: 10,
        writeCorrect: 0,
        writeTotal: 10,
      })
    }

    const word = mockWords.find((w) => w.id === 'hard')
    expect(word!.mastery).toBe(0) // clamp 下限 0
    expect(word!.reviewCount).toBe(3)

    // 仍在生词本中（mastery < 5）
    const wordbook = await getWordbook()
    expect(wordbook.items.map((w) => w.id)).toContain('hard')
    expect(wordbook.total).toBe(1)

    // 不在已掌握中
    const mastered = await getMasteredWords()
    expect(mastered.items.map((w) => w.id)).not.toContain('hard')
    expect(mastered.total).toBe(0)

    // 统计：复习 3 次但未掌握
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats!.wordsReviewed).toBe(3)
    expect(todayStats!.wordsMastered).toBe(0)
  })

  // 边界场景：mastery=4 时复习全对 → 首次达到 5 触发 recordWordMastered
  it('mastery=4 时复习全对 → 首次达到 5 触发 recordWordMastered（仅记录一次）', async () => {
    // 直接预置一个 mastery=4 的单词到 mock 存储
    const now = Date.now()
    mockWords.push({
      id: 'near-master',
      word: 'near-master',
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
      mastery: 4,
      nextReview: now,
      lastReview: now,
      reviewCount: 4,
      interval: 7,
      easeFactor: 2.8,
      createdAt: now,
      updated_at: now,
    })

    // 复习一次全对 → mastery 4 → 5，触发 recordWordMastered
    await applyWeightedReviewResult('near-master', {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    const word = mockWords.find((w) => w.id === 'near-master')
    expect(word!.mastery).toBe(5)

    // 验证首次掌握被记录
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats!.wordsMastered).toBe(1)

    // 再次复习全对 → mastery 保持 5（clamp 上限），不应再次记录掌握
    await applyWeightedReviewResult('near-master', {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    const todayStats2 = mockStats.find((s) => s.id === today)!
    // wordsMastered 仍为 1（不重复计数）
    expect(todayStats2.wordsMastered).toBe(1)
    // wordsReviewed 应为 2
    expect(todayStats2.wordsReviewed).toBe(2)
  })
})

// ====================================================================
// 验证 articleService 与 statsService 间的数据流转
// ====================================================================

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

describe('跨模块流程 3：阅读→生词流转（词汇缓存→生词本→复习）', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
    // 清理本次测试可能写入的词汇缓存
    clearVocabCache('vocab-article-1')
  })

  // 主流程：阅读文章 → 提取并缓存词汇 → 缓存可读 → 加入生词本 → 复习可练习
  it('阅读文章 → extractAndCacheVocabulary 缓存词汇 → 缓存命中 → addToWordbook → applyWeightedReviewResult', async () => {
    // === 步骤 1：准备文章 ===
    const article = makeArticle({
      id: 'vocab-article-1',
      content: 'The brave soldier fought in the battle.',
    })

    // === 步骤 2：mock AI 提取词汇并调用 extractAndCacheVocabulary ===
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        importance: 'high',
        exampleTranslation: '一个勇敢的男孩',
      },
      {
        word: 'soldier',
        phonetic: '/ˈsəʊldʒə(r)/',
        pos: 'n.',
        definition: '士兵',
        example: 'a brave soldier',
        importance: 'medium',
      },
    ]
    aiProvider.extractVocabulary = async () => baseItems
    aiProvider.generateExampleSentence = async () => 'The brave soldier fought.'
    aiProvider.generateEmojiHint = async () => ['💪']

    const vocabItems = await extractAndCacheVocabulary(article)

    // 验证词汇已提取并增强
    expect(vocabItems).toHaveLength(2)
    expect(vocabItems[0].word).toBe('brave')
    expect(vocabItems[0].exampleSentence).toBe('The brave soldier fought.')
    expect(vocabItems[0].emojiHint).toEqual(['💪'])

    // === 步骤 3：验证缓存已写入且可读（第二次调用应命中缓存，不调用 AI） ===
    // 重写 extractVocabulary 为抛错版本，确保缓存命中时不被调用
    aiProvider.extractVocabulary = async () => {
      throw new Error('缓存命中时不应调用 AI extractVocabulary')
    }
    const cachedItems = await extractAndCacheVocabulary(article)
    expect(cachedItems).toHaveLength(2)
    expect(cachedItems[0].word).toBe('brave')
    // 缓存数据应保留增强字段
    expect(cachedItems[0].exampleSentence).toBe('The brave soldier fought.')

    // === 步骤 4：从词汇缓存中取词加入生词本 ===
    const targetVocab = vocabItems[0]
    const addedWord = await addToWordbook({
      word: targetVocab.word,
      phonetic: targetVocab.phonetic,
      pos: targetVocab.pos,
      definition: targetVocab.definition,
      example: targetVocab.example,
      sourceArticleId: article.id,
    })

    // 验证生词已加入
    expect(addedWord.id).toBe('brave')
    expect(addedWord.word).toBe('brave')
    expect(addedWord.definition).toBe('勇敢的')
    expect(addedWord.mastery).toBe(0)
    expect(addedWord.reviewCount).toBe(0)
    expect(addedWord.sourceArticleId).toBe('vocab-article-1')

    // 验证生词本包含该词
    const wordbook = await getWordbook()
    expect(wordbook.items.map((w) => w.id)).toContain('brave')
    expect(wordbook.total).toBe(1)

    // === 步骤 5：复习该生词（应用复习结果） ===
    await applyWeightedReviewResult('brave', {
      practiceCorrect: 9,
      practiceTotal: 10,
      spellCorrect: 8,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    // 验证复习后 word 字段已更新
    const reviewedWord = mockWords.find((w) => w.id === 'brave')
    expect(reviewedWord).toBeDefined()
    expect(reviewedWord!.reviewCount).toBe(1)
    // 加权率 = (0.9*0.3 + 0.8*0.3 + 1.0*0.4) = 0.27 + 0.24 + 0.4 = 0.91 → quality=5 → masteryDelta=+1
    expect(reviewedWord!.mastery).toBe(1)
    // nextReview 推到未来
    expect(reviewedWord!.nextReview).toBeGreaterThan(Date.now())
    // 汇总 Review 记录已写入
    expect(mockReviews.length).toBe(1)
    expect(mockReviews[0].wordId).toBe('brave')

    // === 步骤 6：验证统计：今日学习单词=1，今日复习=1 ===
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats).toBeDefined()
    expect(todayStats!.wordsLearned).toBe(1)
    expect(todayStats!.wordsReviewed).toBe(1)
  })

  // 边界场景：AI 提取词汇失败 → 返回空数组，不阻塞后续流程
  it('AI 提取词汇失败 → 返回空数组，不抛错（best-effort）', async () => {
    const article = makeArticle({ id: 'vocab-article-1' })
    aiProvider.extractVocabulary = async () => {
      throw new Error('AI 服务不可用')
    }

    const vocabItems = await extractAndCacheVocabulary(article)
    expect(vocabItems).toEqual([])
    // 不应写入缓存
    expect(localStorage.getItem(VOCAB_CACHE_KEY_PREFIX + 'vocab-article-1')).toBeNull()
  })
})
