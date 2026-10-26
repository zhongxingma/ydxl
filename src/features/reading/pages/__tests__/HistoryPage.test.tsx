//
// 覆盖场景：
// 1. 渲染页面标题与描述
// 2. 无阅读记录时显示空状态引导
// 3. 有阅读记录时渲染文章列表（标题、题材/难度徽章、词数、相对时间）
// 4. 点击文章项跳转 /reading?articleId=xxx
// 5. 有更多数据时显示「加载更多」按钮
// 6. 点击「加载更多」触发 getReadHistory 追加加载
// 7. 查询失败时不崩溃（best-effort）
//
// Mock 策略：mock articleService.getReadHistory，使用 MemoryRouter 包裹组件

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Article } from '@/shared/types'
import { cacheEvents } from '@/shared/services/cacheEvents'

// Mock articleService.getReadHistory
const getReadHistoryMock = vi.fn()
vi.mock('../../services/articleService', () => ({
  articleService: {
    getReadHistory: (...args: unknown[]) => getReadHistoryMock(...args),
  },
}))

// 在 mock 之后导入组件
import HistoryPage from '../HistoryPage'

// 构造测试用的 Article 数据
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'test-id',
    title: '测试文章标题',
    content: '内容',
    translation: '翻译',
    genre: 'narrative',
    wordCount: 250,
    createdAt: Date.now() - 1000 * 60 * 60,
    updated_at: Date.now(),
    topic: 'campus',
    difficulty: 'medium',
    readAt: Date.now() - 1000 * 60 * 30, // 30 分钟前
    ...overrides,
  }
}

