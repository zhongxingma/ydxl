// ArticleSentenceMode 句子模式单元测试
//
// 覆盖场景：
// 1. sentence 模式：按句切分、英文与对应译文上下排列、缺译文时仅英文
// 2. 高亮词点击回传词条与位置信息
// 3. toggle 模式：默认英文、点击切换译文、已显示译文时展示中文并可切回
// 4. toggle 模式跨段落全局句子下标与缺译文回退
// 5. scrollTarget 命中英文或中文句子时绑定滚动目标 ref
// 6. speakingParagraph 高亮当前朗读段落
//
// 环境依赖：切句与高亮渲染使用真实工具函数，仅用轻量 Ref / 回调断言。
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { HighlightedWord } from '@/shared/types'
import ArticleSentenceMode from '../ArticleSentenceMode'

function makeHighlight(word: string): HighlightedWord {
  return {
    word,
    phonetic: `/${word}/`,
    pos: 'n.',
    definition: `${word} 释义`,
    example: `${word} example`,
  }
}

interface RenderOptions {
  english?: string[]
  chinese?: string[]
  highlighted?: HighlightedWord[]
  scrollTarget?: string
  toggleMode?: boolean
  visible?: Set<number>
  onToggle?: (idx: number) => void
  speakingParagraph?: number
}

function renderMode(options: RenderOptions = {}) {
  const onWordClick = vi.fn()
  const ref = createRef<HTMLParagraphElement>()
  const {
    english = ['I like apples. You like pears.', 'No punctuation'],
    chinese = ['我喜欢苹果。你喜欢梨。', ''],
    highlighted = [],
    scrollTarget,
    toggleMode = false,
    visible,
    onToggle,
    speakingParagraph,
  } = options

  const view = render(
    <ArticleSentenceMode
      englishParagraphs={english}
      chineseParagraphs={chinese}
      highlightedWords={highlighted}
      scrollTarget={scrollTarget}
      scrollTargetRef={ref}
      onWordClick={onWordClick}
      toggleMode={toggleMode}
      sentenceTranslationVisible={visible}
      onToggleSentenceTranslation={onToggle}
      speakingParagraph={speakingParagraph}
    />
  )

  return { ...view, onWordClick, ref }
}

describe('ArticleSentenceMode 句子模式', () => {
  it('按句切分并按段展示英文与对应中文', () => {
    renderMode()

    expect(screen.getByText('I like apples.')).toBeInTheDocument()
    expect(screen.getByText('You like pears.')).toBeInTheDocument()
    expect(screen.getByText('我喜欢苹果。')).toBeInTheDocument()
    expect(screen.getByText('你喜欢梨。')).toBeInTheDocument()
    expect(screen.getByText('No punctuation')).toBeInTheDocument()
  })

  it('缺少译文时仅展示英文句子', () => {
    renderMode({ english: ['Only English.'], chinese: [] })

    expect(screen.getByText('Only English.')).toBeInTheDocument()
    expect(screen.queryByText('我喜欢苹果。')).not.toBeInTheDocument()
  })

  it('点击高亮词回传词条与位置信息', () => {
    const { onWordClick } = renderMode({
      highlighted: [makeHighlight('apples')],
    })

    fireEvent.click(screen.getByText('apples'))

    expect(onWordClick).toHaveBeenCalledTimes(1)
    expect(onWordClick).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'apples' }),
      expect.anything()
    )
  })

  it('sentence 模式下点击句子不触发切换回调', () => {
    const onToggle = vi.fn()
    renderMode({ onToggle })

    fireEvent.click(screen.getByText('I like apples.'))

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('toggle 模式默认展示英文，点击后回传全局句子下标', () => {
    const onToggle = vi.fn()
    renderMode({ toggleMode: true, onToggle })

    const first = screen.getByText('I like apples.')
    expect(first).toHaveAttribute('title', '点击查看译文')

    fireEvent.click(first)
    expect(onToggle).toHaveBeenLastCalledWith(0)

    fireEvent.click(screen.getByText('You like pears.'))
    expect(onToggle).toHaveBeenLastCalledWith(1)

    // 第二段的句子延续全局下标
    fireEvent.click(screen.getByText('No punctuation'))
    expect(onToggle).toHaveBeenLastCalledWith(2)
  })

  it('toggle 模式已翻译句子展示中文并可切回英文', () => {
    const onToggle = vi.fn()
    renderMode({ toggleMode: true, visible: new Set([1]), onToggle })

    const translated = screen.getByText('你喜欢梨。')
    expect(translated).toHaveAttribute('title', '点击切回英文')

    fireEvent.click(translated)
    expect(onToggle).toHaveBeenCalledWith(1)

    expect(screen.getByText('I like apples.')).toHaveAttribute(
      'title',
      '点击查看译文'
    )
  })

  it('toggle 模式缺少对应译文时回退展示英文', () => {
    renderMode({
      english: ['Only English.'],
      chinese: [''],
      toggleMode: true,
      visible: new Set([0]),
    })

    expect(screen.getByText('Only English.')).toHaveAttribute(
      'title',
      '点击切回英文'
    )
  })

  it('scrollTarget 命中英文句子时绑定滚动目标 ref', () => {
    const { ref } = renderMode({ scrollTarget: 'pears' })

    expect(ref.current).not.toBeNull()
    expect(ref.current?.textContent).toContain('You like pears.')
  })

  it('scrollTarget 仅命中中文译文时同样绑定对应英文句', () => {
    const { ref } = renderMode({ scrollTarget: '梨' })

    expect(ref.current?.textContent).toContain('You like pears.')
  })

  it('未设置 scrollTarget 时不绑定滚动目标', () => {
    const { ref } = renderMode()

    expect(ref.current).toBeNull()
  })

  it('speakingParagraph 为当前段落添加朗读高亮样式', () => {
    renderMode({ speakingParagraph: 0 })

    const firstPara = screen.getByText('I like apples.').parentElement
      ?.parentElement
    const secondPara = screen.getByText('No punctuation').parentElement
      ?.parentElement

    expect(firstPara?.className).toContain('ring-2')
    expect(secondPara?.className).not.toContain('ring-2')
  })

  it('toggle 模式下同样高亮当前朗读段落', () => {
    renderMode({ toggleMode: true, speakingParagraph: 1 })

    const firstPara = screen.getByText('I like apples.').parentElement
    const secondPara = screen.getByText('No punctuation').parentElement

    expect(firstPara?.className).not.toContain('ring-2')
    expect(secondPara?.className).toContain('ring-2')
  })
})
