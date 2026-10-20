// ReadingPage 三个测试文件（articleId / raceAndMarkAsRead / print）共用的模块 mock
// - 导出的 mock 实例与各测试文件原局部命名一致，测试体零改动
// - 必须在导入被测组件（../ReadingPage）之前导入本模块，确保 vi.mock 注册先于组件求值
import { vi } from 'vitest'

// articleService：各方法通过外层 mock 函数代理，便于在 beforeEach / 测试中配置返回值
export const getArticleByIdMock = vi.fn()
export const getDailyArticleMock = vi.fn()
export const markAsReadMock = vi.fn().mockResolvedValue(undefined)
export const recordReadingStartMock = vi.fn()
export const getTodayReadCountMock = vi.fn()

vi.mock('../../services/articleService', () => ({
  articleService: {
    getArticleById: (...args: unknown[]) => getArticleByIdMock(...args),
    getDailyArticle: (...args: unknown[]) => getDailyArticleMock(...args),
    markAsRead: (...args: unknown[]) => markAsReadMock(...args),
    recordReadingStart: (...args: unknown[]) => recordReadingStartMock(...args),
    getTodayReadCount: (...args: unknown[]) => getTodayReadCountMock(...args),
    ensureArticlePhrases: vi.fn().mockResolvedValue([]),
  },
  // 具名错误类：与源码保持一致的结构，供 ReadingPage 中 instanceof 判断命中
  ArticleNotFoundError: class ArticleNotFoundError extends Error {
    constructor(articleId: string) {
      super(`文章 ${articleId} 不存在`)
      this.name = 'ArticleNotFoundError'
      Object.setPrototypeOf(this, ArticleNotFoundError.prototype)
    }
  },
}))

// questionService：默认返回空题目数组（print 测试按场景覆盖语法填空）
export const getQuestionsForArticleMock = vi.fn().mockResolvedValue([])
export const getGrammarFillQuestionsForArticleMock = vi.fn().mockResolvedValue([])
vi.mock('../../services/questionService', () => ({
  questionService: {
    getQuestionsForArticle: (...args: unknown[]) => getQuestionsForArticleMock(...args),
    getGrammarFillQuestionsForArticle: (...args: unknown[]) =>
      getGrammarFillQuestionsForArticleMock(...args),
  },
}))

// vocabularyService：默认返回空词汇数组
export const extractAndCacheVocabularyMock = vi.fn().mockResolvedValue([])
vi.mock('../../services/vocabularyService', () => ({
  vocabularyService: {
    extractAndCacheVocabulary: (...args: unknown[]) => extractAndCacheVocabularyMock(...args),
  },
}))

// @/features/stats：避免 useSessionRecorder 在 result 视图触发真实网络请求
vi.mock('@/features/stats', () => ({
  AchievementUnlockToast: () => null,
  statsService: {
    recordReadingSession: vi.fn().mockResolvedValue(undefined),
    buildAchievementContext: vi.fn().mockResolvedValue({}),
  },
  checkAndUnlockAchievements: vi.fn().mockResolvedValue([]),
}))
