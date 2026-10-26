// useQuizRunner 答题流程编排 hook 单元测试
//
// 覆盖场景：
// 1. 聚合输出：文章已读标记、生成阶段透传、内容生成与已读处理回调透传
// 2. 阅读理解作答与下一题：非最后一题推进，最后一题按语法题有无进入语法填空 / 成绩单
// 3. 重新答题重置阅读与语法作答状态
// 4. 语法填空作答与下一题：推进索引，最后一题查看成绩
// 5. 视图切换：开始答题 / 返回阅读 / 跳转原文 / 查看翻译 / 学习生词 / 跳过语法填空
// 6. 阅读下一篇：停止朗读并打开难度选择
//
// Mock 策略：mock useContentGeneration 与 useMarkAsRead，阅读 store 使用真实实现
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject, RefObject } from 'react'
import type { Article, Question } from '@/shared/types'
import { useReadingStore } from '../../store'
import { useQuizRunner } from '../useQuizRunner'

const mocks = vi.hoisted(() => ({
  setGrammarInterstitial: vi.fn(),
  handleRetryGrammar: vi.fn(),
  handleGenerateGrammar: vi.fn(),
  handleRetryVocab: vi.fn(),
  handleMarkAsRead: vi.fn(),
}))

vi.mock('../useContentGeneration', () => ({
  useContentGeneration: () => ({
    retryingGrammar: false,
    retryingVocab: false,
    grammarInterstitial: false,
    setGrammarInterstitial: mocks.setGrammarInterstitial,
    generatingGrammar: false,
    handleRetryGrammar: mocks.handleRetryGrammar,
    handleGenerateGrammar: mocks.handleGenerateGrammar,
    handleRetryVocab: mocks.handleRetryVocab,
  }),
}))

vi.mock('../useMarkAsRead', () => ({
  useMarkAsRead: () => ({ handleMarkAsRead: mocks.handleMarkAsRead }),
}))

function makeArticle(overrides: Partial<Article> = {}): Article {
  const now = Date.now()
  return {
    id: '2026-10-26',
    title: 'Title',
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 50,
    createdAt: now,
    updated_at: now,
    readAt: null,
    ...overrides,
  }
}

function makeQuestion(id: string): Question {
  return {
    id,
    articleId: '2026-10-26',
    type: 'main_idea',
    stem: 'stem',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'because',
    locationClue: 'Paragraph 1',
    createdAt: Date.now(),
    updated_at: Date.now(),
  }
}

interface SetupOptions {
  article?: Article | null
  questions?: Question[]
  grammarQuestions?: Question[]
  currentGrammarIdx?: number
}

function setup(overrides: SetupOptions = {}) {
  const setters = {
    setArticle: vi.fn(),
    setQuestions: vi.fn(),
    setGrammarQuestions: vi.fn(),
    setVocabularies: vi.fn(),
    setGrammarAnswers: vi.fn(),
    setCurrentGrammarIdx: vi.fn(),
    setGrammarGenError: vi.fn(),
    setVocabGenError: vi.fn(),
    setToast: vi.fn(),
    setScrollTarget: vi.fn(),
    setTranslationMode: vi.fn(),
    setShowDifficultyModal: vi.fn(),
    setQuizGenStage: vi.fn(),
    setGeneratingQuestions: vi.fn(),
  }
  const speechStop = vi.fn()
  const scrollIntoView = vi.fn()
  const options = {
    article: overrides.article === undefined ? makeArticle() : overrides.article,
    ...setters,
    questions: overrides.questions ?? [],
    grammarQuestions: overrides.grammarQuestions ?? [],
    currentGrammarIdx: overrides.currentGrammarIdx ?? 0,
    speech: { stop: speechStop },
    vocabListRef: {
      current: { scrollIntoView } as unknown as HTMLElement,
    } as RefObject<HTMLElement>,
    mountedRef: { current: true } as MutableRefObject<boolean>,
    abortControllerRef: { current: null } as MutableRefObject<AbortController | null>,
    quizGenStage: 'idle' as const,
    generatingQuestions: false,
  }

  const { result } = renderHook(() => useQuizRunner(options))
  return { result, options, setters, speechStop, scrollIntoView }
}

