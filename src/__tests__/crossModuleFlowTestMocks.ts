// 跨模块流程测试共享内存 Mock
//
// 重写 article / question / word / review / stats / readingSession / AI 单例方法，
// 使用内存数组作为存储；由 crossModuleFlow.test.ts 拆分时抽出，供三条流程复用。
import type {
  Article,
  Question,
  ReadingSession,
  Review,
  Stats,
  Word,
} from '@/shared/types'
import {
  articleRepository,
  questionRepository,
  readingSessionRepository,
  reviewRepository,
  statsRepository,
  wordRepository,
} from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- 内存 Mock 存储 ----------

export let mockArticles: Article[] = []
export let mockQuestions: Question[] = []
export let mockWords: Word[] = []
export let mockReviews: Review[] = []
export let mockStats: Stats[] = []
export let mockSessions: ReadingSession[] = []

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
export function installMock(): void {
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
export function restoreMock(): void {
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
export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 构造合法 Article（提供合理默认值）
export function makeArticle(overrides: Partial<Article> = {}): Article {
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
export const VOCAB_CACHE_KEY_PREFIX = 'ydxl-vocab-'

// 清理指定 articleId 的词汇缓存
export function clearVocabCache(articleId: string): void {
  localStorage.removeItem(VOCAB_CACHE_KEY_PREFIX + articleId)
}

// ====================================================================
// 验证 mastery 字段在 review/wordbook/mastered 三个模块间的数据一致性
// ====================================================================

