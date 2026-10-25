// WordbookPage 冒烟测试（重构护栏）
//
// 覆盖场景：
// 1. 有生词时渲染卡片网格
// 2. 无生词且统计为 0 时展示空状态引导
// 3. 过滤结果为 0 但统计总数 > 0 时展示「全部已掌握」
//
// Mock 策略：仅 mock 生词服务层，使用 MemoryRouter 提供 Link 上下文。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Word } from '@/shared/types'

const mocks = vi.hoisted(() => ({
  getWordbook: vi.fn(),
  getWordbookStats: vi.fn(),
}))

vi.mock('../../services/wordbookService', () => ({
  getWordbook: (...args: unknown[]) => mocks.getWordbook(...args),
  getWordbookStats: (...args: unknown[]) => mocks.getWordbookStats(...args),
  removeFromWordbook: vi.fn(),
  bulkRemove: vi.fn(),
  addToWordbook: vi.fn(),
  updateNote: vi.fn(),
  bulkAddToWordbook: vi.fn(),
  enrichWord: vi.fn(),
  toggleFavorite: vi.fn(),
  wordbookService: {
    addToWordbook: vi.fn(),
    updateNote: vi.fn(),
    bulkAddToWordbook: vi.fn(),
    enrichWord: vi.fn(),
    toggleFavorite: vi.fn(),
  },
}))

import WordbookPage from '../WordbookPage'

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'apple',
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple.',
    mastery: 0,
    nextReview: Date.now() + 86_400_000,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function renderWordbook() {
  return render(
    <MemoryRouter initialEntries={['/wordbook']}>
      <WordbookPage />
    </MemoryRouter>,
  )
}

describe('WordbookPage 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWordbookStats.mockResolvedValue({ total: 1, mastered: 0, pendingReview: 1 })
  })

  it('有生词时渲染卡片网格', async () => {
    mocks.getWordbook.mockResolvedValue({
      items: [makeWord()],
      total: 1,
      limit: 20,
      offset: 0,
    })
    renderWordbook()

    expect(await screen.findByText('apple')).toBeInTheDocument()
    expect(screen.getByText('苹果')).toBeInTheDocument()
  })

  it('无生词时展示空状态引导', async () => {
    mocks.getWordbookStats.mockResolvedValue({ total: 0, mastered: 0, pendingReview: 0 })
    mocks.getWordbook.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    renderWordbook()

    expect(await screen.findByText('还没有生词，去阅读文章并收藏生词吧！')).toBeInTheDocument()
  })

  it('过滤结果为 0 但统计有总数时展示全部已掌握', async () => {
    mocks.getWordbookStats.mockResolvedValue({ total: 3, mastered: 3, pendingReview: 0 })
    mocks.getWordbook.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    renderWordbook()

    expect(await screen.findByText('生词本已清空，所有单词已掌握 🎉')).toBeInTheDocument()
  })
})
