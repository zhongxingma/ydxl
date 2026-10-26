// MasteredWordCard 已掌握单词卡片单元测试
//
// 覆盖场景：
// 1. 单词、音标、已掌握徽章、词性与释义、例句与翻译渲染
// 2. 可选字段缺失时对应区域不渲染
// 3. 发音按钮：支持性、朗读调用与禁用提示
// 4. 相关短语折叠 / 展开 / 收起与条目内容
//
// Mock 策略：mock 语音工具，聚焦卡片展示与交互。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Word } from '@/shared/types'
import MasteredWordCard from '../MasteredWordCard'
import { speak, isSpeechSupported } from '@/shared/utils/speech'

vi.mock('@/shared/utils/speech', () => ({
  speak: vi.fn(),
  isSpeechSupported: vi.fn(() => true),
}))

const speakMock = vi.mocked(speak)
const isSpeechSupportedMock = vi.mocked(isSpeechSupported)

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'apple',
    updated_at: now,
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple.',
    mastery: 5,
    nextReview: now,
    lastReview: now,
    reviewCount: 3,
    interval: 7,
    easeFactor: 2.5,
    createdAt: now,
    exampleTranslation: '我吃了一个苹果。',
    ...overrides,
  }
}

describe('MasteredWordCard 已掌握单词卡片', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSpeechSupportedMock.mockReturnValue(true)
  })

  it('渲染单词、音标、已掌握徽章、词性释义与例句翻译', () => {
    render(<MasteredWordCard word={makeWord()} />)

    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()
    expect(screen.getByText('✓ 已掌握')).toBeInTheDocument()
    expect(screen.getByText('n.')).toBeInTheDocument()
    expect(screen.getByText('苹果')).toBeInTheDocument()
    expect(screen.getByText('"I ate an apple."')).toBeInTheDocument()
    expect(screen.getByText('我吃了一个苹果。')).toBeInTheDocument()
  })

  it('缺少音标、释义与例句时不渲染对应区域', () => {
    render(
      <MasteredWordCard
        word={makeWord({
          phonetic: '',
          pos: '',
          definition: '',
          example: '',
          exampleTranslation: undefined,
        })}
      />
    )

    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.queryByText('/ˈæpl/')).not.toBeInTheDocument()
    expect(screen.queryByText('苹果')).not.toBeInTheDocument()
    expect(screen.queryByText(/I ate an apple/)).not.toBeInTheDocument()
  })

  it('支持语音时点击朗读按钮调用 speak', () => {
    render(<MasteredWordCard word={makeWord()} />)

    const button = screen.getByRole('button', { name: '朗读 apple' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('title', '朗读单词')

    fireEvent.click(button)

    expect(speakMock).toHaveBeenCalledWith('apple', 1)
  })

  it('不支持语音时朗读按钮禁用并提示', () => {
    isSpeechSupportedMock.mockReturnValue(false)
    render(<MasteredWordCard word={makeWord()} />)

    const button = screen.getByRole('button', { name: '朗读 apple' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', '当前浏览器不支持语音朗读')
  })

  it('相关短语默认折叠，点击展开后可再次收起', () => {
    render(
      <MasteredWordCard
        word={makeWord({
          phrases: [
            {
              phrase: 'an apple a day',
              meaning: '一天一苹果',
              example: 'An apple a day keeps the doctor away.',
              exampleTranslation: '一天一苹果，医生远离我。',
            },
          ],
        })}
      />
    )

    const toggle = screen.getByRole('button', { name: /相关短语（1）/ })
    expect(screen.queryByText('an apple a day')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('an apple a day')).toBeInTheDocument()
    expect(screen.getByText('一天一苹果')).toBeInTheDocument()
    expect(
      screen.getByText('例：An apple a day keeps the doctor away.')
    ).toBeInTheDocument()
    expect(screen.getByText('一天一苹果，医生远离我。')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('an apple a day')).not.toBeInTheDocument()
  })

  it('短语缺少释义与例句时仅展示短语本身', () => {
    render(
      <MasteredWordCard
        word={makeWord({
          phrases: [
            { phrase: 'apple pie', meaning: '', example: '', exampleTranslation: '' },
          ],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /相关短语（1）/ }))

    expect(screen.getByText('apple pie')).toBeInTheDocument()
    expect(screen.queryByText(/例：/)).not.toBeInTheDocument()
  })
})
