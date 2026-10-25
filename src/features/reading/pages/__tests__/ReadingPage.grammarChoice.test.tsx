// ReadingPage 语法填空交互式生成选择页（阅读理解完成后）
//
// 场景：
// 1. 阅读理解最后一题完成但语法填空未生成 → 成绩单顶部展示选择页，可交互生成并进入答题
// 2. 用户选择跳过 → 选择页关闭，停留在成绩单（语法填空分区不强制）
//
// 由 ReadingPage.raceAndMarkAsRead.test.tsx 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'

// ---------- 模块 mock ----------
// 公共 mock 提取至 readingPageTestMocks.ts（三个 ReadingPage 测试共用）；
// 导入顺序必须在被测组件之前，确保 vi.mock 注册先于组件模块求值
import {
  getArticleByIdMock,
  getGrammarFillQuestionsForArticleMock,
  getQuestionsForArticleMock,
} from './readingPageTestMocks'
import {
  makeArticle,
  makeQuestion,
  renderReadingPage,
  installIntersectionObserverMock,
  restoreIntersectionObserverMock,
} from './readingPageRenderHelpers'

beforeAll(() => {
  installIntersectionObserverMock()
})

afterAll(() => {
  restoreIntersectionObserverMock()
})

describe('ReadingPage 语法填空交互式生成选择页（阅读理解完成后）', () => {
  beforeEach(() => {
    // 语法填空默认未生成（初始加载与后台生成均不产出）
    getGrammarFillQuestionsForArticleMock.mockReset()
    getGrammarFillQuestionsForArticleMock.mockResolvedValue([])
  })

  // 场景：阅读理解最后一题完成 → getGrammarFillQuestionsForArticle 返回空（未生成）
  // → 不应静默跳到成绩单，而应在成绩单顶部展示「是否继续做语法填空」选择页。
  // 用户点击「生成语法填空并继续」且生成成功 → 直接进入语法填空答题视图。
  it('阅读理解最后一题完成但语法填空未生成时展示选择页，可交互生成', async () => {
    const article = makeArticle({ id: 'art-grammar-choice', title: '语法填空选择文章' })
    const questions = [
      makeQuestion({ id: 'rq-1', type: 'main_idea' }),
      makeQuestion({ id: 'rq-2', type: 'detail' }),
    ]
    getArticleByIdMock.mockResolvedValue(article)
    // 阅读理解题两题；语法填空默认返回空（模拟后台未生成成功）
    getQuestionsForArticleMock.mockResolvedValue(questions)

    renderReadingPage('/reading?articleId=art-grammar-choice')
    await waitFor(() => {
      expect(screen.getByText('语法填空选择文章')).toBeInTheDocument()
    })

    // 点击"阅读完成"进入阅读理解答题
    fireEvent.click(screen.getByText('阅读完成'))
    await waitFor(() => {
      expect(screen.getByText('返回阅读')).toBeInTheDocument()
    })

    // 依次答完两题（第二题为最后一题）
    for (let i = 0; i < questions.length; i++) {
      // 选择正确项（每个问题的第一个选项）
      fireEvent.click(screen.getByText(questions[i].options[0]))
      // 非最后一题时点击"下一题"进入下一题；最后一题按钮文案为"查看成绩"
      const nextBtn = screen.queryByText('下一题')
      if (nextBtn) {
        fireEvent.click(nextBtn)
      }
    }
    // 最后一题已作答 → 点击"查看成绩"触发 handleNext（语法填空未就绪时应展示选择页）
    const finishBtn = screen.queryByText('查看成绩')
    if (finishBtn) {
      fireEvent.click(finishBtn)
    }

    // 应进入 result 视图并展示语法填空选择页（不静默跳过）
    await waitFor(() => {
      expect(screen.getByText('本次成绩单')).toBeInTheDocument()
    })
    expect(
      screen.getByText('完成阅读理解后，是否继续做语法填空？'),
    ).toBeInTheDocument()

    // 点击「生成语法填空并继续」，此时下一次调用返回语法题成功
    getGrammarFillQuestionsForArticleMock.mockResolvedValueOnce([
      makeQuestion({ id: 'gq-1', type: 'grammar_fill', stem: '语法填空第一题' }),
    ])
    fireEvent.click(screen.getByText('生成语法填空并继续'))

    // 生成成功 → 直接进入语法填空答题视图
    await waitFor(() => {
      expect(screen.getByText('语法填空 · 第 1 / 1 题')).toBeInTheDocument()
    })
  })

  // 场景：用户选择跳过 → 选择页关闭，停留在成绩单（语法填空分区不强制）
  it('用户可选择跳过语法填空直接查看成绩', async () => {
    const article = makeArticle({ id: 'art-grammar-skip', title: '语法填空跳过文章' })
    const questions = [
      makeQuestion({ id: 'rq-s1', type: 'main_idea' }),
      makeQuestion({ id: 'rq-s2', type: 'detail' }),
    ]
    getArticleByIdMock.mockResolvedValue(article)
    getQuestionsForArticleMock.mockResolvedValue(questions)

    renderReadingPage('/reading?articleId=art-grammar-skip')
    await waitFor(() => {
      expect(screen.getByText('语法填空跳过文章')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('阅读完成'))
    await waitFor(() => {
      expect(screen.getByText('返回阅读')).toBeInTheDocument()
    })
    // 依次答完两题（第二题为最后一题）
    for (let i = 0; i < questions.length; i++) {
      fireEvent.click(screen.getByText(questions[i].options[0]))
      const nextBtn = screen.queryByText('下一题')
      if (nextBtn) fireEvent.click(nextBtn)
    }
    const finishBtn = screen.queryByText('查看成绩')
    if (finishBtn) fireEvent.click(finishBtn)

    // 末尾：选择「跳过，直接查看成绩」
    await waitFor(() => {
      expect(screen.getByText('本次成绩单')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('跳过，直接查看成绩'))

    // 选择页关闭
    expect(
      screen.queryByText('完成阅读理解后，是否继续做语法填空？'),
    ).not.toBeInTheDocument()
    // 仍停留在成绩单
    expect(screen.getByText('本次成绩单')).toBeInTheDocument()
  })
})
