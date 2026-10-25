// 识记步骤组件
//
// 覆盖 AI 助记 / emoji 加载与失败降级、词根词缀拆解、字段补全提示与完成回调。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { aiProvider } from '@/shared/services/ai'
import LearnStep from '../LearnStep'

vi.mock('@/shared/services/ai', () => ({
  aiProvider: {
    generateMnemonic: vi.fn(),
    generateEmojiHint: vi.fn(),
  },
}))

vi.mock('@/shared/components/AIProviderBadge', () => ({
  default: () => null,
}))

const generateMnemonicMock = vi.mocked(aiProvider.generateMnemonic)
const generateEmojiHintMock = vi.mocked(aiProvider.generateEmojiHint)

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

describe('LearnStep 识记步骤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateMnemonicMock.mockResolvedValue({ mnemonic: '苹果助记', explanation: '联想解释' })
    generateEmojiHintMock.mockResolvedValue(['🍎', '😋', '🌟', '多余'])
  })

  it('加载助记与 emoji，emoji 最多展示 3 个', async () => {
    render(<LearnStep word={makeWord()} onComplete={vi.fn()} />)

    expect(await screen.findByText('苹果助记')).toBeInTheDocument()
    expect(screen.getByText('联想解释')).toBeInTheDocument()
    expect(screen.getByText('🍎')).toBeInTheDocument()
    expect(screen.getByText('😋')).toBeInTheDocument()
    expect(screen.getByText('🌟')).toBeInTheDocument()
    expect(screen.queryByText('多余')).not.toBeInTheDocument()
    expect(generateMnemonicMock).toHaveBeenCalledWith('apple', '苹果', undefined)
    expect(generateEmojiHintMock).toHaveBeenCalledWith('apple', '苹果')
  })

  it('助记加载失败时展示降级文案，emoji 不受影响', async () => {
    generateMnemonicMock.mockRejectedValue(new Error('ai down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<LearnStep word={makeWord()} onComplete={vi.fn()} />)

    expect(
      await screen.findByText('暂未获取到助记口诀，可继续学习本词。'),
    ).toBeInTheDocument()
    expect(screen.getByText('🍎')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith('[LearnStep] 获取助记口诀失败', expect.any(Error))
  })

  it('emoji 加载失败时静默降级，不展示 emoji 区块', async () => {
    generateEmojiHintMock.mockRejectedValue(new Error('emoji down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<LearnStep word={makeWord()} onComplete={vi.fn()} />)

    expect(await screen.findByText('苹果助记')).toBeInTheDocument()
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[LearnStep] 获取 emoji 助记失败', expect.any(Error)),
    )
    expect(screen.queryByText('🏷️ emoji 助记')).not.toBeInTheDocument()
  })

  it('单词信息与词根词缀正常展示', async () => {
    render(
      <LearnStep
        word={makeWord({ root: 'un+believ+able' })}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()
    expect(screen.getByText('n.')).toBeInTheDocument()
    expect(screen.getByText('苹果')).toBeInTheDocument()
    expect(screen.getByText(/I ate an apple\./)).toBeInTheDocument()
    expect(screen.getByText('词根词缀拆解')).toBeInTheDocument()
    expect(screen.getByText('un')).toBeInTheDocument()
    expect(screen.getByText('believ')).toBeInTheDocument()
    expect(screen.getByText('able')).toBeInTheDocument()
    expect(screen.getByText('前缀')).toBeInTheDocument()
    expect(screen.getByText('词根')).toBeInTheDocument()
    expect(screen.getByText('后缀')).toBeInTheDocument()
    await screen.findByText('苹果助记')
  })

  it('单片段词根整体展示', async () => {
    render(<LearnStep word={makeWord({ root: 'biology' })} onComplete={vi.fn()} />)

    expect(screen.getByText('biology')).toBeInTheDocument()
    await screen.findByText('苹果助记')
  })

  it('字段全空时展示补全提示', async () => {
    render(
      <LearnStep
        word={makeWord({ phonetic: '', pos: '', definition: '', example: '' })}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText('正在补全单词信息...')).toBeInTheDocument()
    await screen.findByText('苹果助记')
  })

  it('点击下一步：识记视为全对回调', async () => {
    const onComplete = vi.fn()
    render(<LearnStep word={makeWord()} onComplete={onComplete} />)
    await screen.findByText('苹果助记')

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))

    expect(onComplete).toHaveBeenCalledWith({
      correct: true,
      correctRate: 1,
      timeSpent: expect.any(Number),
    })
  })
})
