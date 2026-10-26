// WordbookActionMenu 生词长按操作菜单单元测试
//
// 覆盖场景：
// 1. 对话框语义、单词标题与三个操作项渲染
// 2. 立即复习 / 删除 / 取消回调
// 3. 点击遮罩关闭，点击菜单内容不关闭
// 4. Escape 关闭
// 5. 打开时锁定背景滚动，卸载时恢复
//
// 环境依赖：使用真实 useEscapeKey；body overflow 在用例后复位。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Word } from '@/shared/types'
import WordbookActionMenu from '../WordbookActionMenu'

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'apple',
    updated_at: now,
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    ...overrides,
  }
}

function renderMenu() {
  const onReview = vi.fn()
  const onDelete = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <WordbookActionMenu
      word={makeWord()}
      onReview={onReview}
      onDelete={onDelete}
      onClose={onClose}
    />
  )
  return { ...view, onReview, onDelete, onClose }
}

describe('WordbookActionMenu 生词操作菜单', () => {
  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('展示对话框语义、单词与操作项', () => {
    renderMenu()

    const dialog = screen.getByRole('dialog', { name: 'apple 操作菜单' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('操作')).toBeInTheDocument()
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即复习' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('点击立即复习与删除触发对应回调', () => {
    const { onReview, onDelete } = renderMenu()

    fireEvent.click(screen.getByRole('button', { name: '立即复习' }))
    expect(onReview).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('点击取消与遮罩关闭菜单，点击内容不关闭', () => {
    const { onClose } = renderMenu()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByText('操作'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('按 Escape 关闭菜单', () => {
    const { onClose } = renderMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('打开时锁定背景滚动，卸载后恢复', () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = renderMenu()

    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
