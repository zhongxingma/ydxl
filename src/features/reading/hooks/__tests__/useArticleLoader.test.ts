// useArticleLoader 文章加载 hook 单元测试
//
// 覆盖场景：
// 1. loadToday：今日文章生成、forceNew 判定、查询失败降级、并行结果写入、计时与 store 重置
// 2. 并行失败：题目 / 语法 / 词汇 rejected 或空数组的错误提示
// 3. 文章加载失败：Error 与非 Error 兜底文案、未挂载丢弃、加载令牌过期丢弃
// 4. loadArticleById：成功写入已读标记、404 友好提示、其他错误透传
// 5. reload：历史文章模式与今日模式的分发
// 6. 历史文章短语补全：缺失时调用、已有短语跳过、失败告警
//
// Mock 策略：mock articleService / questionService / vocabularyService，
// 使用可控 refs 验证竞态与卸载保护。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Article, Difficulty, Question, Topic } from '@/shared/types'
import type { QuizGenStage, VocabularyItem } from '../../types'

vi.mock('../../services/articleService', () => {
  class ArticleNotFoundError extends Error {
    constructor(message = '文章不存在') {
      super(message)
      this.name = 'ArticleNotFoundError'
    }
  }
  return {
    articleService: {
      getTodayReadCount: vi.fn(),
      getDailyArticle: vi.fn(),
      getArticleById: vi.fn(),
      recordReadingStart: vi.fn(),
      ensureArticlePhrases: vi.fn(),
    },
    ArticleNotFoundError,
  }
})

vi.mock('../../services/questionService', () => ({
  questionService: {
    getQuestionsForArticle: vi.fn(),
    getGrammarFillQuestionsForArticle: vi.fn(),
  },
}))

vi.mock('../../services/vocabularyService', () => ({
  vocabularyService: {
    extractAndCacheVocabulary: vi.fn(),
  },
}))

import { useArticleLoader } from '../useArticleLoader'
import { articleService, ArticleNotFoundError } from '../../services/articleService'
import { questionService } from '../../services/questionService'
import { vocabularyService } from '../../services/vocabularyService'

const getTodayReadCountMock = vi.mocked(articleService.getTodayReadCount)
const getDailyArticleMock = vi.mocked(articleService.getDailyArticle)
const getArticleByIdMock = vi.mocked(articleService.getArticleById)
const recordReadingStartMock = vi.mocked(articleService.recordReadingStart)
const ensureArticlePhrasesMock = vi.mocked(articleService.ensureArticlePhrases)
const getQuestionsMock = vi.mocked(questionService.getQuestionsForArticle)
const getGrammarMock = vi.mocked(questionService.getGrammarFillQuestionsForArticle)
const extractVocabMock = vi.mocked(vocabularyService.extractAndCacheVocabulary)

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'art-1',
    updated_at: 1,
    title: 'Title',
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 100,
    createdAt: 1000,
    ...overrides,
  }
}

function makeQuestion(id: string): Question {
  return {
    id,
    updated_at: 1,
    articleId: 'art-1',
    type: 'main_idea',
    stem: 'stem',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'because',
    locationClue: 'paragraph 1',
    createdAt: 1,
  }
}

function makeVocab(word: string): VocabularyItem {
  return {
    word,
    phonetic: '',
    pos: '',
    definition: '释义',
    example: '',
    importance: 'high',
  }
}

interface Options {
  articleId: string | null
  mountedRef: MutableRefObject<boolean>
  loadTokenRef: MutableRefObject<number>
  markedReadRef: MutableRefObject<string | null>
  selectedDifficultyRef: MutableRefObject<Difficulty | undefined>
  selectedTopicRef: MutableRefObject<Topic | undefined>
  resetStore: () => void
  startTimer: () => void
  setQuizGenStage: Dispatch<SetStateAction<QuizGenStage>>
}

function makeOptions(overrides: Partial<Options> = {}): Options {
  return {
    articleId: null,
    mountedRef: { current: true },
    loadTokenRef: { current: 0 },
    markedReadRef: { current: null },
    selectedDifficultyRef: { current: undefined },
    selectedTopicRef: { current: undefined },
    resetStore: vi.fn(),
    startTimer: vi.fn(),
    setQuizGenStage: vi.fn(),
    ...overrides,
  }
}

