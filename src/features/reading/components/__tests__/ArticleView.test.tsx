// ArticleView 文章阅读视图单元测试
//
// 覆盖场景：
// 1. 四种翻译模式分发（english / paragraph / sentence / toggle）
// 2. scrollTarget 滚动定位、闪烁高亮与定时清理
// 3. 查词浮层与 toast 条件渲染
// 4. 选词事件挂载与翻译缺失防御
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Article } from '@/shared/types'
import type { TranslationMode } from '../../types'
import ArticleView from '../ArticleView'
import { useWordLookup } from '../../hooks/useWordLookup'

interface LookupResult {
  containerRef: { current: HTMLDivElement | null }
  popoverRef: { current: HTMLDivElement | null }
  popover: { kind: string } | null
  toast: string | null
  highlightedWords: Array<{ word: string }>
  handleMouseUp: () => void
  handleTouchEnd: () => void
  handleHighlightedWordClick: () => void
  closePopover: () => void
  handleAddLookupToWordbook: () => void
  handleAddHighlightedToWordbook: () => void
  handleBatchAdd: () => void
}

vi.mock('../../hooks/useWordLookup', () => ({
  useWordLookup: vi.fn(),
}))

vi.mock('../ArticleEnglishMode', () => ({
  default: (props: {
    englishParagraphs: string[]
    onSpeakParagraph?: (index: number) => void
  }) => (
    <div data-testid="mode-english">
      <span data-count={props.englishParagraphs.length} />
      <button type="button" onClick={() => props.onSpeakParagraph?.(0)}>
        朗读段落
      </button>
    </div>
  ),
}))

vi.mock('../ArticleParagraphMode', () => ({
  default: (props: { englishParagraphs: string[]; chineseParagraphs: string[] }) => (
    <div
      data-testid="mode-paragraph"
      data-count={`${props.englishParagraphs.length}:${props.chineseParagraphs.length}`}
    />
  ),
}))

vi.mock('../ArticleSentenceMode', () => ({
  default: (props: {
    englishParagraphs: string[]
    chineseParagraphs: string[]
    toggleMode?: boolean
    scrollTarget?: string
    scrollTargetRef: { current: HTMLParagraphElement | null }
    sentenceTranslationVisible?: Set<number>
    onToggleSentenceTranslation?: (idx: number) => void
  }) => (
    <div data-testid="mode-sentence" data-toggle={String(!!props.toggleMode)}>
      <p ref={props.scrollTargetRef}>{props.scrollTarget ?? 'body'}</p>
      <button
        type="button"
        onClick={() => props.onToggleSentenceTranslation?.(0)}
      >
        切换译文
      </button>
      <span data-count={`${props.englishParagraphs.length}:${props.chineseParagraphs.length}`} />
      <span data-visible={props.sentenceTranslationVisible?.size ?? 0} />
    </div>
  ),
}))

vi.mock('../WordPopover', () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="word-popover">
      <button type="button" onClick={onClose}>
        关闭浮层
      </button>
    </div>
  ),
}))

const lookupMock = vi.mocked(useWordLookup)

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '2026-10-20',
    updated_at: Date.now(),
    title: 'A Brave Boy',
    content: 'Paragraph one.\n\nParagraph two.',
    translation: '第一段。\n\n第二段。',
    genre: 'narrative',
    wordCount: 40,
    createdAt: Date.now(),
    ...overrides,
  }
}

function baseLookup(overrides: Partial<LookupResult> = {}): LookupResult {
  return {
    containerRef: { current: null },
    popoverRef: { current: null },
    popover: null,
    toast: null,
    highlightedWords: [],
    handleMouseUp: vi.fn(),
    handleTouchEnd: vi.fn(),
    handleHighlightedWordClick: vi.fn(),
    closePopover: vi.fn(),
    handleAddLookupToWordbook: vi.fn(),
    handleAddHighlightedToWordbook: vi.fn(),
    handleBatchAdd: vi.fn(),
    ...overrides,
  }
}

