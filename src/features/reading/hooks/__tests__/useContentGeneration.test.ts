// 阅读页内容补充生成 hook
//
// 覆盖语法填空重试 / 交互式生成、词汇重试的成功、空结果、中断与失败分支，
// 以及卸载守卫与并发点击守卫。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Article, Question } from '@/shared/types'
import type { VocabularyItem } from '../../types'
import { questionService } from '../../services/questionService'
import { vocabularyService } from '../../services/vocabularyService'
import { useContentGeneration } from '../useContentGeneration'

vi.mock('../../services/questionService', () => ({
  questionService: {
    getGrammarFillQuestionsForArticle: vi.fn(),
  },
}))

vi.mock('../../services/vocabularyService', () => ({
  vocabularyService: {
    extractAndCacheVocabulary: vi.fn(),
  },
}))

const grammarMock = vi.mocked(questionService.getGrammarFillQuestionsForArticle)
const vocabMock = vi.mocked(vocabularyService.extractAndCacheVocabulary)

const now = 1_700_000_000_000

const article: Article = {
  id: '2026-10-26',
  updated_at: now,
  title: 'A Day at School',
  content: 'Tom goes to school every day.',
  translation: '汤姆每天去上学。',
  genre: 'narrative',
  wordCount: 6,
  createdAt: now,
}

function makeQuestion(): Question {
  return {
    id: '2026-10-26-g1',
    articleId: article.id,
    type: 'grammar_fill',
    stem: 'Tom ___ to school every day.',
    options: ['goes', 'go', 'going', 'went'],
    correctIndex: 0,
    explanation: '',
    locationClue: '',
    createdAt: now,
    updated_at: now,
  }
}

const vocabulary: VocabularyItem = {
  word: 'school',
  phonetic: '/skuːl/',
  pos: 'n.',
  definition: '学校',
  example: 'I go to school.',
  importance: 'high',
}

function makeAbortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

function renderGeneration(articleValue: Article | null = article) {
  const mountedRef = { current: true }
  const setters = {
    setGrammarQuestions: vi.fn(),
    setVocabularies: vi.fn(),
    setGrammarGenError: vi.fn(),
    setVocabGenError: vi.fn(),
    setGrammarAnswers: vi.fn(),
    setCurrentGrammarIdx: vi.fn(),
    setView: vi.fn(),
  }
  const utils = renderHook(() =>
    useContentGeneration({
      article: articleValue,
      ...setters,
      mountedRef,
    }),
  )
  return { ...utils, ...setters, mountedRef }
}

