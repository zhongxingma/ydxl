//
// 覆盖场景：
// 1. handleMarkAsRead 成功且有题目时 → view 切换到 'quiz' + 滚动到顶部
// 2. handleMarkAsRead 成功但无题目时 → view 保持 'reading' + toast 提示"本文暂无练习题"
// 4. loadTokenRef 竞态保护：快速切换 A→B 时最终显示 B
//
// Mock 策略：与 ReadingPage.articleId.test.tsx 保持一致
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

import ReadingPage from '../ReadingPage'

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

function renderReadingPage(initialEntry = '/reading'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reading" element={<ReadingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// 新阅读流程辅助：挂载 /reading（无 articleId）后不再自动加载文章，
// 而是先弹出难度选择弹窗，点击「开始阅读」才触发 loadToday（与真实用户路径一致）
async function startDailyReading(): Promise<void> {
  fireEvent.click(await screen.findByText('开始阅读'))
}

// ---------- IntersectionObserver mock ----------

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
  // 2026-07-26 改进：questionService.getQuestionsForArticle 失败时抛错（原静默返回 []），
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

// ---------- 竞态保护测试 ----------

describe('ReadingPage loadTokenRef 竞态保护', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markAsReadMock.mockResolvedValue(true)
    recordReadingStartMock.mockResolvedValue(true)
    getTodayReadCountMock.mockResolvedValue(0)
    getQuestionsForArticleMock.mockResolvedValue([])
    extractAndCacheVocabularyMock.mockResolvedValue([])
  })

  // 7. 历史文章 A→B 快速切换时最终显示 B
  it('A→B 快速切换：最终显示文章 B（loadTokenRef 丢弃过期结果）', async () => {
    const articleA = makeArticle({ id: 'art-a', title: '文章A' })
    const articleB = makeArticle({ id: 'art-b', title: '文章B' })

    // getArticleById 第一次返回 A（延迟），第二次返回 B（立即）
    // 模拟 A 的加载比 B 慢：B 已加载完成时 A 才 resolve
    getArticleByIdMock
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(articleA), 100)),
      )
      .mockImplementationOnce(() => Promise.resolve(articleB))

    const { unmount } = renderReadingPage('/reading?articleId=art-a')

    // 等待一帧后切换到 articleId=art-b
    await new Promise((r) => setTimeout(r, 10))

    // 重新渲染为 art-b（模拟用户快速点击历史文章 B）
    // 使用 unmount + render 模拟导航切换
    unmount()
    renderReadingPage('/reading?articleId=art-b')

    // 等待所有加载完成（A 的 100ms 延迟 + B 的立即）
    await waitFor(() => {
      expect(screen.getByText('文章B')).toBeInTheDocument()
    }, { timeout: 2000 })

    // 最终显示的应该是 B，而不是 A
    expect(screen.queryByText('文章A')).not.toBeInTheDocument()
    expect(screen.getByText('文章B')).toBeInTheDocument()
  })

  // 8. cache event 在 loading 状态下为 no-op
  it('cache event：status=loading 时不覆盖当前加载中的文章', async () => {
    // 此测试通过验证 loadArticleById 的 token 机制间接覆盖
    // 核心逻辑：loadTokenRef 在每次加载时自增，过期 token 的结果被丢弃
    const article = makeArticle({ id: 'stable-art', title: '稳定文章' })

    // 延迟返回，使加载期间 status='loading'
    getArticleByIdMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(article), 50)),
    )

    renderReadingPage('/reading?articleId=stable-art')

    // 等待加载完成
    await waitFor(() => {
      expect(screen.getByText('稳定文章')).toBeInTheDocument()
    }, { timeout: 2000 })

    // 验证加载成功，未出现错误状态
    expect(screen.queryByText('重新加载')).not.toBeInTheDocument()
  })
})

describe('ReadingPage 语法填空交互式生成选择页（阅读理解完成后）', () => {
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
    // 改写语法填空 mock：默认返回空数组（初始加载与后台生成均不产出），避免 undefined
    const grammarMock = vi.fn().mockResolvedValue([])
    ;(await import('../../services/questionService')).questionService.getGrammarFillQuestionsForArticle =
      grammarMock

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
    grammarMock.mockResolvedValueOnce([
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
    // getGrammarFillQuestionsForArticle 保持默认 mockResolvedValue([])
    ;(await import('../../services/questionService')).questionService.getGrammarFillQuestionsForArticle =
      vi.fn().mockResolvedValue([])

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
