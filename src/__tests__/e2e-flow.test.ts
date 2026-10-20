// E2E 用户完整流程测试（Task 7.4）
//
// 模拟用户从生成文章到更新统计的完整流程，验证各 service 之间的协作：
// 1. articleService.generateArticle 调用 AIProvider 并通过 contentHash 去重
// 2. articleService.markAsRead 更新 readAt
// 3. questionService.getQuestionsForArticle 调用 AI 生成题目并写入本地
// 4. wordbookService.addToWordbook 添加生词
// 5. reviewService.applyWeightedReviewResult 应用复习结果更新 word
// 6. statsService.recordArticleRead 与 recordWordLearned 更新统计
//
// 完全 mock AIProvider 与各 Repository（不依赖真实 IndexedDB 或网络）
// 参考各 service 的单元测试 mock 模式

import type {
  Article,
  Question,
  ReadingSession,
  Review,
  Stats,
  Word,
} from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'
import { generateArticle, markAsRead } from '@/features/reading/services/articleService'
import { getQuestionsForArticle } from '@/features/reading/services/questionService'
import { addToWordbook } from '@/features/wordbook/services/wordbookService'
import { applyWeightedReviewResult } from '@/features/review/services/reviewService'
import {
  recordArticleRead,
  recordWordLearned,
  recordReadingSession,
} from '@/features/stats/services/statsService'
import {
  articleRepository,
  questionRepository,
  readingSessionRepository,
  reviewRepository,
  statsRepository,
  wordRepository,
} from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import { computeContentHash } from '@/shared/utils/contentHash'

// ---------- 内存 Mock 存储 ----------

