// VocabularyList 重点词汇清单单元测试
//
// 覆盖场景：
// 1. 空列表不渲染
// 2. 按重要程度排序与徽章文案（含未知值回退）
// 3. 音标 / 词性 / 释义可选字段
// 4. 真题例句、emoji 助记过滤、原文例句与翻译
// 5. forwardRef 暴露根节点
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import type { VocabularyItem } from '../../types'
import VocabularyList from '../VocabularyList'

vi.mock('@/shared/components/AIProviderBadge', () => ({
  default: ({ scenario, text }: { scenario: string; text?: string }) => (
    <span data-testid={`ai-badge-${scenario}`}>{text ?? scenario}</span>
  ),
}))

function makeItem(
  word: string,
  overrides: Partial<VocabularyItem> = {}
): VocabularyItem {
  return {
    word,
    phonetic: `/${word}/`,
    pos: 'n.',
    definition: `${word} 释义`,
    example: `${word} 原文例句`,
    importance: 'medium',
    ...overrides
  }
}

describe('VocabularyList 重点词汇清单', () => {
  it('空数组时返回 null', () => {
    const { container } = render(<VocabularyList items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('按重要程度排序并展示徽章', () => {
    render(
      <VocabularyList
        items={[
          makeItem('low-word', { importance: 'low' }),
          makeItem('high-word', { importance: 'high' }),
          makeItem('medium-word', { importance: 'medium' }),
        ]}
      />
    )

    const words = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(words[0]).toContain('high-word')
    expect(words[1]).toContain('medium-word')
    expect(words[2]).toContain('low-word')
    expect(screen.getByText('核心')).toBeInTheDocument()
    expect(screen.getByText('了解')).toBeInTheDocument()
  })

  it('未知重要程度回退为「了解」', () => {
    render(
      <VocabularyList
        items={[makeItem('odd', { importance: 'unknown' as VocabularyItem['importance'] })]}
      />
    )

    expect(screen.getByText('了解')).toBeInTheDocument()
  })

  it('可选音标、词性与释义缺失时不渲染对应内容', () => {
    render(
      <VocabularyList
        items={[makeItem('plain', { phonetic: '', pos: '', definition: '' })]}
      />
    )

    expect(screen.getByText('plain')).toBeInTheDocument()
    expect(screen.queryByText('/plain/')).not.toBeInTheDocument()
    expect(screen.queryByText('plain 释义')).not.toBeInTheDocument()
  })

  it('展示真题例句、过滤空 emoji 助记、原文例句与翻译', () => {
    render(
      <VocabularyList
        items={[
          makeItem('apple', {
            exampleSentence: 'He ate an apple.',
            emojiHint: ['🍎', '', '🌳'],
            exampleTranslation: '他吃了一个苹果。',
          }),
        ]}
      />
    )

    expect(screen.getByText('📖 例句：He ate an apple.')).toBeInTheDocument()
    expect(screen.getByText('💡 助记：🍎 🌳')).toBeInTheDocument()
    expect(screen.getByText('apple 原文例句')).toBeInTheDocument()
    expect(screen.getByText('他吃了一个苹果。')).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge-vocabulary')).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge-exampleSentence')).toHaveTextContent('例句')
    expect(screen.getByTestId('ai-badge-emojiHint')).toHaveTextContent('助记')
  })

  it('无增强字段时仅展示基础释义', () => {
    render(<VocabularyList items={[makeItem('basic')]} />)

    expect(screen.queryByText(/📖/)).not.toBeInTheDocument()
    expect(screen.queryByText(/💡/)).not.toBeInTheDocument()
    expect(screen.getByText('basic 原文例句')).toBeInTheDocument()
  })

  it('forwardRef 暴露根节点用于父组件滚动定位', () => {
    const ref = createRef<HTMLElement>()
    render(<VocabularyList ref={ref} items={[makeItem('apple')]} />)

    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('SECTION')
  })
})
