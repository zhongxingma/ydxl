// useMarkAsRead 阅读完成处理 hook 单元测试
//
// 覆盖场景：
// 1. 无文章时直接返回，不调用任何服务
// 2. 首次标记已读：markAsRead 返回 false / 抛错时提示保存失败并中止
// 3. 未读 + 已有题目：标记已读、进入答题、后台补语法填空成功
// 4. 已读 + 已有题目：不重复标记；语法题已存在时不重复生成
// 5. 语法填空后台生成失败（普通错误 / AbortError）
// 6. 无题目：按需生成练习题成功，进入答题并后台补语法填空
// 7. 流式空信号：先进入重试提示，再降级提示
// 8. 生成结果为空：提示失败并标记 error 阶段
// 9. 卸载 / 中断：丢弃结果，AbortError 静默处理
// 10. 生成失败：透传错误原因；非 Error 使用兜底文案；卸载后不再提示
// 11. 重新发起请求前中断上一个 AbortController
//
// Mock 策略：mock articleService / questionService 两个业务服务，其余使用真实实现
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { Article, Question } from '@/shared/types'
import { articleService } from '../../services/articleService'
import { questionService } from '../../services/questionService'
import { useMarkAsRead } from '../useMarkAsRead'

vi.mock('../../services/articleService', () => ({
  articleService: { markAsRead: vi.fn() },
}))

vi.mock('../../services/questionService', () => ({
  questionService: {
    getQuestionsForArticle: vi.fn(),
    getGrammarFillQuestionsForArticle: vi.fn(),
  },
}))

const markAsReadMock = vi.mocked(articleService.markAsRead)
const getQuestionsMock = vi.mocked(questionService.getQuestionsForArticle)
const getGrammarMock = vi.mocked(questionService.getGrammarFillQuestionsForArticle)

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '2026-10-26',
    title: 'A Day in the Park',
    content: 'The park was quiet.',
    translation: '公园很安静。',
    genre: 'narrative',
    wordCount: 4,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    articleId: '2026-10-26',
    type: 'main_idea',
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Because.',
    locationClue: 'Paragraph 1',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

interface SetupOptions {
  article?: Article | null
  isArticleRead?: boolean
  questions?: Question[]
  grammarQuestions?: Question[]
  mounted?: boolean
}

function setup(overrides: SetupOptions = {}) {
  const setArticle = vi.fn()
  const setQuestions = vi.fn()
  const setGrammarQuestions = vi.fn()
  const setGrammarGenError = vi.fn()
  const setToast = vi.fn()
  const setView = vi.fn()
  const setQuizGenStage = vi.fn()
  const setGeneratingQuestions = vi.fn()
  const mountedRef = { current: overrides.mounted ?? true } as MutableRefObject<boolean>
  const abortControllerRef = {
    current: null,
  } as MutableRefObject<AbortController | null>

  const options = {
    article: overrides.article === undefined ? makeArticle() : overrides.article,
    isArticleRead: overrides.isArticleRead ?? false,
    questions: overrides.questions ?? [],
    grammarQuestions: overrides.grammarQuestions ?? [],
    setArticle,
    setQuestions,
    setGrammarQuestions,
    setGrammarGenError,
    setToast,
    setView,
    setQuizGenStage,
    setGeneratingQuestions,
    mountedRef,
    abortControllerRef,
  }

  const { result } = renderHook(() => useMarkAsRead(options))
  const run = async () => {
    await act(async () => {
      await result.current.handleMarkAsRead()
    })
  }

  return {
    options,
    result,
    run,
    setArticle,
    setQuestions,
    setGrammarQuestions,
    setGrammarGenError,
    setToast,
    setView,
    setQuizGenStage,
    setGeneratingQuestions,
    mountedRef,
    abortControllerRef,
  }
}