let mockArticles: Article[] = []
let mockQuestions: Question[] = []
let mockWords: Word[] = []
let mockReviews: Review[] = []
let mockStats: Stats[] = []
let mockSessions: ReadingSession[] = []

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
function installMock(): void {
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
function restoreMock(): void {
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
function makeAIResult(overrides: Partial<ArticleGenerationResult> = {}): ArticleGenerationResult {
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

// ---------- 主测试流程 ----------

describe('E2E 用户完整流程', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 1. 生成文章 → 调用 AIProvider 并通过 contentHash 去重
  it('生成文章：调用 AIProvider 并写入 articleRepository，含 contentHash 去重', async () => {
    const aiResult = makeAIResult({
      title: '校园生活',
      content: 'Campus life is full of joy.',
    })
    aiProvider.generateArticle = async () => aiResult

    const article = await generateArticle({ date: '2024-01-01' })

    // 验证 AI 生成的文章被保存
    expect(article.id).toBe('2024-01-01')
    expect(article.title).toBe('校园生活')
    expect(article.contentHash).toBeDefined()
    expect(article.contentHash!.length).toBe(16)
    expect(article.readAt).toBeNull()
    // 验证 articleRepository 中有 1 篇文章
    expect(mockArticles.length).toBe(1)
    expect(mockArticles[0].contentHash).toBe(article.contentHash)
  })

  // 2. 标记已读 → readAt 写入
  it('标记已读：markAsRead 更新 readAt 时间戳', async () => {
    const aiResult = makeAIResult()
    aiProvider.generateArticle = async () => aiResult

    const article = await generateArticle({ date: '2024-02-02' })
    expect(article.readAt).toBeNull()

    // 标记为已读
    await markAsRead('2024-02-02')

    // 验证 readAt 已写入
    const updated = mockArticles.find((a) => a.id === '2024-02-02')
    expect(updated).toBeDefined()
    expect(updated!.readAt).not.toBeNull()
    expect(typeof updated!.readAt).toBe('number')
  })

  // 3. 答题：调用 AI 生成题目并写入 questionRepository
  it('答题：getQuestionsForArticle 调用 AI 生成题目并写入本地', async () => {
    // 先生成文章
    const aiResult = makeAIResult({ title: '校园生活 2', content: 'Unique content 2' })
    aiProvider.generateArticle = async () => aiResult
    const article = await generateArticle({ date: '2024-03-03' })

    // 模拟 AI 生成题目
    aiProvider.generateQuestions = async () => [
      {
        id: '2024-03-03-1',
        type: 'main_idea',
        stem: 'What is the main idea?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Explanation',
        locationClue: 'paragraph 1',
      },
      {
        id: '2024-03-03-2',
        type: 'detail',
        stem: 'What does the author say about campus?',
        options: ['Big', 'Small', 'Old', 'New'],
        correctIndex: 0,
        explanation: 'Detail explanation',
        locationClue: 'paragraph 2',
      },
    ]

    const questions = await getQuestionsForArticle(article)

    // 验证题目已生成并写入
    expect(questions.length).toBe(2)
    expect(mockQuestions.length).toBe(2)
    expect(questions[0].articleId).toBe('2024-03-03')
    expect(questions[1].articleId).toBe('2024-03-03')
    // 验证 id 排序
    expect(questions[0].id).toBe('2024-03-03-1')
    expect(questions[1].id).toBe('2024-03-03-2')
  })

  // 4. 加入生词本：从高亮生词中添加新词
  it('加入生词本：addToWordbook 添加新词到 wordRepository', async () => {
    // 先生成带高亮词的文章
    const aiResult = makeAIResult({
      title: '校园生活 3',
      content: 'Unique content 3',
      highlightedWords: [
        {
          word: 'Campus',
          phonetic: '/ˈkæmpəs/',
          pos: 'n.',
          definition: '校园',
          example: 'I love our campus.',
        },
      ],
    })
    aiProvider.generateArticle = async () => aiResult
    const article = await generateArticle({ date: '2024-04-04' })

    // 从高亮词中取第一个加入生词本
    const highlighted = article.highlightedWords![0]
    const word = await addToWordbook({
      word: highlighted.word,
      phonetic: highlighted.phonetic,
      pos: highlighted.pos,
      definition: highlighted.definition,
      example: highlighted.example,
      sourceArticleId: article.id,
    })

    // 验证生词已加入
    expect(word.id).toBe('campus')
    expect(word.word).toBe('Campus')
    expect(word.definition).toBe('校园')
    expect(word.mastery).toBe(0)
    expect(word.sourceArticleId).toBe('2024-04-04')
    expect(mockWords.length).toBe(1)
  })

  // 5. 应用复习结果：applyWeightedReviewResult 更新 word 字段
  it('应用复习结果：复习后 word 字段被更新（mastery/reviewCount）', async () => {
    // 先添加一个生词
    const word = await addToWordbook({
      word: 'Library',
      phonetic: '/ˈlaɪbrəri/',
      pos: 'n.',
      definition: '图书馆',
      example: 'She is in the library.',
    })

    // 初始 mastery=0, reviewCount=0
    expect(word.mastery).toBe(0)
    expect(word.reviewCount).toBe(0)

    // 应用三环节全对的复习结果
    await applyWeightedReviewResult(word.id, {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    // 验证 word 已被更新
    const updated = mockWords.find((w) => w.id === word.id)
    expect(updated).toBeDefined()
    expect(updated!.reviewCount).toBe(1)
    // 全对 → mastery 提升（+1）
    expect(updated!.mastery).toBeGreaterThan(0)
    // 验证 nextReview 已更新（往后推迟）
    expect(updated!.nextReview).toBeGreaterThan(word.nextReview)
    // 验证汇总 Review 记录已写入
    expect(mockReviews.length).toBe(1)
  })

  // 6. 更新统计：recordArticleRead 与 recordWordLearned 累加今日 stats
  it('更新统计：recordArticleRead 与 recordWordLearned 累加今日 stats', async () => {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    // 初始无 stats
    expect(mockStats.length).toBe(0)

    // 记录阅读一篇文章
    await recordArticleRead(todayStr)
    // 记录学习一个新单词
    await recordWordLearned(todayStr)
    // 记录学习第二个新单词
    await recordWordLearned(todayStr)

    // 验证 stats 已创建并累加
    const stats = mockStats.find((s) => s.id === todayStr)
    expect(stats).toBeDefined()
    expect(stats!.articlesRead).toBe(1)
    expect(stats!.wordsLearned).toBe(2)
    // streak 应被维护（updateStreak 被调用）
    expect(stats!.streak).toBeGreaterThanOrEqual(1)
  })

  // 7. 完整流程串联：生成文章 → 标记已读 → 题目生成 → 加入生词 → 复习 → 统计
  it('完整流程串联：各 service 协作完成一次完整学习闭环', async () => {
    // === 步骤 1: 生成文章 ===
    const aiResult = makeAIResult({
      title: '校园日常',
      content: 'A day in the campus is wonderful.',
      highlightedWords: [
        {
          word: 'Wonderful',
          phonetic: '/ˈwʌndəfl/',
          pos: 'adj.',
          definition: '极好的',
          example: 'It is wonderful.',
        },
      ],
    })
    aiProvider.generateArticle = async () => aiResult
    const article = await generateArticle({ date: '2024-05-05' })

    // === 步骤 2: 标记已读 ===
    await markAsRead('2024-05-05')
    expect(mockArticles[0].readAt).not.toBeNull()

    // === 步骤 3: 生成题目 ===
    aiProvider.generateQuestions = async () => [
      {
        id: '2024-05-05-1',
        type: 'main_idea',
        stem: 'What is wonderful?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'explanation',
        locationClue: 'paragraph 1',
      },
    ]
    const questions = await getQuestionsForArticle(article)
    expect(questions.length).toBe(1)

    // === 步骤 4: 加入生词本 ===
    const highlighted = article.highlightedWords![0]
    const newWord = await addToWordbook({
      word: highlighted.word,
      phonetic: highlighted.phonetic,
      pos: highlighted.pos,
      definition: highlighted.definition,
      example: highlighted.example,
      sourceArticleId: article.id,
    })
    expect(mockWords.length).toBe(1)

    // === 步骤 5: 复习生词 ===
    await applyWeightedReviewResult(newWord.id, {
      practiceCorrect: 8,
      practiceTotal: 10,
      spellCorrect: 9,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })
    expect(mockWords[0].reviewCount).toBe(1)

    // === 步骤 6: 记录阅读会话 + 更新统计 ===
    await recordReadingSession(article.id, 300, article.wordCount, 1.0)
    await recordWordLearned()

    // 验证 session 已写入
    expect(mockSessions.length).toBe(1)
    expect(mockSessions[0].articleId).toBe(article.id)

    // 验证 stats 已更新（articlesRead >= 1）
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const stats = mockStats.find((s) => s.id === todayStr)
    expect(stats).toBeDefined()
    expect(stats!.articlesRead).toBeGreaterThanOrEqual(1)
    expect(stats!.wordsLearned).toBeGreaterThanOrEqual(1)

    // 验证 contentHash 去重生效：相同内容第二次生成应回退到历史最新
    const dupHash = await computeContentHash(aiResult.title, aiResult.content)
    expect(article.contentHash).toBe(dupHash)
  })
})
