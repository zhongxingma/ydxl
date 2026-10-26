// RelatedArticlesSection 相关推荐区块单元测试
//
// 覆盖场景：
// 1. 空状态：文案与「去生成」跳转阅读页
// 2. 卡片：题材 / 体裁 / 难度标签渲染
// 3. 可选字段缺失：无题材时不显示题材标签与「同题材」，无难度时不显示难度徽章
// 4. 难度样式映射（hard）
// 5. 卡片点击回调携带文章 id

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Article } from '@/shared/types'
import RelatedArticlesSection from '../RelatedArticlesSection'

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
  return <div>{`阅读页${location.pathname}`}</div>
}

function renderSection(articles: Article[], onArticleClick = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <RelatedArticlesSection articles={articles} onArticleClick={onArticleClick} />
          }
        />
        <Route path="/reading" element={<ReadingProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RelatedArticlesSection', () => {
  it('空状态展示引导文案，「去生成」跳转阅读页', () => {
    renderSection([])

    expect(screen.getByRole('heading', { name: '相关推荐' })).toBeInTheDocument()
    expect(screen.getByText('暂无推荐，去生成新文章')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '去生成' }))

    expect(screen.getByText('阅读页/reading')).toBeInTheDocument()
  })

  it('卡片渲染题材、体裁与难度标签', () => {
    const article = makeArticle('a1', {
      title: 'Science Today',
      topic: 'science',
      genre: 'expository',
      difficulty: 'easy',
    })
    renderSection([article])

    expect(screen.getByRole('heading', { name: 'Science Today' })).toBeInTheDocument()
    expect(screen.getByText('科普')).toBeInTheDocument()
    expect(screen.getByText('说明文')).toBeInTheDocument()
    expect(screen.getByText('简单')).toBeInTheDocument()
    expect(screen.getByText('· 同题材')).toBeInTheDocument()
  })

  it('缺少题材与难度时仅显示体裁标签', () => {
    const article = makeArticle('a2', { genre: 'argumentative' })
    renderSection([article])

    expect(screen.getByText('议论文')).toBeInTheDocument()
    expect(screen.queryByText('· 同题材')).not.toBeInTheDocument()
    expect(screen.queryByText('简单')).not.toBeInTheDocument()
    expect(screen.queryByText('中等')).not.toBeInTheDocument()
    expect(screen.queryByText('困难')).not.toBeInTheDocument()
  })

  it('hard 难度显示困难徽章', () => {
    renderSection([makeArticle('a3', { topic: 'travel', difficulty: 'hard' })])

    expect(screen.getByText('旅行')).toBeInTheDocument()
    expect(screen.getByText('困难')).toBeInTheDocument()
  })

  it('点击卡片回调携带文章 id', () => {
    const onArticleClick = vi.fn()
    renderSection([makeArticle('a4', { title: 'Click Me' })], onArticleClick)

    fireEvent.click(screen.getByRole('button', { name: /Click Me/ }))

    expect(onArticleClick).toHaveBeenCalledWith('a4')
  })
})