function renderView(
  options: {
    mode?: TranslationMode
    article?: Article
    scrollTarget?: string
    lookup?: LookupResult
    visible?: Set<number>
    onToggle?: (idx: number) => void
    onSpeakParagraph?: (index: number) => void
  } = {}
) {
  const lookup = options.lookup ?? baseLookup()
  lookupMock.mockReturnValue(lookup as never)
  const view = render(
    <ArticleView
      article={options.article ?? makeArticle()}
      mode={options.mode ?? 'english'}
      sentenceTranslationVisible={options.visible}
      onToggleSentenceTranslation={options.onToggle}
      scrollTarget={options.scrollTarget}
      onSpeakParagraph={options.onSpeakParagraph}
    />
  )
  return { ...view, lookup }
}

describe('ArticleView 文章阅读视图', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('english 模式渲染纯英文并透传段落朗读回调', () => {
    const onSpeakParagraph = vi.fn()
    renderView({ mode: 'english', onSpeakParagraph })

    expect(screen.getByTestId('mode-english')).toBeInTheDocument()
    expect(screen.getByTestId('mode-english').querySelector('[data-count]')).toHaveAttribute(
      'data-count',
      '2'
    )

    fireEvent.click(screen.getByRole('button', { name: '朗读段落' }))
    expect(onSpeakParagraph).toHaveBeenCalledWith(0)
  })

  it('paragraph 模式传递英文与中文段落数量', () => {
    renderView({ mode: 'paragraph' })

    expect(screen.getByTestId('mode-paragraph')).toHaveAttribute('data-count', '2:2')
  })

  it('sentence 模式传递逐句切换状态与回调', () => {
    const onToggle = vi.fn()
    renderView({
      mode: 'sentence',
      visible: new Set([0, 2]),
      onToggle,
    })

    const container = screen.getByTestId('mode-sentence')
    expect(container).toHaveAttribute('data-toggle', 'false')
    expect(container.querySelector('[data-visible]')).toHaveAttribute(
      'data-visible',
      '2'
    )

    fireEvent.click(screen.getByRole('button', { name: '切换译文' }))
    expect(onToggle).toHaveBeenCalledWith(0)
  })

  it('toggle 模式开启逐句切换', () => {
    renderView({ mode: 'toggle' })

    expect(screen.getByTestId('mode-sentence')).toHaveAttribute('data-toggle', 'true')
  })

  it('scrollTarget 命中时滚动并闪烁高亮，2 秒后移除', () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    ;(HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView =
      scrollIntoView

    renderView({ mode: 'sentence', scrollTarget: 'Paragraph two.' })

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    })
    const target = screen.getByText('Paragraph two.')
    expect(target.className).toContain('ring-2')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(target.className).not.toContain('ring-2')
  })

  it('未设置 scrollTarget 时不滚动', () => {
    const scrollIntoView = vi.fn()
    ;(HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView =
      scrollIntoView

    renderView({ mode: 'sentence' })

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('有浮层时渲染 WordPopover 并关闭', () => {
    const lookup = baseLookup({
      popover: { kind: 'lookup' },
      closePopover: vi.fn(),
    })
    renderView({ lookup })

    expect(screen.getByTestId('word-popover')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭浮层' }))
    expect(lookup.closePopover).toHaveBeenCalledTimes(1)
  })

  it('无浮层与 toast 时不渲染额外内容', () => {
    renderView()

    expect(screen.queryByTestId('word-popover')).not.toBeInTheDocument()
    expect(screen.queryByText('已加入生词本')).not.toBeInTheDocument()
  })

  it('展示 toast 并绑定鼠标 / 触摸选词事件', () => {
    const lookup = baseLookup({ toast: '已加入生词本' })
    const { container } = renderView({ lookup })

    expect(screen.getByText('已加入生词本')).toBeInTheDocument()

    const root = container.firstElementChild as HTMLElement
    fireEvent.mouseUp(root)
    fireEvent.touchEnd(root)

    expect(lookup.handleMouseUp).toHaveBeenCalledTimes(1)
    expect(lookup.handleTouchEnd).toHaveBeenCalledTimes(1)
  })

  it('翻译字段缺失时按空译文渲染，不抛出异常', () => {
    renderView({
      mode: 'paragraph',
      article: makeArticle({ translation: undefined as unknown as string }),
    })

    expect(screen.getByTestId('mode-paragraph')).toHaveAttribute('data-count', '2:0')
  })
})
