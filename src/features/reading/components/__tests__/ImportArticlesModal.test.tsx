// 批量导入文章 Modal
//
// 覆盖关闭时不渲染、按 --- 解析与正文长度过滤、删除预览、全部/部分导入结果、
// 导入中状态、Escape / 遮罩 / 按钮关闭及背景滚动锁定。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Article } from '@/shared/types'
import { articleService } from '@/features/reading/services/articleService'
import ImportArticlesModal from '../ImportArticlesModal'

vi.mock('@/features/reading/services/articleService', () => ({
  articleService: {
    saveArticle: vi.fn(),
  },
}))

const saveMock = vi.mocked(articleService.saveArticle)

// 第一、三篇正文 ≥ 50 字符，第二篇过短被过滤
const VALID_TEXT = [
  'My First Day',
  'I was nervous on my first day of school, but everyone was friendly and kind to me.',
  '---',
  'Too Short',
  'Only a few words.',
  '---',
  'Another Article',
  'This is another article body that contains more than fifty characters in total.',
].join('\n')

const FIRST_TITLE = 'My First Day'
const SECOND_TITLE = 'Another Article'

function inputText(value: string): HTMLTextAreaElement {
  const textarea = screen.getByPlaceholderText(/每篇文章用 --- 分隔/) as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value } })
  return textarea
}

function parse(): void {
  fireEvent.click(screen.getByRole('button', { name: '解析并预览' }))
}

describe('ImportArticlesModal 批量导入文章', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveMock.mockImplementation(async (article: Article) => article)
    document.body.style.overflow = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.style.overflow = ''
  })

  it('open 为 false 时不渲染内容', () => {
    render(<ImportArticlesModal open={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('打开时渲染表单、禁用空操作按钮并锁定背景滚动', () => {
    const { unmount } = render(<ImportArticlesModal open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '批量导入文章' })).toBeInTheDocument()
    expect(screen.getByText('批量导入文章')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解析并预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '批量导入' })).toBeDisabled()
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('解析：按 --- 分隔并过滤正文过短的块', () => {
    render(<ImportArticlesModal open onClose={vi.fn()} />)

    inputText(VALID_TEXT)
    parse()

    expect(screen.getByText('共 2 篇文章')).toBeInTheDocument()
    expect(screen.getByText(FIRST_TITLE)).toBeInTheDocument()
    expect(screen.getByText(SECOND_TITLE)).toBeInTheDocument()
    expect(screen.queryByText('Too Short')).not.toBeInTheDocument()
    // 词数 = 正文按空白切分后的数量
    expect(screen.getByText('17 词')).toBeInTheDocument()
    expect(screen.getByText('13 词')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量导入' })).toBeEnabled()
  })

  it('解析不到有效文章：展示错误且不展示预览', () => {
    render(<ImportArticlesModal open onClose={vi.fn()} />)

    inputText('Only A Title\nshort')
    parse()

    expect(
      screen.getByText('未解析到有效文章（每篇需标题 + 至少 50 字符正文）'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/共 \d+ 篇文章/)).not.toBeInTheDocument()
  })

  it('删除预览中的单篇文章', () => {
    render(<ImportArticlesModal open onClose={vi.fn()} />)

    inputText(VALID_TEXT)
    parse()
    fireEvent.click(screen.getByRole('button', { name: `删除 ${FIRST_TITLE}` }))

    expect(screen.getByText('共 1 篇文章')).toBeInTheDocument()
    expect(screen.queryByText(FIRST_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText(SECOND_TITLE)).toBeInTheDocument()
  })

  it('全部导入成功：展示结果、保存实体字段正确并在 2 秒后关闭', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<ImportArticlesModal open onClose={onClose} />)

    const textarea = inputText(VALID_TEXT)
    parse()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    })

    expect(saveMock).toHaveBeenCalledTimes(2)
    const saved = saveMock.mock.calls.map(([article]) => article)
    expect(saved[0]).toMatchObject({
      title: FIRST_TITLE,
      translation: '',
      genre: 'narrative',
      topic: 'campus',
      difficulty: 'medium',
      highlightedWords: [],
      readAt: null,
      startedAt: null,
    })
    expect(saved[0].id).toMatch(/^user-\d+-0$/)
    expect(saved[1].id).toMatch(/^user-\d+-1$/)
    expect(saved[0].content.length).toBeGreaterThanOrEqual(50)
    expect(screen.getByText('成功 2 篇，失败 0 篇')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('')
  })

  it('部分失败：按 allSettled 统计成功与失败数', async () => {
    saveMock
      .mockImplementationOnce(async (article: Article) => article)
      .mockRejectedValueOnce(new Error('save failed'))
    render(<ImportArticlesModal open onClose={vi.fn()} />)

    inputText(VALID_TEXT)
    parse()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    })

    expect(screen.getByText('成功 1 篇，失败 1 篇')).toBeInTheDocument()
    expect(screen.queryByText('save failed')).not.toBeInTheDocument()
  })

  it('全部失败：仍展示 0 篇成功，不抛错', async () => {
    saveMock.mockRejectedValue(new Error('save failed'))
    render(<ImportArticlesModal open onClose={vi.fn()} />)

    inputText(VALID_TEXT)
    parse()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    })

    expect(screen.getByText('成功 0 篇，失败 2 篇')).toBeInTheDocument()
  })

  it('导入中：按钮显示导入中且重复点击只发起一次请求', async () => {
    let resolveSave!: (value: Article) => void
    saveMock.mockReturnValue(
      new Promise<Article>((resolve) => {
        resolveSave = resolve
      }),
    )
    render(<ImportArticlesModal open onClose={vi.fn()} />)

    inputText(VALID_TEXT)
    parse()
    fireEvent.click(screen.getByRole('button', { name: '批量导入' }))

    const pending = await screen.findByRole('button', { name: '导入中…' })
    expect(pending).toBeDisabled()
    fireEvent.click(pending)
    expect(saveMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSave({} as Article)
    })
  })

  it('Escape 关闭并重置表单', () => {
    const onClose = vi.fn()
    render(<ImportArticlesModal open onClose={onClose} />)

    const textarea = inputText(VALID_TEXT)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('')
  })

  it('点击遮罩关闭，点击弹窗主体不关闭', () => {
    const onClose = vi.fn()
    render(<ImportArticlesModal open onClose={onClose} />)

    fireEvent.click(screen.getByText('批量导入文章'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog', { name: '批量导入文章' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭按钮与取消按钮均触发关闭', () => {
    const onClose = vi.fn()
    render(<ImportArticlesModal open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
