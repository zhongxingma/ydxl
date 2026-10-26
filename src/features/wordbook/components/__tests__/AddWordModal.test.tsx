// 添加单词 Modal
//
// 覆盖关闭时不渲染、AI 补全成功 / 部分字段 / 失败 / 并发守卫、
// 保存成功与失败、参数校验、Escape 与遮罩关闭及背景滚动锁定。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { wordbookService } from '@/features/wordbook/services/wordbookService'
import AddWordModal from '../AddWordModal'

vi.mock('@/features/wordbook/services/wordbookService', () => ({
  wordbookService: {
    addToWordbook: vi.fn(),
    enrichWord: vi.fn(),
  },
}))

const addMock = vi.mocked(wordbookService.addToWordbook)
const enrichMock = vi.mocked(wordbookService.enrichWord)

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'apple',
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple.',
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

function typeWord(value: string): HTMLInputElement {
  const input = screen.getByPlaceholderText('请输入英文单词') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
  return input
}

describe('AddWordModal 添加单词', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addMock.mockResolvedValue(makeWord())
    enrichMock.mockResolvedValue(makeWord())
    document.body.style.overflow = ''
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('open 为 false 时不渲染内容', () => {
    render(<AddWordModal open={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('打开时渲染表单、禁用空操作按钮并锁定背景滚动', () => {
    const { unmount } = render(<AddWordModal open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '添加单词' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('请输入英文单词')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('如 /əˈpleɪ/')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('中文释义')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('包含该词的例句')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 补全' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('AI 补全成功：保存基础记录并把返回字段填入表单', async () => {
    render(<AddWordModal open onClose={vi.fn()} />)

    typeWord('Apple')
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全' }))

    expect(addMock).toHaveBeenCalledWith({ word: 'Apple', enrichIfMissing: true })
    expect(await screen.findByDisplayValue('/ˈæpl/')).toBeInTheDocument()
    expect(enrichMock).toHaveBeenCalledWith('apple')
    expect(screen.getByDisplayValue('n.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('苹果')).toBeInTheDocument()
    expect(screen.getByDisplayValue('I ate an apple.')).toBeInTheDocument()
  })

  it('AI 补全仅返回部分字段：其余手工输入保持不变', async () => {
    enrichMock.mockResolvedValue(
      makeWord({ phonetic: '/bəˈnɑːnə/', pos: '', definition: '', example: '' }),
    )
    render(<AddWordModal open onClose={vi.fn()} />)

    typeWord('banana')
    fireEvent.change(screen.getByPlaceholderText('中文释义'), {
      target: { value: '手动释义' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全' }))

    expect(await screen.findByDisplayValue('/bəˈnɑːnə/')).toBeInTheDocument()
    expect(screen.getByDisplayValue('手动释义')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('如 /əˈpleɪ/')).toHaveValue('/bəˈnɑːnə/')
  })

  it('AI 补全失败：告警并展示错误，非 Error 使用兜底文案', async () => {
    addMock.mockRejectedValue(new Error('AI 服务不可用'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<AddWordModal open onClose={vi.fn()} />)

    typeWord('apple')
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全' }))

    expect(await screen.findByText('AI 服务不可用')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith(
      '[AddWordModal] AI 补全失败',
      expect.any(Error),
    )

    addMock.mockRejectedValue('oops')
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全' }))
    expect(await screen.findByText('AI 补全失败，可手动填写')).toBeInTheDocument()
  })

  it('AI 补全中：按钮禁用且重复点击只发起一次请求', async () => {
    let resolveEnrich!: (value: Word) => void
    enrichMock.mockReturnValue(
      new Promise<Word>((resolve) => {
        resolveEnrich = resolve
      }),
    )
    render(<AddWordModal open onClose={vi.fn()} />)

    typeWord('apple')
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全' }))

    const pending = await screen.findByRole('button', { name: 'AI 补全中…' })
    expect(pending).toBeDisabled()
    fireEvent.click(pending)
    expect(addMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveEnrich(makeWord())
    })
  })

  it('保存成功：提交全部字段、关闭并重置表单', async () => {
    const onClose = vi.fn()
    render(<AddWordModal open onClose={onClose} />)

    typeWord('  apple  ')
    fireEvent.change(screen.getByPlaceholderText('如 /əˈpleɪ/'), {
      target: { value: ' /ˈæpl/ ' },
    })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'n.' } })
    fireEvent.change(screen.getByPlaceholderText('中文释义'), {
      target: { value: ' 苹果 ' },
    })
    fireEvent.change(screen.getByPlaceholderText('包含该词的例句'), {
      target: { value: ' I ate an apple. ' },
    })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(addMock).toHaveBeenCalledWith({
      word: 'apple',
      phonetic: '/ˈæpl/',
      pos: 'n.',
      definition: '苹果',
      example: 'I ate an apple.',
      enrichIfMissing: true,
    })
    // 关闭时已重置表单
    expect(screen.getByPlaceholderText('请输入英文单词')).toHaveValue('')
  })

  it('保存失败：告警并展示错误，非 Error 使用兜底文案', async () => {
    addMock.mockRejectedValue(new Error('数据库写入失败'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<AddWordModal open onClose={vi.fn()} />)

    typeWord('apple')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('数据库写入失败')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith(
      '[AddWordModal] 保存失败',
      expect.any(Error),
    )

    addMock.mockRejectedValue('oops')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument()
  })

  it('保存中：按钮禁用且重复点击只发起一次请求', async () => {
    let resolveAdd!: (value: Word) => void
    addMock.mockReturnValue(
      new Promise<Word>((resolve) => {
        resolveAdd = resolve
      }),
    )
    render(<AddWordModal open onClose={vi.fn()} />)

    typeWord('apple')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const pending = await screen.findByRole('button', { name: '保存中…' })
    expect(pending).toBeDisabled()
    fireEvent.click(pending)
    expect(addMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAdd(makeWord())
    })
  })

  it('Escape 关闭并重置表单', () => {
    const onClose = vi.fn()
    render(<AddWordModal open onClose={onClose} />)

    const input = typeWord('apple')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
  })

  it('点击遮罩关闭，点击弹窗主体不关闭', () => {
    const onClose = vi.fn()
    render(<AddWordModal open onClose={onClose} />)

    fireEvent.click(screen.getByText('添加单词'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog', { name: '添加单词' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭按钮与取消按钮均触发关闭', () => {
    const onClose = vi.fn()
    render(<AddWordModal open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
