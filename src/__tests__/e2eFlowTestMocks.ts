// E2E 用户完整流程测试共用的内存 Mock 存储与数据工厂
//
// 由 e2e-flow.test.ts 拆分时抽取，供 article / learning / complete 三个流程文件共用。
// 完全 mock AIProvider 与各 Repository（不依赖真实 IndexedDB 或网络）。

import type {
  Article,
  Question,
  ReadingSession,
  Review,
  Stats,
  Word,
} from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'
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

// 保存原始方法引用
const originals = {
  // article
  articleGetAll: articleRepository.getAll,
  articleGetById: articleRepository.getById,
  articleAdd: articleRepository.add,
  articleUpdate: articleRepository.update,
  // question
  questionWhereEquals: questionRepository.whereEquals,
  questionAdd: questionRepository.add,
  // word
  wordGetById: wordRepository.getById,
  wordGetByIdLocalFirst: wordRepository.getByIdLocalFirst,
  wordAdd: wordRepository.add,
  wordUpdate: wordRepository.update,
  // review
  reviewAdd: reviewRepository.add,
  // stats
  statsGetById: statsRepository.getById,
  statsAdd: statsRepository.add,
  statsUpdate: statsRepository.update,
  // readingSession
  sessionAdd: readingSessionRepository.add,
  // AI
  aiGenerateArticle: aiProvider.generateArticle,
  aiGenerateQuestions: aiProvider.generateQuestions,
}

// 安装 mock
export function installMock(): void {
  mockArticles = []
  mockQuestions = []
  mockWords = []
  mockReviews = []
  mockStats = []
  mockSessions = []

  // articleRepository mock（add 返回实体，generateArticle 直接返回 saveArticle 的结果）
  articleRepository.getAll = async () => [...mockArticles]
  articleRepository.getById = async (id: string) =>
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
    }
    return mockArticles[idx] ?? ({} as Article)
  }

  // questionRepository mock（add 返回实体，保持与 CachedRemoteRepository 行为一致）
  questionRepository.whereEquals = async (_field, value) =>
    mockQuestions.filter((q) => q.articleId === (value as string))
  questionRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Question
    mockQuestions.push(item)
    return item
  }

  // wordRepository mock（add 返回实体）
  wordRepository.getById = async (id: string) => mockWords.find((w) => w.id === id)
  // SWR 模式：getByIdLocalFirst 与 getById 行为一致（测试中不触发后台刷新）
  // enrichWord/applyWeightedReviewResult 使用 getByIdLocalFirst，必须 mock 否则访问真实 Dexie
  wordRepository.getByIdLocalFirst = async (id: string) => mockWords.find((w) => w.id === id)
  wordRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Word
    mockWords.push(item)
    return item
  }
  wordRepository.update = async (id, patch) => {
    const idx = mockWords.findIndex((w) => w.id === id)
    if (idx >= 0) {
      mockWords[idx] = { ...mockWords[idx], ...patch, updated_at: Date.now() } as Word
    }
    return mockWords[idx] ?? ({} as Word)
  }

  // reviewRepository mock（add 返回实体）
  reviewRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Review
    mockReviews.push(item)
    return item
  }

  // statsRepository mock（add 返回实体）
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
    }
    return mockStats[idx] ?? ({} as Stats)
  }

  // readingSessionRepository mock（add 返回实体）
  readingSessionRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as ReadingSession
    mockSessions.push(item)
    return item
  }
}

// 恢复原始方法
export function restoreMock(): void {
  articleRepository.getAll = originals.articleGetAll
  articleRepository.getById = originals.articleGetById
  articleRepository.add = originals.articleAdd
  articleRepository.update = originals.articleUpdate
  questionRepository.whereEquals = originals.questionWhereEquals
  questionRepository.add = originals.questionAdd
  wordRepository.getById = originals.wordGetById
  wordRepository.getByIdLocalFirst = originals.wordGetByIdLocalFirst
  wordRepository.add = originals.wordAdd
  wordRepository.update = originals.wordUpdate
  reviewRepository.add = originals.reviewAdd
  statsRepository.getById = originals.statsGetById
  statsRepository.add = originals.statsAdd
  statsRepository.update = originals.statsUpdate
  readingSessionRepository.add = originals.sessionAdd
  aiProvider.generateArticle = originals.aiGenerateArticle
  aiProvider.generateQuestions = originals.aiGenerateQuestions
}

// 构造 AI 生成文章结果
export function makeAIResult(overrides: Partial<ArticleGenerationResult> = {}): ArticleGenerationResult {
  return {
    title: 'AI 生成文章标题',
    content: 'AI 生成文章内容，约 200-300 词',
    translation: 'AI 生成文章翻译',
    genre: 'narrative',
    wordCount: 250,
    topic: 'campus',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [
      {
        word: 'campus',
        phonetic: '/ˈkæmpəs/',
        pos: 'n.',
        definition: '校园',
        example: 'I love our campus.',
      },
      {
        word: 'library',
        phonetic: '/ˈlaɪbrəri/',
        pos: 'n.',
        definition: '图书馆',
        example: 'She is in the library.',
      },
    ],
    ...overrides,
  }
}

// 今日日期字符串（YYYY-MM-DD），统计相关用例共用
export function todayStr(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
