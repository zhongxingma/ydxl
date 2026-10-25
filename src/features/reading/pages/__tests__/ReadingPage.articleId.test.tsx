// ReadingPage articleId 查询参数加载测试
//
// 覆盖场景：
// 1. ?articleId=xxx 存在时调用 getArticleById 而非 getDailyArticle，并显示「历史文章」徽章
// 2. 无 articleId 时保持原 loadToday 行为（调用 getDailyArticle），不显示「历史文章」徽章
// 3. ArticleNotFoundError 时显示「文章不存在或已被删除」友好提示
// 4. 已读历史文章加载并进入成绩单视图时不重复调用 markAsRead
//
// Mock 策略：
// - mock articleService（getArticleById/getDailyArticle/markAsRead 等）
// - mock questionService / vocabularyService（默认返回空数组，场景 4 返回单题）
// - mock @/features/stats（AchievementUnlockToast + statsService + checkAndUnlockAchievements）
//   避免 useSessionRecorder 在 result 视图触发真实网络请求
// - 安装 IntersectionObserver 全局 mock（useReadingProgress 依赖，jsdom 无原生实现）
//   observe 时立即报告哨兵进入视口，使「开始答题」按钮出现便于走完答题流程

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Article, Question } from '@/shared/types'

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

// 在所有 mock 之后导入被测组件与错误类（同为 mock 模块的导出）
import ReadingPage from '../ReadingPage'
import { ArticleNotFoundError } from '../../services/articleService'

// ---------- 测试数据工厂 ----------

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'test-id',
    title: '测试文章标题',
    content: '这是文章内容。\n\n第二段内容。',
    translation: '这是翻译。',
    genre: 'narrative',
    wordCount: 100,
    createdAt: Date.now() - 1000 * 60 * 60,
    updated_at: Date.now(),
    topic: 'campus',
    difficulty: 'medium',
    readAt: null,
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    articleId: 'test-id',
    type: 'detail',
    stem: '文章的主旨是什么？',
    options: ['选项一', '选项二', '选项三', '选项四'],
    correctIndex: 0,
    explanation: '解析说明',
    locationClue: '文章内容',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// ---------- 渲染辅助 ----------

