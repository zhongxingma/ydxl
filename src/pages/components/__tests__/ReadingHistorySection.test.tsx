// ReadingHistorySection 历史阅读区块单元测试
//
// 覆盖场景：
// 1. 空状态展示与「开始阅读」跳转
// 2. 文章卡片：体裁图标、已读完 / 阅读中徽章、相对时间六档文案与日期兜底
// 3. 卡片点击跳转带 articleId 的阅读页
// 4. 「查看更多」按 hasMore / loading 展示与禁用
//
// 环境依赖：相对时间依赖 Date.now，使用 spy 固定当前时间
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Article } from '@/shared/types'
import ReadingHistorySection from '../ReadingHistorySection'

function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  const now = Date.now()
  return {
    id,
    title: `Title ${id}`,
    content: 'content',
    translation: '译文',
    genre: 'narrative',
    wordCount: 50,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

function ReadingProbe() {
  const location = useLocation()
  return <div>{`阅读页${location.search}`}</div>
}

function renderSection(articles: Article[], hasMore = false, loading = false) {
  const onLoadMore = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <ReadingHistorySection
              articles={articles}
              onLoadMore={onLoadMore}
              loading={loading}
              hasMore={hasMore}
            />
          }
        />
        <Route path="/reading" element={<ReadingProbe />} />
      </Routes>
    </MemoryRouter>
  )
  return { ...view, onLoadMore }
}

describe('ReadingHistorySection 历史阅读区块', () => {
  const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime()

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无阅读记录时展示空状态，「开始阅读」跳转阅读页', () => {
    renderSection([])

    expect(screen.getByRole('heading', { name: '历史阅读' })).toBeInTheDocument()
    expect(screen.getByText('追踪你读过的每一篇文章')).toBeInTheDocument()
    expect(
      screen.getByText('暂无阅读记录，开始你的第一篇阅读吧')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开始阅读' }))

    expect(screen.getByText('阅读页')).toBeInTheDocument()
  })

  it('已读完文章展示标题、体裁图标、已读完徽章与相对时间', () => {
    renderSection([
      makeArticle('a1', { title: 'A Brave Boy', genre: 'narrative', readAt: NOW - 30_000 }),
      makeArticle('a2', { title: 'Science Today', genre: 'expository', readAt: NOW - 5 * 60_000 }),
      makeArticle('a3', { title: 'How To Cook', genre: 'practical', readAt: NOW - 3 * 3_600_000 }),
      makeArticle('a4', { title: 'Why Debate', genre: 'argumentative', readAt: NOW - 30 * 3_600_000 }),
      makeArticle('a5', { title: 'Three Days', readAt: NOW - 3 * 86_400_000 }),
      makeArticle('a6', {
        title: 'Long Ago',
        readAt: new Date(2026, 7, 1, 8, 0, 0).getTime(),
      }),
    ])

    expect(screen.getByText('A Brave Boy')).toBeInTheDocument()
    expect(screen.getByText('Science Today')).toBeInTheDocument()
    expect(screen.getAllByText('已读完')).toHaveLength(6)
    expect(screen.getByText('刚刚')).toBeInTheDocument()
    expect(screen.getByText('5 分钟前')).toBeInTheDocument()
    expect(screen.getByText('3 小时前')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('3 天前')).toBeInTheDocument()
    expect(screen.getByText('2026-08-01')).toBeInTheDocument()

    expect(screen.getAllByText('📖')).toHaveLength(3)
    expect(screen.getByText('🔬')).toBeInTheDocument()
    expect(screen.getByText('📝')).toBeInTheDocument()
    expect(screen.getByText('🎯')).toBeInTheDocument()
  })

  it('阅读中与未开始的文章分别展示阅读中徽章与创建时间', () => {
    renderSection([
      makeArticle('b1', {
        title: 'Reading Now',
        readAt: null,
        startedAt: NOW - 2 * 3_600_000,
      }),
      makeArticle('b2', {
        title: 'Never Started',
        readAt: null,
        startedAt: null,
        createdAt: new Date(2026, 8, 10, 9, 0, 0).getTime(),
      }),
      makeArticle('b3', {
        title: 'Unknown Genre',
        genre: 'unknown' as Article['genre'],
        readAt: null,
        startedAt: NOW - 10_000,
      }),
    ])

    expect(screen.getAllByText('阅读中')).toHaveLength(2)
    expect(screen.getByText('2 小时前')).toBeInTheDocument()
    expect(screen.getByText('2026-09-10')).toBeInTheDocument()
    expect(screen.queryByText('已读完')).not.toBeInTheDocument()
    expect(screen.getByText('📄')).toBeInTheDocument()
    expect(screen.getByText('刚刚')).toBeInTheDocument()
  })

  it('点击文章卡片跳转带 articleId 的阅读页', () => {
    renderSection([makeArticle('2026-10-26', { title: 'Click Me', readAt: NOW })])

    fireEvent.click(screen.getByRole('button', { name: /Click Me/ }))

    expect(screen.getByText('阅读页?articleId=2026-10-26')).toBeInTheDocument()
  })

  it('hasMore 为 true 时展示查看更多并可触发加载', () => {
    const { onLoadMore } = renderSection([makeArticle('a1')], true, false)

    const button = screen.getByRole('button', { name: '查看更多' })
    expect(button).toBeEnabled()

    fireEvent.click(button)

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('加载中时查看更多禁用并显示加载文案', () => {
    renderSection([makeArticle('a1')], true, true)

    expect(screen.getByRole('button', { name: '加载中...' })).toBeDisabled()
  })

  it('hasMore 为 false 时不展示查看更多', () => {
    renderSection([makeArticle('a1')], false, false)

    expect(screen.queryByRole('button', { name: /查看更多|加载中/ })).not.toBeInTheDocument()
  })
})
