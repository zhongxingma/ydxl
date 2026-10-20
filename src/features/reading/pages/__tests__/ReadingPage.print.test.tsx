// ReadingPage 一键打印完整练习测试（handlePrint 逻辑）
//
// 背景（2026-10-10 修复「打印只有单词/短语/翻译」）：
// - 练习题为懒生成（点「开始答题」时才调 AI），阅读中途点打印时 questions 为空，
//   打印工作表的题目章节被条件渲染跳过
// - 修复：handlePrint 在题目未生成时先并行补齐阅读理解 + 语法填空，再打开打印；
//   生成失败降级打印「原文+单词+短语+翻译」版本并 toast 提示
//
// 覆盖场景：
// 1. 题目已就绪 → 点击打印直接挂载工作表，不触发额外 AI 生成
// 2. 题目未生成 → 先补齐阅读理解 + 语法填空，再挂载含题目章节的工作表
// 3. 生成失败 → 降级仍挂载工作表（无题目章节）+ toast「练习题生成失败，仅打印文章内容」
// 4. 准备期间按钮禁用防重复点击（「准备中...」状态）
//
// Mock 策略：与 ReadingPage.raceAndMarkAsRead.test.tsx 保持一致
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Article, Question } from '@/shared/types'

// ---------- 模块 mock ----------
// 公共 mock 提取至 readingPageTestMocks.ts（三个 ReadingPage 测试共用）；
// 导入顺序必须在被测组件之前，确保 vi.mock 注册先于组件模块求值
import {
  getDailyArticleMock,
  getGrammarFillQuestionsForArticleMock,
  getQuestionsForArticleMock,
  getTodayReadCountMock,
  recordReadingStartMock,
} from './readingPageTestMocks'

import ReadingPage from '../ReadingPage'

// ---------- 测试数据工厂 ----------

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'print-art',
    title: '打印测试文章',
    content: 'Print paragraph one.\nPrint paragraph two.',
    translation: '打印段落一。\n打印段落二。',
    genre: 'narrative',
    wordCount: 200,
    createdAt: Date.now() - 1000 * 60 * 60,
    updated_at: Date.now(),
    topic: 'campus',
    difficulty: 'medium',
    highlightedWords: [
      {
        word: 'print',
        phonetic: '/prɪnt/',
        pos: 'v.',
        definition: '打印',
        example: 'I print the worksheet.',
      },
    ],
    phrases: [
      { phrase: 'print out', meaning: '打印出来', example: 'Print it out.', exampleTranslation: '把它打印出来。' },
    ],
    readAt: null,
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'pq-1',
    articleId: 'print-art',
    type: 'detail',
    stem: '打印测试题目？',
    options: ['选项一', '选项二', '选项三', '选项四'],
    correctIndex: 0,
    explanation: '解析说明',
    locationClue: '第一段',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function renderReadingPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/reading']}>
      <Routes>
        <Route path="/reading" element={<ReadingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// 新阅读流程：挂载后点击「开始阅读」触发 loadToday
async function startDailyReading(): Promise<void> {
  fireEvent.click(await screen.findByText('开始阅读'))
}

// 打印入口按钮（aria-label 定位，文案会随 preparingPrint 在「打印/准备中...」间切换）
function getPrintButton(): HTMLElement {
  return screen.getByRole('button', { name: '打印完整练习' })
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
  // jsdom 未实现 window.print，替换为 spy
  vi.spyOn(window, 'print').mockImplementation(() => {})
})

afterAll(() => {
  globalThis.IntersectionObserver = originalIntersectionObserver
  vi.restoreAllMocks()
})

// ---------- 测试用例 ----------