// 将 HistoryPage 包裹在 MemoryRouter + Routes 中，便于测试跳转
function renderHistoryPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/reading" element={<div data-testid="reading-page">阅读页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HistoryPage 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 1. 渲染页面标题与描述
  it('渲染页面标题与描述', async () => {
    getReadHistoryMock.mockResolvedValue([])
    renderHistoryPage()
    expect(screen.getByText('阅读历史')).toBeInTheDocument()
    expect(screen.getByText('追踪你读过的每一篇文章')).toBeInTheDocument()
    // 等待加载完成
    await waitFor(() => {
      expect(getReadHistoryMock).toHaveBeenCalledTimes(1)
    })
  })

  // 2. 无阅读记录时显示空状态引导
  it('无阅读记录时显示空状态引导', async () => {
    getReadHistoryMock.mockResolvedValue([])
    renderHistoryPage()
    // 等待加载完成，空状态显示
    await waitFor(() => {
      expect(screen.getByText('暂无阅读记录，开始你的第一篇阅读吧')).toBeInTheDocument()
    })
  })

  // 3. 有阅读记录时渲染文章列表
  it('有阅读记录时渲染文章列表（标题、徽章、词数、相对时间）', async () => {
    const articles = [
      makeArticle({
        id: 'art-1',
        title: '校园生活的一天',
        topic: 'campus',
        difficulty: 'easy',
        wordCount: 200,
        readAt: Date.now() - 1000 * 60 * 60 * 2, // 2 小时前
      }),
      makeArticle({
        id: 'art-2',
        title: '科技前沿探索',
        topic: 'technology',
        difficulty: 'hard',
        wordCount: 300,
        readAt: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 天前
      }),
    ]
    getReadHistoryMock.mockResolvedValue(articles)
    renderHistoryPage()

    // 等待列表渲染
    await waitFor(() => {
      expect(screen.getByText('校园生活的一天')).toBeInTheDocument()
    })
    expect(screen.getByText('科技前沿探索')).toBeInTheDocument()
    // 题材徽章
    expect(screen.getByText('校园生活')).toBeInTheDocument()
    expect(screen.getByText('科技前沿')).toBeInTheDocument()
    // 难度徽章
    expect(screen.getByText('简单')).toBeInTheDocument()
    expect(screen.getByText('困难')).toBeInTheDocument()
    // 词数
    expect(screen.getByText('200 词')).toBeInTheDocument()
    expect(screen.getByText('300 词')).toBeInTheDocument()
    // 相对时间
    expect(screen.getByText('2 小时前')).toBeInTheDocument()
    expect(screen.getByText('3 天前')).toBeInTheDocument()
  })

  // 4. 点击文章项跳转 /reading?articleId=xxx
  it('点击文章项跳转 /reading?articleId=xxx', async () => {
    getReadHistoryMock.mockResolvedValue([
      makeArticle({ id: 'clickable-1', title: '可点击的历史文章' }),
    ])
    renderHistoryPage()
    await waitFor(() => {
      expect(screen.getByText('可点击的历史文章')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('可点击的历史文章'))
    // 验证跳转到 /reading 页面
    expect(screen.getByTestId('reading-page')).toBeInTheDocument()
  })

  // 5. 有更多数据时显示「加载更多」按钮
  it('返回数量等于页大小时显示「加载更多」按钮', async () => {
    // 返回 10 条（等于 HISTORY_PAGE_SIZE），认为可能还有更多
    const articles = Array.from({ length: 10 }, (_, i) =>
      makeArticle({ id: `art-${i}`, title: `文章 ${i}`, readAt: Date.now() - i * 1000 }),
    )
    getReadHistoryMock.mockResolvedValue(articles)
    renderHistoryPage()
    await waitFor(() => {
      expect(screen.getByText('加载更多')).toBeInTheDocument()
    })
  })

  // 6. 点击「加载更多」触发 getReadHistory 追加加载
  it('点击「加载更多」追加加载下一页', async () => {
    // 第一页：10 条
    const firstPage = Array.from({ length: 10 }, (_, i) =>
      makeArticle({ id: `first-${i}`, title: `第一页文章 ${i}`, readAt: Date.now() - i * 1000 }),
    )
    // 第二页：3 条（不足页大小，无更多）
    const secondPage = Array.from({ length: 3 }, (_, i) =>
      makeArticle({ id: `second-${i}`, title: `第二页文章 ${i}`, readAt: Date.now() - (10 + i) * 1000 }),
    )
    getReadHistoryMock
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
    renderHistoryPage()

    // 等待第一页加载
    await waitFor(() => {
      expect(screen.getByText('加载更多')).toBeInTheDocument()
    })
    // 验证第一次调用参数：limit=10, offset=0
    expect(getReadHistoryMock).toHaveBeenNthCalledWith(1, 10, 0)

    // 点击加载更多
    fireEvent.click(screen.getByText('加载更多'))
    // 等待第二页加载
    await waitFor(() => {
      expect(screen.getByText('第二页文章 0')).toBeInTheDocument()
    })
    // 验证第二次调用参数：limit=10, offset=10
    expect(getReadHistoryMock).toHaveBeenNthCalledWith(2, 10, 10)
    // 第二页不足页大小，不再显示「加载更多」
    expect(screen.queryByText('加载更多')).not.toBeInTheDocument()
  })

  // 7. 查询失败时不崩溃（best-effort）
  it('查询失败时显示空状态，不崩溃', async () => {
    getReadHistoryMock.mockRejectedValue(new Error('网络错误'))
    // 抑制 console.warn 输出
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHistoryPage()
    await waitFor(() => {
      expect(screen.getByText('暂无阅读记录，开始你的第一篇阅读吧')).toBeInTheDocument()
    })
    warnSpy.mockRestore()
  })

  // 8. 超过 7 天显示日期
  it('相对时间超过 7 天时显示 YYYY-MM-DD', async () => {
    getReadHistoryMock.mockResolvedValue([
      makeArticle({
        id: 'old-article',
        title: '很久以前读的文章',
        readAt: new Date('2020-01-02T08:00:00').getTime(),
      }),
    ])
    renderHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('很久以前读的文章')).toBeInTheDocument()
    })
    expect(screen.getByText('2020-01-02')).toBeInTheDocument()
  })

  // 9. 空状态「开始阅读」跳转阅读页
  it('空状态点击「开始阅读」跳转阅读页', async () => {
    getReadHistoryMock.mockResolvedValue([])
    renderHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('开始阅读')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('开始阅读'))

    expect(screen.getByTestId('reading-page')).toBeInTheDocument()
  })

  // 10. 加载更多失败时中断分页并隐藏按钮
  it('加载更多失败时停止分页且不崩溃', async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) =>
      makeArticle({ id: `first-${i}`, title: `第一页文章 ${i}` }),
    )
    getReadHistoryMock
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('网络错误'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('加载更多')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('加载更多'))

    await waitFor(() => {
      expect(screen.queryByText('加载更多')).not.toBeInTheDocument()
    })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // 11. articles 缓存失效后按当前已加载数量重载（保持分页位置）
  it('articles 缓存失效事件触发重载并保持已加载数量', async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) =>
      makeArticle({ id: `first-${i}`, title: `第一页文章 ${i}` }),
    )
    const secondPage = Array.from({ length: 3 }, (_, i) =>
      makeArticle({ id: `second-${i}`, title: `第二页文章 ${i}` }),
    )
    getReadHistoryMock
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([...firstPage, ...secondPage])
    renderHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('加载更多')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('加载更多'))
    await waitFor(() => {
      expect(screen.getByText('第二页文章 0')).toBeInTheDocument()
    })

    await act(async () => {
      cacheEvents.emit('articles')
    })

    await waitFor(() => {
      expect(getReadHistoryMock).toHaveBeenNthCalledWith(3, 13, 0)
    })
  })
})