describe('useMarkAsRead 阅读完成处理', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    markAsReadMock.mockResolvedValue(true)
    getQuestionsMock.mockResolvedValue([])
    getGrammarMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无文章时直接返回，不调用任何服务', async () => {
    const { run } = setup({ article: null })

    await run()

    expect(markAsReadMock).not.toHaveBeenCalled()
    expect(getQuestionsMock).not.toHaveBeenCalled()
  })

  it('markAsRead 返回 false 时提示保存失败并中止', async () => {
    markAsReadMock.mockResolvedValue(false)
    const { run, setToast, setArticle, setView } = setup()

    await run()

    expect(setToast).toHaveBeenCalledWith('阅读记录保存失败，请稍后重试')
    expect(setArticle).not.toHaveBeenCalled()
    expect(setView).not.toHaveBeenCalled()
    expect(getQuestionsMock).not.toHaveBeenCalled()
  })

  it('markAsRead 抛错时记录警告并提示保存失败', async () => {
    markAsReadMock.mockRejectedValue(new Error('network'))
    const { run, setToast, setView } = setup()

    await run()

    expect(warnSpy).toHaveBeenCalledWith('[ReadingPage] markAsRead 失败', expect.any(Error))
    expect(setToast).toHaveBeenCalledWith('阅读记录保存失败，请稍后重试')
    expect(setView).not.toHaveBeenCalled()
  })

  it('未读且已有题目：标记已读、进入答题并后台补语法填空', async () => {
    const grammar = makeQuestion({ id: 'g1', type: 'grammar_fill' })
    getGrammarMock.mockResolvedValue([grammar])
    const { run, setArticle, setView, setToast, setGrammarQuestions } = setup({
      questions: [makeQuestion()],
    })

    await run()

    expect(markAsReadMock).toHaveBeenCalledWith('2026-10-26')
    expect(setArticle).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2026-10-26', readAt: expect.any(Number) })
    )
    expect(setView).toHaveBeenCalledWith('quiz')
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(setToast).toHaveBeenCalledWith('阅读已记录 ✓ 进入答题')
    expect(setGrammarQuestions).toHaveBeenCalledWith([grammar])
    // 已有题目时不应触发生成
    expect(getQuestionsMock).not.toHaveBeenCalled()
  })

  it('已读且已有题目：不重复标记；语法题已存在时不重复生成', async () => {
    const { run, setArticle, setToast } = setup({
      isArticleRead: true,
      questions: [makeQuestion()],
      grammarQuestions: [makeQuestion({ id: 'g1', type: 'grammar_fill' })],
    })

    await run()

    expect(markAsReadMock).not.toHaveBeenCalled()
    expect(setArticle).not.toHaveBeenCalled()
    expect(setToast).not.toHaveBeenCalled()
    expect(getGrammarMock).not.toHaveBeenCalled()
  })

  it('已有题目且语法题为空：后台生成失败时写入错误提示', async () => {
    getGrammarMock.mockRejectedValue(new Error('语法服务不可用'))
    const { run, setGrammarGenError } = setup({ questions: [makeQuestion()] })

    await run()

    expect(warnSpy).toHaveBeenCalledWith(
      '[ReadingPage] 后台生成语法填空题失败',
      expect.any(Error)
    )
    expect(setGrammarGenError).toHaveBeenCalledWith('语法服务不可用')
  })

  it('后台语法填空生成被中断（AbortError）时静默忽略', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    getGrammarMock.mockRejectedValue(abortErr)
    const { run, setGrammarGenError } = setup({ questions: [makeQuestion()] })

    await run()

    expect(setGrammarGenError).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[ReadingPage] 后台生成语法填空题失败',
      expect.anything()
    )
  })

  it('无题目：生成练习题成功，进入答题并后台补语法填空', async () => {
    const generated = [makeQuestion()]
    getQuestionsMock.mockResolvedValue(generated)
    const grammar = makeQuestion({ id: 'g1', type: 'grammar_fill' })
    getGrammarMock.mockResolvedValue([grammar])
    const {
      run,
      setQuestions,
      setView,
      setToast,
      setQuizGenStage,
      setGeneratingQuestions,
      setGrammarQuestions,
    } = setup()

    await run()

    expect(setGeneratingQuestions).toHaveBeenNthCalledWith(1, true)
    expect(setGeneratingQuestions).toHaveBeenLastCalledWith(false)
    expect(setQuizGenStage).toHaveBeenCalledWith('generating')
    expect(setToast).toHaveBeenCalledWith('正在生成练习题...')
    expect(setQuestions).toHaveBeenCalledWith(generated)
    expect(setView).toHaveBeenCalledWith('quiz')
    expect(setToast).toHaveBeenCalledWith('练习题已生成 ✓ 进入答题')
    expect(setQuizGenStage).toHaveBeenCalledWith('idle')
    expect(setGrammarQuestions).toHaveBeenCalledWith([grammar])
  })

  it('流式空信号：先提示重试，再提示使用备选方案', async () => {
    getQuestionsMock.mockImplementation(async (_article, options) => {
      options?.onChunk?.('', '')
      options?.onChunk?.('', '')
      return [makeQuestion()]
    })
    const { run, setQuizGenStage, setToast } = setup()

    await run()

    expect(setQuizGenStage).toHaveBeenCalledWith('retrying')
    expect(setToast).toHaveBeenCalledWith('正在重试...')
    expect(setQuizGenStage).toHaveBeenCalledWith('fallback')
    expect(setToast).toHaveBeenCalledWith('正在使用备选方案...')
  })

  it('生成结果为空数组：提示失败并进入 error 阶段', async () => {
    getQuestionsMock.mockResolvedValue([])
    const { run, setToast, setQuizGenStage, setQuestions, setGeneratingQuestions } = setup()

    await run()

    expect(setToast).toHaveBeenCalledWith('练习题生成失败，请稍后重试')
    expect(setQuizGenStage).toHaveBeenCalledWith('error')
    expect(setQuestions).not.toHaveBeenCalled()
    expect(setGeneratingQuestions).toHaveBeenLastCalledWith(false)
  })

  it('组件已卸载时丢弃生成结果', async () => {
    getQuestionsMock.mockResolvedValue([makeQuestion()])
    const { run, setQuestions, setToast, setGeneratingQuestions, mountedRef } = setup()
    mountedRef.current = false

    await run()

    expect(setQuestions).not.toHaveBeenCalled()
    expect(setToast).not.toHaveBeenCalledWith('练习题已生成 ✓ 进入答题')
    // finally 中也不应再写 state
    expect(setGeneratingQuestions).toHaveBeenCalledTimes(1)
    expect(setGeneratingQuestions).toHaveBeenCalledWith(true)
  })

  it('请求被中断时丢弃结果', async () => {
    let resolveQuestions: (value: Question[]) => void = () => {}
    getQuestionsMock.mockReturnValue(
      new Promise<Question[]>((resolve) => {
        resolveQuestions = resolve
      })
    )
    const { run, setQuestions, abortControllerRef } = setup()

    const pending = run()
    await waitForCall(getQuestionsMock)
    abortControllerRef.current?.abort()

    await act(async () => {
      resolveQuestions([makeQuestion()])
    })
    await pending

    expect(setQuestions).not.toHaveBeenCalled()
  })

  it('生成抛出 AbortError：静默回到 idle，不提示错误', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    getQuestionsMock.mockRejectedValue(abortErr)
    const { run, setToast, setQuizGenStage, setGeneratingQuestions } = setup()

    await run()

    expect(setQuizGenStage).toHaveBeenCalledWith('idle')
    expect(setToast).toHaveBeenCalledTimes(1)
    expect(setToast).toHaveBeenCalledWith('正在生成练习题...')
    expect(setGeneratingQuestions).toHaveBeenLastCalledWith(false)
  })

  it('生成失败：透传错误原因并进入 error 阶段', async () => {
    getQuestionsMock.mockRejectedValue(new Error('AI 服务未配置'))
    const { run, setToast, setQuizGenStage, setGeneratingQuestions } = setup()

    await run()

    expect(warnSpy).toHaveBeenCalledWith(
      '[ReadingPage] 练习题生成失败',
      expect.any(Error)
    )
    expect(setToast).toHaveBeenCalledWith('练习题生成失败：AI 服务未配置')
    expect(setQuizGenStage).toHaveBeenCalledWith('error')
    expect(setGeneratingQuestions).toHaveBeenLastCalledWith(false)
  })

  it('生成失败且错误非 Error：使用兜底文案', async () => {
    getQuestionsMock.mockRejectedValue('boom')
    const { run, setToast } = setup()

    await run()

    expect(setToast).toHaveBeenCalledWith('练习题生成失败，请稍后重试')
  })

  it('生成失败但组件已卸载：不再提示', async () => {
    getQuestionsMock.mockRejectedValue(new Error('boom'))
    const { run, setToast, setGeneratingQuestions, mountedRef } = setup()
    mountedRef.current = false

    await run()

    expect(setToast).not.toHaveBeenCalledWith(
      expect.stringContaining('练习题生成失败')
    )
    expect(setGeneratingQuestions).toHaveBeenCalledTimes(1)
  })

  it('重新发起请求前中断上一个 AbortController', async () => {
    const previous = new AbortController()
    const abortSpy = vi.spyOn(previous, 'abort')
    getQuestionsMock.mockResolvedValue([makeQuestion()])
    const { run, abortControllerRef } = setup()
    abortControllerRef.current = previous

    await run()

    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(abortControllerRef.current).not.toBe(previous)
  })
})

// 等待 mock 被调用（不依赖 fake timers）
async function waitForCall(mock: { mock: { calls: unknown[][] } }): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (mock.mock.calls.length > 0) return
    await Promise.resolve()
  }
}
