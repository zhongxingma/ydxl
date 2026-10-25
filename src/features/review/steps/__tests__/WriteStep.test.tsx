// 默写步骤组件
//
// 覆盖单词 / 例句填空模式切换、提示递进、正确与错误提交、逐字符对比、朗读与顽固词计数。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import WriteStep from '../WriteStep'

vi.mock('@/shared/services', () => ({
  wordRepository: {
    getByIdLocalFirst: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/shared/utils/speech', () => ({
  isSpeechSupported: vi.fn(() => false),
  speak: vi.fn(),
}))

const getByIdMock = vi.mocked(wordRepository.getByIdLocalFirst)
const updateMock = vi.mocked(wordRepository.update)
const speechSupportedMock = vi.mocked(isSpeechSupported)
const speakMock = vi.mocked(speak)

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'w1',
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

function typeInput(value: string): HTMLInputElement {
  const input = screen.getByRole('textbox') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
  return input
}

describe('WriteStep 默写步骤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    speechSupportedMock.mockReturnValue(false)
    getByIdMock.mockResolvedValue({ stubbornCount: 2 } as Word)
    updateMock.mockResolvedValue(makeWord())
  })

  it('初始为单词默写模式：展示释义与提交按钮（空输入禁用）', () => {
    render(<WriteStep word={makeWord()} onComplete={vi.fn()} />)

    expect(screen.getByText('请根据释义默写单词')).toBeInTheDocument()
    expect(screen.getByText('苹果')).toBeInTheDocument()
    expect(screen.getByText('n.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('请输入英文单词...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '显示首尾字母' })).toBeInTheDocument()
  })

  it('默写正确：展示对比与成功反馈，回调 correctRate=1', () => {
    const onComplete = vi.fn()
    render(<WriteStep word={makeWord()} onComplete={onComplete} />)

    typeInput('APPLE')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(onComplete).toHaveBeenCalledWith({
      correct: true,
      correctRate: 1,
      timeSpent: expect.any(Number),
    })
    expect(screen.getByText('✓ 默写正确！')).toBeInTheDocument()
    expect(screen.getByText('正确答案：')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交' })).not.toBeInTheDocument()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('默写错误：展示逐字符对比、错误反馈并累加顽固词', async () => {
    const onComplete = vi.fn()
    render(<WriteStep word={makeWord()} onComplete={onComplete} />)

    typeInput('appl')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(onComplete).toHaveBeenCalledWith({
      correct: false,
      correctRate: 0,
      timeSpent: expect.any(Number),
    })
    expect(screen.getByText('✗ 默写错误')).toBeInTheDocument()
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('w1', { stubbornCount: 3 }),
    )
  })

  it('顽固词计数更新失败仅告警', async () => {
    getByIdMock.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<WriteStep word={makeWord()} onComplete={vi.fn()} />)

    typeInput('x')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[WriteStep] 更新顽固词计数失败',
        expect.any(Error),
      ),
    )
  })

  it('提示递进：首尾字母 → 例句提示', () => {
    render(<WriteStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '显示首尾字母' }))
    expect(screen.getByText('a___e')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '显示例句' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '显示例句' }))
    expect(screen.getByText('📝 例句提示')).toBeInTheDocument()
    expect(screen.getAllByText(/I ate an ______\./).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '显示例句' })).not.toBeInTheDocument()
  })

  it('例句填空模式：挖空例句、音节课时数与填回展示', () => {
    render(<WriteStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '例句填空' }))
    expect(screen.getByPlaceholderText('请在空格处输入单词...')).toBeInTheDocument()
    expect(screen.getByText(/I ate an ______\./)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '显示首尾字母' }))
    fireEvent.click(screen.getByRole('button', { name: '显示音节数' }))
    expect(screen.getByText('🎵 音节数')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    typeInput('apple')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(screen.getByText('填回例句：')).toBeInTheDocument()
    expect(screen.getByText('“I ate an apple.”')).toBeInTheDocument()
  })

  it('切换模式会重置输入与提示', () => {
    render(<WriteStep word={makeWord()} onComplete={vi.fn()} />)

    typeInput('app')
    fireEvent.click(screen.getByRole('button', { name: '显示首尾字母' }))
    expect(screen.getByText('a___e')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '例句填空' }))

    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.queryByText('a___e')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '显示首尾字母' })).toBeInTheDocument()
  })

  it('提交后支持朗读单词', () => {
    speechSupportedMock.mockReturnValue(true)
    render(<WriteStep word={makeWord()} onComplete={vi.fn()} />)

    typeInput('apple')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    fireEvent.click(screen.getByRole('button', { name: '朗读单词' }))
    expect(speakMock).toHaveBeenCalledWith('apple')
  })

  it('空输入提交不触发回调', () => {
    const onComplete = vi.fn()
    render(<WriteStep word={makeWord()} onComplete={onComplete} />)

    fireEvent.submit(screen.getByRole('textbox').closest('form')!)

    expect(onComplete).not.toHaveBeenCalled()
  })
})
