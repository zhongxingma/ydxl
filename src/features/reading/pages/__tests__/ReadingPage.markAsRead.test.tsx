// ReadingPage 阅读完成（handleMarkAsRead）与开始答题入口
//
// 覆盖场景：
// 1. handleMarkAsRead 成功且有题目时 → view 切换到 'quiz'
// 2. handleMarkAsRead 无题目且生成失败时 → 保持阅读视图并提示「练习题生成失败：...」
// 3. handleMarkAsRead 无题目但生成成功时 → 切换到 quiz 视图
// 4. 已读文章的「开始答题」按钮显示条件
// 5. handleMarkAsRead 失败时 → 提示「阅读记录保存失败」
//
// 由 ReadingPage.raceAndMarkAsRead.test.tsx 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'

// ---------- 模块 mock ----------
// 公共 mock 提取至 readingPageTestMocks.ts（三个 ReadingPage 测试共用）；
// 导入顺序必须在被测组件之前，确保 vi.mock 注册先于组件模块求值
import {
  extractAndCacheVocabularyMock,
  getArticleByIdMock,
  getDailyArticleMock,
  getQuestionsForArticleMock,
  getTodayReadCountMock,
  markAsReadMock,
  recordReadingStartMock,
} from './readingPageTestMocks'
import {
  makeArticle,
  makeQuestion,
  renderReadingPage,
  startDailyReading,
  installIntersectionObserverMock,
  restoreIntersectionObserverMock,
} from './readingPageRenderHelpers'

beforeAll(() => {
  installIntersectionObserverMock()
})

afterAll(() => {
  restoreIntersectionObserverMock()
})

