// 批量导入单词 Modal
//
// 覆盖关闭时不渲染、解析去重、无有效单词提示、删除预览项、导入成功自动关闭、
// 导入中状态与失败提示、Escape / 遮罩 / 按钮关闭及背景滚动锁定。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { wordbookService } from '@/features/wordbook/services/wordbookService'
import ImportWordsModal from '../ImportWordsModal'

vi.mock('@/features/wordbook/services/wordbookService', () => ({
  wordbookService: {
    bulkAddToWordbook: vi.fn(),
  },
}))

const bulkMock = vi.mocked(wordbookService.bulkAddToWordbook)

function inputText(value: string): HTMLTextAreaElement {
  const textarea = screen.getByPlaceholderText(/每行一个单词/) as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value } })
  return textarea
}

function parse(): void {
  fireEvent.click(screen.getByRole('button', { name: '解析并预览' }))
}

describe('ImportWordsModal 批量导入单词', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bulkMock.mockResolvedValue({ added: 2, failed: 1 })
    document.body.style.overflow = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.style.overflow = ''
  })

  it('open 为 false 时不渲染内容', () => {
    render(<ImportWordsModal open={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('打开时渲染表单、禁用空操作按钮并锁定背景滚动', () => {
    const { unmount } = render(<ImportWordsModal open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '批量导入单词' })).toBeInTheDocument()
    expect(screen.getByText('批量导入单词')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解析并预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '批量导入' })).toBeDisabled()
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('解析：提取英文单词、转小写去重并展示预览', () => {
    render(<ImportWordsModal open onClose={vi.fn()} />)

    inputText('Apple, banana! apple 中文 123')
    parse()

    expect(screen.getByText('共 2 个单词')).toBeInTheDocument()
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('banana')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量导入' })).toBeEnabled()
  })

  it('解析不到英文单词：展示错误且不展示预览', () => {
    render(<ImportWordsModal open onClose={vi.fn()} />)

    inputText('中文 123')
    parse()

    expect(screen.getByText('未识别到英文单词')).toBeInTheDocument()
    expect(screen.queryByText(/共 \d+ 个单词/)).not.toBeInTheDocument()
  })

  it('删除预览中的单个单词', () => {
    render(<ImportWordsModal open onClose={vi.fn()} />)

    inputText('apple banana')
    parse()
    fireEvent.click(screen.getByRole('button', { name: '删除 apple' }))

    expect(screen.getByText('共 1 个单词')).toBeInTheDocument()
    expect(screen.queryByText('apple')).not.toBeInTheDocument()
  })

  it('导入成功：展示结果并在 2 秒后自动关闭并重置', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<ImportWordsModal open onClose={onClose} />)

    const textarea = inputText('apple banana')
    parse()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    })

    expect(bulkMock).toHaveBeenCalledWith(['apple', 'banana'])
    expect(screen.getByText('成功 2 个，失败 1 个')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    // 关闭时已重置表单
    expect(textarea).toHaveValue('')
  })

  it('导入中：按钮显示导入中且重复点击只发起一次请求', async () => {
    let resolveImport!: (value: { added: number; failed: number }) => void
    bulkMock.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve
      }),
    )
    render(<ImportWordsModal open onClose={vi.fn()} />)

    inputText('apple')
    parse()

    fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    const pending = await screen.findByRole('button', { name: '导入中…' })
    expect(pending).toBeDisabled()

    fireEvent.click(pending)
    expect(bulkMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveImport({ added: 1, failed: 0 })
    })
    expect(screen.getByText('成功 1 个，失败 0 个')).toBeInTheDocument()
  })

  it('导入失败：告警并展示原始错误信息', async () => {
    bulkMock.mockRejectedValue(new Error('网络异常'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<ImportWordsModal open onClose={vi.fn()} />)

    inputText('apple')
    parse()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[ImportWordsModal] 批量导入失败',
      expect.any(Error),
    )
    expect(screen.getByText('网络异常')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量导入' })).toBeEnabled()
  })

  it('导入非 Error 失败：使用兜底文案', async () => {
    bulkMock.mockRejectedValue('oops')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<ImportWordsModal open onClose={vi.fn()} />)

    inputText('apple')
    parse()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    })

    expect(screen.getByText('导入失败，请重试')).toBeInTheDocument()
  })

  it('Escape 关闭并重置表单', () => {
    const onClose = vi.fn()
    render(<ImportWordsModal open onClose={onClose} />)

    const textarea = inputText('apple')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('')
  })

  it('点击遮罩关闭，点击弹窗主体不关闭', () => {
    const onClose = vi.fn()
    render(<ImportWordsModal open onClose={onClose} />)

    fireEvent.click(screen.getByText('批量导入单词'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog', { name: '批量导入单词' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭按钮与取消按钮均触发关闭', () => {
    const onClose = vi.fn()
    render(<ImportWordsModal open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