describe('useArticleLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTodayReadCountMock.mockResolvedValue(0)
    getDailyArticleMock.mockResolvedValue(makeArticle())
    getArticleByIdMock.mockResolvedValue(makeArticle())
    recordReadingStartMock.mockResolvedValue(true)
    ensureArticlePhrasesMock.mockResolvedValue([])
    getQuestionsMock.mockResolvedValue([makeQuestion('art-1-1')])
    getGrammarMock.mockResolvedValue([makeQuestion('art-1-g1')])
    extractVocabMock.mockResolvedValue([makeVocab('apple')])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadToday 生成今日文章并应用并行结果', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useArticleLoader(options))

    await act(async () => {
      await result.current.loadToday('easy', 'campus')
    })

    const today = new Date().toISOString().slice(0, 10)
    expect(getTodayReadCountMock).toHaveBeenCalled()
    expect(getDailyArticleMock).toHaveBeenCalledWith(today, {
      forceNew: false,
      difficulty: 'easy',
      topic: 'campus',
    })
    expect(options.resetStore).toHaveBeenCalled()
    expect(options.startTimer).toHaveBeenCalled()
    expect(recordReadingStartMock).toHaveBeenCalledWith('art-1')
    expect(result.current.article?.id).toBe('art-1')
    expect(result.current.status).toBe('success')
    expect(result.current.questions).toHaveLength(1)
    expect(result.current.grammarQuestions).toHaveLength(1)
    expect(result.current.vocabularies).toHaveLength(1)
    expect(result.current.grammarGenError).toBeNull()
    expect(result.current.vocabGenError).toBeNull()
  })

  it('今日已读文章数大于 0 时强制生成新文章', async () => {
    getTodayReadCountMock.mockResolvedValue(2)
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadToday()
    })

    expect(getDailyArticleMock).toHaveBeenCalledWith(expect.any(String), {
      forceNew: true,
      difficulty: undefined,
      topic: undefined,
    })
  })

  it('今日已读查询失败时降级为非 forceNew 并继续加载', async () => {
    getTodayReadCountMock.mockRejectedValueOnce(new Error('db down'))
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadToday()
    })

    expect(getDailyArticleMock).toHaveBeenCalledWith(expect.any(String), {
      forceNew: false,
      difficulty: undefined,
      topic: undefined,
    })
    expect(result.current.status).toBe('success')
    expect(console.warn).toHaveBeenCalled()
  })

  it('并行生成部分失败时记录语法与词汇错误提示', async () => {
    getQuestionsMock.mockRejectedValueOnce(new Error('题目失败'))
    getGrammarMock.mockRejectedValueOnce(new Error('语法失败'))
    extractVocabMock.mockResolvedValueOnce([])
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadToday()
    })

    expect(result.current.questions).toEqual([])
    expect(result.current.grammarQuestions).toEqual([])
    expect(result.current.grammarGenError).toBe('语法失败')
    expect(result.current.vocabGenError).toBe('词汇提取失败，请稍后重试')
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('语法生成非 Error 失败时使用兜底文案', async () => {
    getGrammarMock.mockRejectedValueOnce({ message: 'object' })
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadToday()
    })

    expect(result.current.grammarGenError).toBe('语法填空题生成失败')
  })

  it('文章加载失败时记录错误信息与 error 状态', async () => {
    getDailyArticleMock.mockRejectedValueOnce(new Error('网络错误'))
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadToday()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMsg).toBe('网络错误')
    expect(result.current.article).toBeNull()
  })

  it('非 Error 异常使用通用加载失败文案', async () => {
    getDailyArticleMock.mockRejectedValueOnce('boom')
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadToday()
    })

    expect(result.current.errorMsg).toBe('加载失败，请重试')
  })

  it('加载令牌过期时丢弃文章结果', async () => {
    let resolveArticle!: (article: Article) => void
    getDailyArticleMock.mockReturnValueOnce(
      new Promise<Article>((resolve) => {
        resolveArticle = resolve
      }),
    )
    const options = makeOptions()
    const { result } = renderHook(() => useArticleLoader(options))

    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadToday()
    })
    options.loadTokenRef.current += 1
    await act(async () => {
      resolveArticle(makeArticle())
      await loading
    })

    expect(result.current.article).toBeNull()
    expect(recordReadingStartMock).not.toHaveBeenCalled()
  })

  it('组件卸载后丢弃文章结果', async () => {
    let resolveArticle!: (article: Article) => void
    getDailyArticleMock.mockReturnValueOnce(
      new Promise<Article>((resolve) => {
        resolveArticle = resolve
      }),
    )
    const options = makeOptions()
    const { result } = renderHook(() => useArticleLoader(options))

    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadToday()
    })
    options.mountedRef.current = false
    await act(async () => {
      resolveArticle(makeArticle())
      await loading
    })

    expect(result.current.article).toBeNull()
    expect(result.current.status).toBe('loading')
  })

  it('loadArticleById 成功时写入已读标记并启动计时', async () => {
    getArticleByIdMock.mockResolvedValueOnce(makeArticle({ readAt: 123 }))
    const options = makeOptions()
    const { result } = renderHook(() => useArticleLoader(options))

    await act(async () => {
      await result.current.loadArticleById('art-1')
    })

    expect(getArticleByIdMock).toHaveBeenCalledWith('art-1')
    expect(options.markedReadRef.current).toBe('art-1')
    expect(options.startTimer).toHaveBeenCalled()
    expect(result.current.status).toBe('success')
    expect(result.current.loadStage).toBe('loading')
  })

  it('loadArticleById 未读文章不写入已读标记', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useArticleLoader(options))

    await act(async () => {
      await result.current.loadArticleById('art-1')
    })

    expect(options.markedReadRef.current).toBeNull()
  })

  it('loadArticleById 文章不存在时展示友好提示', async () => {
    getArticleByIdMock.mockRejectedValueOnce(new ArticleNotFoundError('missing'))
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadArticleById('missing')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMsg).toBe('文章不存在或已被删除')
  })

  it('loadArticleById 其他错误透传消息', async () => {
    getArticleByIdMock.mockRejectedValueOnce(new Error('历史加载失败'))
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadArticleById('art-1')
    })

    expect(result.current.errorMsg).toBe('历史加载失败')
  })

  it('reload 历史模式加载 articleId，今日模式使用已选题材与难度', async () => {
    const historyOptions = makeOptions({ articleId: 'hist-1' })
    const historyHook = renderHook(() => useArticleLoader(historyOptions))

    await act(async () => {
      historyHook.result.current.reload()
    })
    await waitFor(() => expect(getArticleByIdMock).toHaveBeenCalledWith('hist-1'))

    const todayOptions = makeOptions({
      selectedDifficultyRef: { current: 'hard' },
      selectedTopicRef: { current: 'science' },
    })
    const todayHook = renderHook(() => useArticleLoader(todayOptions))

    await act(async () => {
      todayHook.result.current.reload()
    })
    expect(getDailyArticleMock).toHaveBeenCalledWith(expect.any(String), {
      forceNew: false,
      difficulty: 'hard',
      topic: 'science',
    })
  })

  it('历史文章缺少短语时自动补全并写回文章', async () => {
    ensureArticlePhrasesMock.mockResolvedValueOnce([{ phrase: 'look up', meaning: '查阅' }])
    const article = makeArticle()
    getArticleByIdMock.mockResolvedValueOnce(article)
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadArticleById('art-1')
    })

    await waitFor(() => {
      expect(result.current.article?.phrases).toEqual([{ phrase: 'look up', meaning: '查阅' }])
    })
    expect(ensureArticlePhrasesMock).toHaveBeenCalledWith(article)
    expect(result.current.phrasesLoading).toBe(false)
  })

  it('已有短语时跳过补全', async () => {
    getArticleByIdMock.mockResolvedValueOnce(
      makeArticle({ phrases: [{ phrase: 'in fact', meaning: '事实上' }] }),
    )
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadArticleById('art-1')
    })

    expect(ensureArticlePhrasesMock).not.toHaveBeenCalled()
    expect(result.current.article?.phrases).toHaveLength(1)
  })

  it('短语补全失败时告警且不更新文章', async () => {
    ensureArticlePhrasesMock.mockRejectedValueOnce(new Error('AI down'))
    getArticleByIdMock.mockResolvedValueOnce(makeArticle())
    const { result } = renderHook(() => useArticleLoader(makeOptions()))

    await act(async () => {
      await result.current.loadArticleById('art-1')
    })

    await waitFor(() => expect(result.current.phrasesLoading).toBe(false))
    expect(result.current.article?.phrases).toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })
})
