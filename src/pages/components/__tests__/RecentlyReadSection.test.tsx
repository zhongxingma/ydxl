//
// 覆盖场景：
// 1. 空文章列表时不渲染区块
// 2. 渲染文章标题、题材/难度徽章、相对时间
// 3. 点击「查看全部」跳转 /history
// 4. 点击文章项跳转 /reading?articleId=xxx
// 5. hasMore 为 true 时显示「展开更多」按钮
// 6. hasMore 为 false 时不显示「展开更多」按钮
// 7. loading 为 true 时「展开更多」显示「加载中...」并禁用
// 8. 点击「展开更多」触发 onLoadMore 回调
//
// Mock 策略：使用 MemoryRouter + Routes 包裹组件，通过渲染目标路由断言跳转

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RecentlyReadSection from '../RecentlyReadSection'
import type { RecentlyReadArticle } from '@/features/reading/services/articleService'

// 构造测试用的 RecentlyReadArticle 数据
function makeArticle(overrides: Partial<RecentlyReadArticle> = {}): RecentlyReadArticle {
  return {
    id: 'test-id',
    title: '测试文章标题',
    readAt: Date.now() - 1000 * 60 * 30, // 30 分钟前
    topic: 'campus',
    difficulty: 'medium',
    wordCount: 250,
    ...overrides,
  }
}

// 将组件包裹在 MemoryRouter + Routes 中，便于测试跳转行为
function renderInSection(
  articles: RecentlyReadArticle[],
  opts: { onLoadMore?: () => void; loading?: boolean; hasMore?: boolean } = {},
): ReturnType<typeof render> {
  const { onLoadMore = () => {}, loading = false, hasMore = false } = opts
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <RecentlyReadSection
              articles={articles}
              onLoadMore={onLoadMore}
              loading={loading}
              hasMore={hasMore}
            />
          }
        />
        <Route path="/history" element={<div data-testid="history-page">历史页</div>} />
        <Route path="/reading" element={<div data-testid="reading-page">阅读页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RecentlyReadSection 组件', () => {
  // 1. 空文章列表时不渲染区块
  it('空文章列表时不渲染区块', () => {
    render(
      <MemoryRouter>
        <RecentlyReadSection
          articles={[]}
          onLoadMore={() => {}}
          loading={false}
          hasMore={false}
        />
      </MemoryRouter>,
    )
    // 标题不应出现在文档中
    expect(screen.queryByText('最近阅读')).not.toBeInTheDocument()
  })

  // 2. 渲染文章标题、题材/难度徽章、相对时间
  it('渲染文章标题、题材/难度徽章、相对时间', () => {
    const article = makeArticle({
      id: 'art-1',
      title: '校园生活的一天',
      topic: 'campus',
      difficulty: 'easy',
      readAt: Date.now() - 1000 * 60 * 60 * 2, // 2 小时前
    })
    renderInSection([article])
    // 标题渲染
    expect(screen.getByText('校园生活的一天')).toBeInTheDocument()
    // 题材徽章（campus → 校园生活）
    expect(screen.getByText('校园生活')).toBeInTheDocument()
    // 难度徽章（easy → 简单）
    expect(screen.getByText('简单')).toBeInTheDocument()
    // 相对时间（2 小时前）
    expect(screen.getByText('2 小时前')).toBeInTheDocument()
  })

  // 3. 点击「查看全部」跳转 /history
  it('点击「查看全部」跳转 /history', () => {
    renderInSection([makeArticle()])
    fireEvent.click(screen.getByText('查看全部 →'))
    // 验证跳转到 /history 页面
    expect(screen.getByTestId('history-page')).toBeInTheDocument()
  })

  // 4. 点击文章项跳转 /reading?articleId=xxx
  it('点击文章项跳转 /reading?articleId=xxx', () => {
    const article = makeArticle({ id: 'abc-123', title: '可点击的文章' })
    renderInSection([article])
    fireEvent.click(screen.getByText('可点击的文章'))
    // 验证跳转到 /reading 页面
    expect(screen.getByTestId('reading-page')).toBeInTheDocument()
  })

  // 5. hasMore 为 true 时显示「展开更多」按钮
  it('hasMore 为 true 时显示「展开更多」按钮', () => {
    renderInSection([makeArticle()], { hasMore: true })
    expect(screen.getByText('展开更多')).toBeInTheDocument()
  })

  // 6. hasMore 为 false 时不显示「展开更多」按钮
  it('hasMore 为 false 时不显示「展开更多」按钮', () => {
    renderInSection([makeArticle()], { hasMore: false })
    expect(screen.queryByText('展开更多')).not.toBeInTheDocument()
  })

  // 7. loading 为 true 时「展开更多」显示「加载中...」并禁用
  it('loading 为 true 时「展开更多」显示「加载中...」并禁用', () => {
    renderInSection([makeArticle()], { loading: true, hasMore: true })
    const btn = screen.getByText('加载中...')
    expect(btn).toBeInTheDocument()
    expect(btn).toBeDisabled()
  })

  // 8. 点击「展开更多」触发 onLoadMore 回调
  it('点击「展开更多」触发 onLoadMore 回调', () => {
    const onLoadMore = vi.fn()
    renderInSection([makeArticle()], { onLoadMore, hasMore: true })
    fireEvent.click(screen.getByText('展开更多'))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