// 包裹 MemoryRouter，initialEntries 控制是否携带 ?articleId= 查询参数
function renderReadingPage(initialEntry = '/reading'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reading" element={<ReadingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ---------- IntersectionObserver 全局 mock ----------

// jsdom 无原生 IntersectionObserver，提供最小实现：
// observe 时立即回调 isIntersecting=true，使 useReadingProgress 将 reachedBottom 置为 true
class MockIntersectionObserver {
  private cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
  }
  observe(): void {
    this.cb(
      [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver

beforeAll(() => {
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
})

afterAll(() => {
  globalThis.IntersectionObserver = originalIntersectionObserver
})

// ---------- 测试用例 ----------

describe('ReadingPage articleId 查询参数加载', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重设共享默认实现（clearAllMocks 不会重置实现，这里显式确保默认值一致）
    markAsReadMock.mockResolvedValue(true)
    recordReadingStartMock.mockResolvedValue(true)
    getTodayReadCountMock.mockResolvedValue(0)
    getQuestionsForArticleMock.mockResolvedValue([])
    extractAndCacheVocabularyMock.mockResolvedValue([])
  })

  // 1. ?articleId=xxx 存在时调用 getArticleById 而非 getDailyArticle
  it('?articleId 存在时调用 getArticleById 而非 getDailyArticle，并显示「历史文章」徽章', async () => {
    const article = makeArticle({ id: 'hist-1', title: '历史文章标题' })
    getArticleByIdMock.mockResolvedValue(article)

    renderReadingPage('/reading?articleId=hist-1')

    // 等待文章加载并渲染标题
    await waitFor(() => {
      expect(screen.getByText('历史文章标题')).toBeInTheDocument()
    })

    // 调用 getArticleById 且参数为查询参数中的 articleId
    expect(getArticleByIdMock).toHaveBeenCalledWith('hist-1')
    // 不应调用 getDailyArticle（loadToday 路径）
    expect(getDailyArticleMock).not.toHaveBeenCalled()
    // 显示「历史文章」徽章
    expect(screen.getByText('历史文章')).toBeInTheDocument()
  })

  // 2. 无 articleId 时保持原 loadToday 行为
  it('无 articleId 时调用 getDailyArticle（loadToday），不显示「历史文章」徽章', async () => {
    const article = makeArticle({ id: '2026-07-16', title: '今日文章标题' })
    getDailyArticleMock.mockResolvedValue(article)

    renderReadingPage('/reading')

    // 新流程：无 articleId 时先弹出难度选择弹窗，点击「开始阅读」才触发 loadToday
    fireEvent.click(await screen.findByText('开始阅读'))

    await waitFor(() => {
      expect(screen.getByText('今日文章标题')).toBeInTheDocument()
    })

    // 调用 getDailyArticle
    expect(getDailyArticleMock).toHaveBeenCalledTimes(1)
    // 不应调用 getArticleById
    expect(getArticleByIdMock).not.toHaveBeenCalled()
    // 不显示「历史文章」徽章
    expect(screen.queryByText('历史文章')).not.toBeInTheDocument()
  })

  // 3. ArticleNotFoundError 时显示「文章不存在或已被删除」友好提示
  it('ArticleNotFoundError 时显示「文章不存在或已被删除」友好提示', async () => {
    getArticleByIdMock.mockRejectedValue(new ArticleNotFoundError('missing-id'))

    // 抑制组件内的 console.error 输出
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderReadingPage('/reading?articleId=missing-id')

    await waitFor(() => {
      expect(screen.getByText('文章不存在或已被删除')).toBeInTheDocument()
    })
    // 错误状态下仍提供重新加载按钮
    expect(screen.getByText('重新加载')).toBeInTheDocument()

    errorSpy.mockRestore()
  })

  // 4. 已读历史文章加载并进入成绩单视图时不重复调用 markAsRead
  it('已读历史文章加载并进入成绩单视图时不重复调用 markAsRead', async () => {
    const article = makeArticle({
      id: 'read-hist-1',
      title: '已读历史文章',
      readAt: Date.now() - 1000 * 60 * 60, // 1 小时前已读
    })
    getArticleByIdMock.mockResolvedValue(article)
    // 提供单题，便于走完答题流程进入 result 视图验证 markAsRead effect
    getQuestionsForArticleMock.mockResolvedValue([makeQuestion()])

    renderReadingPage('/reading?articleId=read-hist-1')

    // 等待文章加载完成
    await waitFor(() => {
      expect(screen.getByText('已读历史文章')).toBeInTheDocument()
    })
    // 加载阶段不应调用 markAsRead
    expect(markAsReadMock).not.toHaveBeenCalled()

    // 「阅读完成」按钮应为已完成态（已读文章禁用，不会触发 markAsRead）
    expect(screen.getByText('已完成阅读')).toBeInTheDocument()

    // IntersectionObserver mock 已使 reachedBottom=true，等待「开始答题」按钮出现
    const startQuizBtn = await screen.findByText(/开始答题/)
    fireEvent.click(startQuizBtn)

    // 答题：点击第一个选项（按钮可访问名为 "A. 选项一"）
    const optionBtn = await screen.findByRole('button', { name: /选项一/ })
    fireEvent.click(optionBtn)

    // 点击「查看成绩」进入 result 视图（单题，最后一题按钮文案为「查看成绩」）
    await waitFor(() => {
      expect(screen.getByText('查看成绩')).toBeEnabled()
    })
    fireEvent.click(screen.getByText('查看成绩'))

    // 等待成绩单渲染（result 视图）
    await waitFor(() => {
      expect(screen.getByText('本次成绩单')).toBeInTheDocument()
    })

    // 进入 result 视图后仍不应调用 markAsRead（已读文章不重复标记）
    expect(markAsReadMock).not.toHaveBeenCalled()
  })
})