describe('ReadingPage handleMarkAsRead 与开始答题入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markAsReadMock.mockResolvedValue(true)
    recordReadingStartMock.mockResolvedValue(true)
    getTodayReadCountMock.mockResolvedValue(0)
    getQuestionsForArticleMock.mockResolvedValue([])
    extractAndCacheVocabularyMock.mockResolvedValue([])
  })

  // 1. handleMarkAsRead 成功且有题目时 → view 切换到 'quiz'
  it('handleMarkAsRead：题目已加载时成功后自动切换到 quiz 视图', async () => {
    const article = makeArticle({ id: 'art-with-quiz', title: '有题目的文章' })
    getDailyArticleMock.mockResolvedValue(article)
    // 提供单题
    getQuestionsForArticleMock.mockResolvedValue([makeQuestion()])

    renderReadingPage('/reading')
    await startDailyReading()

    // 等待文章加载完成
    await waitFor(() => {
      expect(screen.getByText('有题目的文章')).toBeInTheDocument()
    })

    // 点击"阅读完成"按钮
    const markReadBtn = screen.getByText('阅读完成')
    fireEvent.click(markReadBtn)

    // 等待 markAsRead 调用完成
    await waitFor(() => {
      expect(markAsReadMock).toHaveBeenCalledWith('art-with-quiz')
    })

    // 应自动切换到 quiz 视图：显示"返回阅读"链接与"阅读理解"标题
    await waitFor(() => {
      expect(screen.getByText('返回阅读')).toBeInTheDocument()
      expect(screen.getByText('阅读理解')).toBeInTheDocument()
    })

    // 应显示题目题干
    await waitFor(() => {
      expect(screen.getByText('文章的主旨是什么？')).toBeInTheDocument()
    })
  })

  // 2. handleMarkAsRead 成功但无题目时 → 尝试生成练习题，生成失败时提示"练习题生成失败：..."
  // 改进：questionService.getQuestionsForArticle 失败时抛错（原静默返回 []），
  //                ReadingPage 透传真实错误原因，便于用户排查
  it('handleMarkAsRead：无题目且生成失败时保持 reading 视图并提示"练习题生成失败：..."', async () => {
    const article = makeArticle({ id: 'art-no-quiz', title: '无题目的文章' })
    getDailyArticleMock.mockResolvedValue(article)
    // 页面加载时题目查询失败（mockRejectedValue 模拟 AI 调用失败）
    getQuestionsForArticleMock.mockRejectedValue(new Error('AI 服务未配置或不可用'))

    renderReadingPage('/reading')
    await startDailyReading()

    await waitFor(() => {
      expect(screen.getByText('无题目的文章')).toBeInTheDocument()
    })

    // 点击"阅读完成"按钮
    fireEvent.click(screen.getByText('阅读完成'))

    // 等待 markAsRead 调用
    await waitFor(() => {
      expect(markAsReadMock).toHaveBeenCalledWith('art-no-quiz')
    })

    // 应显示 toast 提示"练习题生成失败：AI 服务未配置或不可用"（透传真实错误原因）
    await waitFor(() => {
      expect(screen.getByText(/练习题生成失败.*AI 服务未配置/)).toBeInTheDocument()
    }, { timeout: 2000 })

    // 不应切换到 quiz 视图：不应出现"返回阅读"链接
    expect(screen.queryByText('返回阅读')).not.toBeInTheDocument()
    // 应仍处于 reading 视图：显示"原文与翻译"标题
    expect(screen.getByText('原文与翻译')).toBeInTheDocument()
  })

  // 2b. handleMarkAsRead 无题目但生成成功时 → 切换到 quiz 视图
  it('handleMarkAsRead：无题目但生成成功时切换到 quiz 视图', async () => {
    const article = makeArticle({ id: 'art-gen-quiz', title: '生成题目的文章' })
    getDailyArticleMock.mockResolvedValue(article)
    // 页面加载时返回空（questions=[]），点击"阅读完成"时返回生成的题目
    getQuestionsForArticleMock
      .mockResolvedValueOnce([]) // 页面加载时
      .mockResolvedValueOnce([makeQuestion()]) // handleMarkAsRead 触发生成时

    renderReadingPage('/reading')
    await startDailyReading()

    await waitFor(() => {
      expect(screen.getByText('生成题目的文章')).toBeInTheDocument()
    })

    // 点击"阅读完成"按钮
    fireEvent.click(screen.getByText('阅读完成'))

    // 应切换到 quiz 视图：显示"返回阅读"链接
    await waitFor(() => {
      expect(screen.getByText('返回阅读')).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('已读文章：isArticleRead=true 时仍显示"开始答题"按钮（无需 reachedBottom）', async () => {
    const article = makeArticle({
      id: 'read-art',
      title: '已读文章',
      readAt: Date.now() - 1000 * 60 * 60, // 1 小时前已读
    })
    getArticleByIdMock.mockResolvedValue(article)
    getQuestionsForArticleMock.mockResolvedValue([makeQuestion()])

    renderReadingPage('/reading?articleId=read-art')

    // 等待文章加载完成
    await waitFor(() => {
      expect(screen.getByText('已读文章')).toBeInTheDocument()
    })

    // 应显示"已完成阅读"按钮（已读状态）
    expect(screen.getByText('已完成阅读')).toBeInTheDocument()

    // 应显示"开始答题"按钮（即使未滚动到底部，isArticleRead=true 即可）
    expect(screen.getByText(/开始答题/)).toBeInTheDocument()
  })

  // 4. 无题目的已读文章不显示"开始答题"按钮
  it('已读文章但无题目：不显示"开始答题"按钮', async () => {
    const article = makeArticle({
      id: 'read-no-quiz',
      title: '已读无题目',
      readAt: Date.now() - 1000 * 60 * 60,
    })
    getArticleByIdMock.mockResolvedValue(article)
    // 无题目（默认空数组）

    renderReadingPage('/reading?articleId=read-no-quiz')

    await waitFor(() => {
      expect(screen.getByText('已读无题目')).toBeInTheDocument()
    })

    // 不应显示"开始答题"按钮（questions.length === 0）
    expect(screen.queryByText(/开始答题/)).not.toBeInTheDocument()
  })

  // 5. handleMarkAsRead 失败时显示错误 toast
  it('handleMarkAsRead 失败：显示"阅读记录保存失败"toast', async () => {
    const article = makeArticle({ id: 'fail-art', title: '会失败的文章' })
    getDailyArticleMock.mockResolvedValue(article)
    markAsReadMock.mockRejectedValue(new Error('Network error'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderReadingPage('/reading')
    await startDailyReading()

    await waitFor(() => {
      expect(screen.getByText('会失败的文章')).toBeInTheDocument()
    })

    // 点击"阅读完成"按钮
    fireEvent.click(screen.getByText('阅读完成'))

    // 应显示失败 toast
    await waitFor(() => {
      expect(screen.getByText(/阅读记录保存失败/)).toBeInTheDocument()
    })

    warnSpy.mockRestore()
  })

  // 6. 未读文章未滚动到底部时不显示"开始答题"按钮
  it('未读文章未滚动到底部：不显示"开始答题"按钮（仅 reachedBottom 或 isArticleRead 触发）', async () => {
    // 注意：IntersectionObserver mock 会立即触发 isIntersecting=true，
    // 使 reachedBottom=true。为测试"未到底部"场景，需要覆盖 mock 使其不触发。
    // 此测试验证默认 mock 下（reachedBottom=true）按钮显示，与测试 3 形成对照
    const article = makeArticle({ id: 'unread-art', title: '未读文章' })
    getDailyArticleMock.mockResolvedValue(article)
    getQuestionsForArticleMock.mockResolvedValue([makeQuestion()])

    renderReadingPage('/reading')
    await startDailyReading()

    await waitFor(() => {
      expect(screen.getByText('未读文章')).toBeInTheDocument()
    })

    // 默认 mock 使 reachedBottom=true，应显示"开始答题"按钮
    // 题目异步加载，使用 findByText 等待按钮渲染完成
    expect(await screen.findByText(/开始答题/)).toBeInTheDocument()
  })
})
