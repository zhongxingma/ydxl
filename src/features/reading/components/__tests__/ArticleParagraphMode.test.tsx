// ArticleParagraphMode 段落对照模式单元测试
//
// 覆盖场景：
// 1. 每段英文与对应中文译文渲染，缺译文时仅英文
// 2. 高亮词点击回传词条与位置信息
// 3. scrollTarget 命中段落时绑定滚动目标 ref
// 4. speakingParagraph 高亮当前朗读段落
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { HighlightedWord } from '@/shared/types'
import ArticleParagraphMode from '../ArticleParagraphMode'

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
  speakingParagraph?: number
}

function renderMode(options: RenderOptions = {}) {
  const onWordClick = vi.fn()
  const ref = createRef<HTMLParagraphElement>()
  const {
    english = ['First paragraph.', 'Second paragraph.'],
    chinese = ['第一段。', ''],
    highlighted = [],
    scrollTarget,
    speakingParagraph,
  } = options

  const view = render(
    <ArticleParagraphMode
      englishParagraphs={english}
      chineseParagraphs={chinese}
      highlightedWords={highlighted}
      scrollTarget={scrollTarget}
      scrollTargetRef={ref}
      onWordClick={onWordClick}
      speakingParagraph={speakingParagraph}
    />
  )

  return { ...view, onWordClick, ref }
}

describe('ArticleParagraphMode 段落对照模式', () => {
  it('渲染英文段落与对应中文译文', () => {
    renderMode()

    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
    expect(screen.getByText('第一段。')).toBeInTheDocument()
  })

  it('缺少对应译文时仅渲染英文段落', () => {
    renderMode({ chinese: [] })

    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.queryByText('第一段。')).not.toBeInTheDocument()
  })

  it('点击高亮词回传词条与位置信息', () => {
    const { onWordClick } = renderMode({
      highlighted: [makeHighlight('paragraph')],
    })

    fireEvent.click(screen.getAllByText('paragraph')[0])

    expect(onWordClick).toHaveBeenCalledTimes(1)
    expect(onWordClick).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'paragraph' }),
      expect.anything()
    )
  })

  it('scrollTarget 命中段落时绑定滚动目标 ref', () => {
    const { ref } = renderMode({ scrollTarget: 'Second' })

    expect(ref.current).not.toBeNull()
    expect(ref.current?.textContent).toContain('Second paragraph.')
  })

  it('未设置 scrollTarget 时不绑定滚动目标', () => {
    const { ref } = renderMode()

    expect(ref.current).toBeNull()
  })

  it('speakingParagraph 为当前段落添加朗读高亮样式', () => {
    renderMode({ speakingParagraph: 1 })

    const first = screen.getByText('First paragraph.')
    const second = screen.getByText('Second paragraph.')

    expect(first.className).not.toContain('ring-2')
    expect(second.className).toContain('ring-2')
  })
})