describe('useQuizRunner 答题流程编排', () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    useReadingStore.getState().reset()
    scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('聚合输出：已读标记、生成阶段与子 hook 回调透传', () => {
    const { result } = setup({
      article: makeArticle({ readAt: 123 }),
    })

    expect(result.current.isArticleRead).toBe(true)
    expect(result.current.quizGenStage).toBe('idle')
    expect(result.current.generatingQuestions).toBe(false)
    expect(result.current.handleRetryGrammar).toBe(mocks.handleRetryGrammar)
    expect(result.current.handleGenerateGrammar).toBe(mocks.handleGenerateGrammar)
    expect(result.current.handleRetryVocab).toBe(mocks.handleRetryVocab)
    expect(result.current.handleMarkAsRead).toBe(mocks.handleMarkAsRead)
  })

  it('handleAnswer 写入阅读 store 作答记录', () => {
    const { result } = setup()

    act(() => {
      result.current.handleAnswer(1, 2)
    })

    expect(useReadingStore.getState().answers).toEqual({ 1: 2 })
  })

  it('handleNext 非最后一题推进到下一题', () => {
    const { result } = setup({ questions: [makeQuestion('q1'), makeQuestion('q2')] })

    act(() => {
      result.current.handleNext()
    })

    expect(useReadingStore.getState().currentQuestionIndex).toBe(1)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('handleNext 最后一题且已有语法题时进入语法填空视图', () => {
    useReadingStore.setState({ currentQuestionIndex: 0 })
    const { result } = setup({
      questions: [makeQuestion('q1')],
      grammarQuestions: [makeQuestion('g1')],
    })

    act(() => {
      result.current.handleNext()
    })

    expect(useReadingStore.getState().view).toBe('grammar_quiz')
    expect(mocks.setGrammarInterstitial).not.toHaveBeenCalled()
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('handleNext 最后一题且无语法题时进入成绩单并打开语法选择页', () => {
    useReadingStore.setState({ currentQuestionIndex: 0 })
    const { result } = setup({ questions: [makeQuestion('q1')] })

    act(() => {
      result.current.handleNext()
    })

    expect(mocks.setGrammarInterstitial).toHaveBeenCalledWith(true)
    expect(useReadingStore.getState().view).toBe('result')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('handleRetry 重置阅读与语法填空作答状态', () => {
    useReadingStore.setState({
      currentQuestionIndex: 2,
      answers: { 0: 1 },
      view: 'result',
    })
    const { result, setters } = setup()

    act(() => {
      result.current.handleRetry()
    })

    const state = useReadingStore.getState()
    expect(state.currentQuestionIndex).toBe(0)
    expect(state.answers).toEqual({})
    expect(state.view).toBe('quiz')
    expect(setters.setGrammarAnswers).toHaveBeenCalledWith({})
    expect(setters.setCurrentGrammarIdx).toHaveBeenCalledWith(0)
  })

  it('handleGrammarAnswer 基于前一次作答复合作答记录', () => {
    const { result, setters } = setup()

    act(() => {
      result.current.handleGrammarAnswer(1, 3)
    })

    const updater = setters.setGrammarAnswers.mock.calls[0][0] as (
      prev: Record<number, number>
    ) => Record<number, number>
    expect(updater({ 0: 1 })).toEqual({ 0: 1, 1: 3 })
  })

  it('handleGrammarNext 非最后一题推进索引，最后一题查看成绩', () => {
    const grammar = [makeQuestion('g1'), makeQuestion('g2')]
    const { result, setters } = setup({ grammarQuestions: grammar, currentGrammarIdx: 0 })

    act(() => {
      result.current.handleGrammarNext()
    })
    const updater = setters.setCurrentGrammarIdx.mock.calls[0][0] as (prev: number) => number
    expect(updater(0)).toBe(1)
    expect(useReadingStore.getState().view).toBe('reading')

    const last = setup({ grammarQuestions: grammar, currentGrammarIdx: 1 })
    act(() => {
      last.result.current.handleGrammarNext()
    })
    expect(useReadingStore.getState().view).toBe('result')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('handleStartQuiz 与 handleBackToReading 切换视图', () => {
    const { result } = setup()

    act(() => {
      result.current.handleStartQuiz()
    })
    expect(useReadingStore.getState().view).toBe('quiz')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })

    act(() => {
      result.current.handleBackToReading()
    })
    expect(useReadingStore.getState().view).toBe('reading')
  })

  it('handleLocateInArticle 跳回原文并在 5 秒后清除目标', () => {
    vi.useFakeTimers()
    const { result, setters } = setup()

    act(() => {
      result.current.handleLocateInArticle('Paragraph 2')
    })

    expect(setters.setScrollTarget).toHaveBeenCalledWith('Paragraph 2')
    expect(useReadingStore.getState().view).toBe('reading')

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(setters.setScrollTarget).toHaveBeenLastCalledWith(undefined)
  })

  it('handleViewTranslation 停止朗读并切到逐句翻译模式', () => {
    const { result, setters, speechStop } = setup()

    act(() => {
      result.current.handleViewTranslation()
    })

    expect(speechStop).toHaveBeenCalledTimes(1)
    expect(setters.setTranslationMode).toHaveBeenCalledWith('toggle')
    expect(useReadingStore.getState().view).toBe('reading')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('handleStudyVocabulary 返回阅读视图并延迟滚动到词汇区', () => {
    vi.useFakeTimers()
    const { result, scrollIntoView } = setup()

    act(() => {
      result.current.handleStudyVocabulary()
    })
    expect(useReadingStore.getState().view).toBe('reading')
    expect(scrollIntoView).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('handleSkipGrammar 关闭语法选择页并进入成绩单', () => {
    const { result } = setup()

    act(() => {
      result.current.handleSkipGrammar()
    })

    expect(mocks.setGrammarInterstitial).toHaveBeenCalledWith(false)
    expect(useReadingStore.getState().view).toBe('result')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('loadNextArticle 停止朗读并打开难度选择弹窗', () => {
    const { result, setters, speechStop } = setup()

    act(() => {
      result.current.loadNextArticle()
    })

    expect(speechStop).toHaveBeenCalledTimes(1)
    expect(setters.setShowDifficultyModal).toHaveBeenCalledWith(true)
  })
})
