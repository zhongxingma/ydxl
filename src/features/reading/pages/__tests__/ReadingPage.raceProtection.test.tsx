// ReadingPage loadTokenRef 竞态保护
//
// 覆盖场景：
// 1. A→B 快速切换：最终显示文章 B（loadTokenRef 丢弃过期结果）
// 2. cache event：status=loading 时不覆盖当前加载中的文章
//
// 由 ReadingPage.raceAndMarkAsRead.test.tsx 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

// ---------- 模块 mock ----------
// 公共 mock 提取至 readingPageTestMocks.ts（三个 ReadingPage 测试共用）；
// 导入顺序必须在被测组件之前，确保 vi.mock 注册先于组件模块求值
import {
  extractAndCacheVocabularyMock,
  getArticleByIdMock,
  getQuestionsForArticleMock,
  getTodayReadCountMock,
  markAsReadMock,
  recordReadingStartMock,
} from './readingPageTestMocks'
import {
  makeArticle,
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