describe('ReadingPage 一键打印完整练习（handlePrint）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recordReadingStartMock.mockResolvedValue(undefined)
    getTodayReadCountMock.mockResolvedValue(0)
  })

  // 1. 题目已就绪：直接打印，不触发额外 AI 生成
  it('题目已就绪时点击打印直接挂载工作表，不再调用题目生成', async () => {
    const article = makeArticle()
    getDailyArticleMock.mockResolvedValue(article)
    getQuestionsForArticleMock.mockResolvedValue([makeQuestion()])
    getGrammarFillQuestionsForArticleMock.mockResolvedValue([
      makeQuestion({ id: 'pg-1', type: 'grammar_fill' }),
    ])

    renderReadingPage()
    await startDailyReading()
    await waitFor(() => {
      expect(screen.getByText('打印测试文章')).toBeInTheDocument()
    })

    // 页面加载已消耗各 1 次调用
    const readingCallsAfterLoad = getQuestionsForArticleMock.mock.calls.length
    const grammarCallsAfterLoad = getGrammarFillQuestionsForArticleMock.mock.calls.length

    fireEvent.click(getPrintButton())

    // 打印工作表通过 Portal 挂载（「一、阅读原文」为工作表特有标题）
    expect(await screen.findByText('一、阅读原文')).toBeInTheDocument()
    expect(screen.getByText('二、阅读理解（共 1 题）')).toBeInTheDocument()
    expect(screen.getByText('三、语法填空（共 1 题）')).toBeInTheDocument()

    // 点击打印不应触发额外生成调用
    expect(getQuestionsForArticleMock.mock.calls.length).toBe(readingCallsAfterLoad)
    expect(getGrammarFillQuestionsForArticleMock.mock.calls.length).toBe(grammarCallsAfterLoad)
  })

  // 2. 题目未生成：先补齐阅读理解 + 语法填空，再挂载含题目章节的工作表
  it('题目未生成时先补齐再打印，工作表包含题目章节', async () => {
    const article = makeArticle()
    getDailyArticleMock.mockResolvedValue(article)
    // 页面加载时均返回空（懒生成场景）；点击打印时返回生成的题目
    getQuestionsForArticleMock
      .mockResolvedValueOnce([]) // 页面加载
      .mockResolvedValueOnce([makeQuestion()]) // 打印补齐
    getGrammarFillQuestionsForArticleMock
      .mockResolvedValueOnce([]) // 页面加载
      .mockResolvedValueOnce([makeQuestion({ id: 'pg-1', type: 'grammar_fill' })]) // 打印补齐

    renderReadingPage()
    await startDailyReading()
    await waitFor(() => {
      expect(screen.getByText('打印测试文章')).toBeInTheDocument()
    })

    fireEvent.click(getPrintButton())

    // 补齐完成后工作表包含题目章节
    expect(await screen.findByText('二、阅读理解（共 1 题）')).toBeInTheDocument()
    expect(screen.getByText('三、语法填空（共 1 题）')).toBeInTheDocument()
    expect(screen.getByText('四、参考答案与解析')).toBeInTheDocument()

    // 补齐阶段确实调用了两个生成服务（加载 1 次 + 打印补齐 1 次 = 各 2 次）
    expect(getQuestionsForArticleMock.mock.calls.length).toBe(2)
    expect(getGrammarFillQuestionsForArticleMock.mock.calls.length).toBe(2)
  })

  // 3. 生成失败：降级仍打印（无题目章节）+ toast 提示
  it('题目生成失败时降级打印文章内容并提示，工作表无题目章节', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const article = makeArticle()
    getDailyArticleMock.mockResolvedValue(article)
    // 页面加载返回空；打印补齐时生成失败
    getQuestionsForArticleMock
      .mockResolvedValueOnce([]) // 页面加载
      .mockRejectedValueOnce(new Error('AI 服务不可用')) // 打印补齐失败
    getGrammarFillQuestionsForArticleMock
      .mockResolvedValueOnce([]) // 页面加载
      .mockRejectedValueOnce(new Error('AI 服务不可用')) // 打印补齐失败

    renderReadingPage()
    await startDailyReading()
    await waitFor(() => {
      expect(screen.getByText('打印测试文章')).toBeInTheDocument()
    })

    fireEvent.click(getPrintButton())

    // 降级提示 toast
    await waitFor(() => {
      expect(screen.getByText('练习题生成失败，仅打印文章内容')).toBeInTheDocument()
    }, { timeout: 2000 })

    // 工作表仍挂载：有原文与词汇板块，无题目章节
    expect(await screen.findByText('一、阅读原文')).toBeInTheDocument()
    expect(screen.getByText(/重点单词（共 1 个）/)).toBeInTheDocument()
    expect(screen.queryByText(/阅读理解（共/)).not.toBeInTheDocument()
    expect(screen.queryByText(/语法填空（共/)).not.toBeInTheDocument()

    warnSpy.mockRestore()
  })

  // 4. 准备期间按钮禁用防重复点击（「准备中...」状态）
  it('打印准备期间按钮显示「准备中...」并禁用，防止重复点击', async () => {
    const article = makeArticle()
    getDailyArticleMock.mockResolvedValue(article)
    // 手动控制 resolve 时机，观察准备中间态
    let resolveReading!: (value: Question[]) => void
    getQuestionsForArticleMock
      .mockResolvedValueOnce([]) // 页面加载
      .mockImplementationOnce(
        () => new Promise<Question[]>((resolve) => (resolveReading = resolve)),
      )
    getGrammarFillQuestionsForArticleMock.mockResolvedValue([])

    renderReadingPage()
    await startDailyReading()
    await waitFor(() => {
      expect(screen.getByText('打印测试文章')).toBeInTheDocument()
    })

    fireEvent.click(getPrintButton())

    // 准备中间态：按钮禁用 + 文案切换
    await waitFor(() => {
      expect(getPrintButton()).toBeDisabled()
      expect(screen.getByText('准备中...')).toBeInTheDocument()
    })

    // 完成生成 → 打印打开、按钮恢复可用（文案恢复「打印」）
    resolveReading([makeQuestion()])
    expect(await screen.findByText('二、阅读理解（共 1 题）')).toBeInTheDocument()
    await waitFor(() => {
      expect(getPrintButton()).toBeEnabled()
      expect(getPrintButton()).toHaveTextContent('打印')
    })
  })
})