describe('useContentGeneration 内容补充生成', () => {
  const scrollSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo
    grammarMock.mockResolvedValue([makeQuestion()])
    vocabMock.mockResolvedValue([vocabulary])
  })

  afterEach(() => {
    scrollSpy.mockReset()
  })

  it('初始状态：无重试、无生成、无选择页', () => {
    const { result } = renderGeneration()

    expect(result.current.retryingGrammar).toBe(false)
    expect(result.current.retryingVocab).toBe(false)
    expect(result.current.generatingGrammar).toBe(false)
    expect(result.current.grammarInterstitial).toBe(false)
  })

  it('语法填空重试成功：清除错误并写入题目', async () => {
    const questions = [makeQuestion()]
    grammarMock.mockResolvedValue(questions)
    const { result, setGrammarQuestions, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryGrammar()
    })

    expect(setGrammarGenError).toHaveBeenNthCalledWith(1, null)
    expect(setGrammarQuestions).toHaveBeenCalledWith(questions)
    expect(result.current.retryingGrammar).toBe(false)
  })

  it('语法填空重试返回空：展示失败提示', async () => {
    grammarMock.mockResolvedValue([])
    const { result, setGrammarQuestions, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryGrammar()
    })

    expect(setGrammarQuestions).not.toHaveBeenCalled()
    expect(setGrammarGenError).toHaveBeenCalledWith('语法填空题生成失败，请稍后重试')
    expect(result.current.retryingGrammar).toBe(false)
  })

  it('语法填空重试被主动中断：不提示错误', async () => {
    grammarMock.mockRejectedValue(makeAbortError())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryGrammar()
    })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(setGrammarGenError).toHaveBeenCalledTimes(1)
    expect(setGrammarGenError).toHaveBeenCalledWith(null)
    expect(result.current.retryingGrammar).toBe(false)
  })

  it('语法填空重试失败：展示原始错误信息', async () => {
    grammarMock.mockRejectedValue(new Error('AI 服务不可用'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryGrammar()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[ReadingPage] 重试生成语法填空题失败',
      expect.any(Error),
    )
    expect(setGrammarGenError).toHaveBeenCalledWith('AI 服务不可用')
  })

  it('语法填空重试抛出非 Error：使用兜底文案', async () => {
    grammarMock.mockRejectedValue('boom')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryGrammar()
    })

    expect(warnSpy).toHaveBeenCalled()
    expect(setGrammarGenError).toHaveBeenCalledWith('语法填空题生成失败')
  })

  it('语法填空重试进行中重复点击只发起一次请求', async () => {
    let resolveQuestions!: (value: Question[]) => void
    grammarMock.mockReturnValue(
      new Promise<Question[]>((resolve) => {
        resolveQuestions = resolve
      }),
    )
    const { result } = renderGeneration()

    act(() => {
      void result.current.handleRetryGrammar()
    })
    expect(result.current.retryingGrammar).toBe(true)

    await act(async () => {
      await result.current.handleRetryGrammar()
    })
    expect(grammarMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveQuestions([makeQuestion()])
    })
    expect(result.current.retryingGrammar).toBe(false)
  })

  it('无文章时三个动作均为空操作', async () => {
    const { result, setGrammarGenError, setVocabGenError } = renderGeneration(null)

    await act(async () => {
      await result.current.handleRetryGrammar()
      await result.current.handleGenerateGrammar()
      await result.current.handleRetryVocab()
    })

    expect(grammarMock).not.toHaveBeenCalled()
    expect(vocabMock).not.toHaveBeenCalled()
    expect(setGrammarGenError).not.toHaveBeenCalled()
    expect(setVocabGenError).not.toHaveBeenCalled()
  })

  it('交互式生成语法填空成功：关闭选择页并进入答题', async () => {
    const questions = [makeQuestion()]
    grammarMock.mockResolvedValue(questions)
    const {
      result,
      setGrammarQuestions,
      setCurrentGrammarIdx,
      setGrammarAnswers,
      setView,
      setGrammarGenError,
    } = renderGeneration()

    act(() => {
      result.current.setGrammarInterstitial(true)
    })
    expect(result.current.grammarInterstitial).toBe(true)

    await act(async () => {
      await result.current.handleGenerateGrammar()
    })

    expect(setGrammarQuestions).toHaveBeenCalledWith(questions)
    expect(result.current.grammarInterstitial).toBe(false)
    expect(setCurrentGrammarIdx).toHaveBeenCalledWith(0)
    expect(setGrammarAnswers).toHaveBeenCalledWith({})
    expect(setView).toHaveBeenCalledWith('grammar_quiz')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(setGrammarGenError).toHaveBeenNthCalledWith(1, null)
    expect(result.current.generatingGrammar).toBe(false)
  })

  it('交互式生成语法填空返回空：提示失败且不跳转', async () => {
    grammarMock.mockResolvedValue([])
    const { result, setView, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleGenerateGrammar()
    })

    expect(setView).not.toHaveBeenCalled()
    expect(setGrammarGenError).toHaveBeenCalledWith('语法填空题生成失败，请稍后重试')
    expect(result.current.generatingGrammar).toBe(false)
  })

  it('交互式生成语法填空被中断：不提示错误', async () => {
    grammarMock.mockRejectedValue(makeAbortError())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, setView, setGrammarGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleGenerateGrammar()
    })

    expect(setView).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(setGrammarGenError).toHaveBeenCalledTimes(1)
  })

  it('词汇重试成功：写入词汇列表', async () => {
    const vocabs = [vocabulary]
    vocabMock.mockResolvedValue(vocabs)
    const { result, setVocabularies, setVocabGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryVocab()
    })

    expect(setVocabGenError).toHaveBeenNthCalledWith(1, null)
    expect(setVocabularies).toHaveBeenCalledWith(vocabs)
    expect(result.current.retryingVocab).toBe(false)
  })

  it('词汇重试返回空：展示失败提示', async () => {
    vocabMock.mockResolvedValue([])
    const { result, setVocabularies, setVocabGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryVocab()
    })

    expect(setVocabularies).not.toHaveBeenCalled()
    expect(setVocabGenError).toHaveBeenCalledWith('词汇提取失败，请稍后重试')
  })

  it('词汇重试失败：展示原始错误信息', async () => {
    vocabMock.mockRejectedValue(new Error('网络异常'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, setVocabGenError } = renderGeneration()

    await act(async () => {
      await result.current.handleRetryVocab()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[ReadingPage] 重试提取词汇失败',
      expect.any(Error),
    )
    expect(setVocabGenError).toHaveBeenCalledWith('网络异常')
    expect(result.current.retryingVocab).toBe(false)
  })

  it('请求返回前已卸载：不再写入任何状态', async () => {
    let resolveQuestions!: (value: Question[]) => void
    grammarMock.mockReturnValue(
      new Promise<Question[]>((resolve) => {
        resolveQuestions = resolve
      }),
    )
    const { result, setGrammarQuestions, mountedRef } = renderGeneration()

    act(() => {
      void result.current.handleRetryGrammar()
    })
    mountedRef.current = false

    await act(async () => {
      resolveQuestions([makeQuestion()])
    })

    expect(setGrammarQuestions).not.toHaveBeenCalled()
    // finally 也受卸载守卫保护，重试标记保持原值
    expect(result.current.retryingGrammar).toBe(true)
  })
})
