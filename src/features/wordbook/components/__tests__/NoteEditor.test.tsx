// NoteEditor 笔记编辑弹窗单元测试
//
// 覆盖场景：
// 1. word 为 null 时不渲染
// 2. 打开时回填现有笔记并自动聚焦
// 3. 编辑后保存调用 updateNote，成功回调与关闭
// 4. 保存中按钮禁用、文案切换与防重复
// 5. 保存失败告警并恢复可编辑状态
// 6. 取消 / 遮罩 / Escape 关闭，内容点击不关闭
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import NoteEditor from '../NoteEditor'
import { wordbookService } from '../../services/wordbookService'

vi.mock('../../services/wordbookService', () => ({
  wordbookService: {
    updateNote: vi.fn(),
  },
}))

const updateNoteMock = vi.mocked(wordbookService.updateNote)

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

describe('NoteEditor 笔记编辑弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateNoteMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('word 为 null 时不渲染任何内容', () => {
    const { container } = render(
      <NoteEditor word={null} onClose={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('打开时回填现有笔记并自动聚焦输入框', () => {
    render(
      <NoteEditor word={makeWord({ note: '旧笔记' })} onClose={vi.fn()} />
    )

    const dialog = screen.getByRole('dialog', { name: '编辑笔记' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('apple')).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText(/为这个单词添加笔记/)
    expect(textarea).toHaveValue('旧笔记')
    expect(document.activeElement).toBe(textarea)
  })

  it('编辑后保存调用 updateNote 并触发成功回调与关闭', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(
      <NoteEditor word={makeWord()} onClose={onClose} onSaved={onSaved} />
    )

    fireEvent.change(screen.getByPlaceholderText(/为这个单词添加笔记/), {
      target: { value: '新笔记' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    expect(updateNoteMock).toHaveBeenCalledWith('apple', '新笔记')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('保存中按钮禁用并展示进行中文案，防重复提交', async () => {
    let resolveSave: (() => void) | undefined
    updateNoteMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    render(<NoteEditor word={makeWord()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const savingButton = screen.getByRole('button', { name: '保存中…' })
    expect(savingButton).toBeDisabled()

    fireEvent.click(savingButton)
    expect(updateNoteMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave?.()
    })
  })

  it('保存失败时告警并恢复可保存状态，弹窗保持打开', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onClose = vi.fn()
    updateNoteMock.mockRejectedValue(new Error('网络错误'))
    render(<NoteEditor word={makeWord()} onClose={onClose} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('笔记保存失败'),
      expect.any(Error)
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    warn.mockRestore()
  })

  it('点击取消、遮罩或按 Escape 关闭，点击内容不关闭', () => {
    const onClose = vi.fn()
    render(<NoteEditor word={makeWord()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByText('编辑笔记'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
