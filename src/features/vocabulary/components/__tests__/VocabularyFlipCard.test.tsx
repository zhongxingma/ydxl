// VocabularyFlipCard 重点词汇翻转卡片单元测试
//
// 覆盖场景：
// 1. 正面信息：WORD 标签、重要程度徽章、单词 / 音标 / 词性
// 2. 翻转交互与再次点击复位
// 3. 发音按钮：支持性、朗读调用与阻止冒泡
// 4. 背面内容：释义、真题例句与翻译、emoji 助记过滤、原文例句与翻译
// 5. 来源按钮跳转原文（articleId 编码）且不触发翻转
//
// Mock 策略：mock useNavigate 捕获跳转路径，mock 语音工具控制支持性与朗读断言。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { VocabularyWithSource } from '../../types'
import VocabularyFlipCard from '../VocabularyFlipCard'
import { speak, isSpeechSupported } from '@/shared/utils/speech'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/shared/utils/speech', () => ({
  speak: vi.fn(),
  isSpeechSupported: vi.fn(() => true),
}))

const speakMock = vi.mocked(speak)
const isSpeechSupportedMock = vi.mocked(isSpeechSupported)

function makeVocabulary(
  overrides: Partial<VocabularyWithSource> = {}
): VocabularyWithSource {
  return {
    word: 'abandon',
    phonetic: '/əˈbændən/',
    pos: 'v.',
    definition: '放弃；抛弃',
    example: 'They had to abandon the car.',
    importance: 'high',
    articleId: '2026-10-20',
    articleTitle: 'A Brave Boy',
    readAt: Date.now(),
    ...overrides,
  }
}

function renderCard(vocabulary: VocabularyWithSource = makeVocabulary()) {
  const view = render(<VocabularyFlipCard vocabulary={vocabulary} />)
  const card = view.container.querySelector(
    '[style*="preserve-3d"]'
  ) as HTMLElement
  return { ...view, card }
}

describe('VocabularyFlipCard 重点词汇翻转卡片', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSpeechSupportedMock.mockReturnValue(true)
  })

  it('正面展示 WORD 标签、重要程度、单词、音标与词性', () => {
    renderCard()

    expect(screen.getByText('WORD')).toBeInTheDocument()
    expect(screen.getByText('核心')).toBeInTheDocument()
    expect(screen.getByText('abandon')).toBeInTheDocument()
    expect(screen.getByText('/əˈbændən/')).toBeInTheDocument()
    expect(screen.getByText('v.')).toBeInTheDocument()
    expect(screen.getByText('点击查看释义')).toBeInTheDocument()
  })

  it('重要程度分别展示核心 / 中等 / 了解，未知值回退为了解', () => {
    const { rerender } = renderCard(
      makeVocabulary({ importance: 'medium' })
    )
    expect(screen.getByText('中等')).toBeInTheDocument()

    rerender(<VocabularyFlipCard vocabulary={makeVocabulary({ importance: 'low' })} />)
    expect(screen.getByText('了解')).toBeInTheDocument()

    rerender(
      <VocabularyFlipCard
        vocabulary={makeVocabulary({
          importance: 'unknown' as VocabularyWithSource['importance'],
        })}
      />
    )
    expect(screen.getByText('了解')).toBeInTheDocument()
  })

  it('音标与词性为空时不渲染对应行', () => {
    renderCard(makeVocabulary({ phonetic: '', pos: '' }))

    expect(screen.queryByText('/əˈbændən/')).not.toBeInTheDocument()
    expect(screen.queryByText('v.')).not.toBeInTheDocument()
  })

  it('点击卡片翻转，再次点击复位', () => {
    const { card } = renderCard()

    expect(card.style.transform).toBe('rotateY(0deg)')

    fireEvent.click(card)
    expect(card.style.transform).toBe('rotateY(180deg)')

    fireEvent.click(card)
    expect(card.style.transform).toBe('rotateY(0deg)')
  })

  it('支持语音时朗读按钮可点击并阻止冒泡触发翻转', () => {
    const { card } = renderCard()

    const speakButton = screen.getByRole('button', { name: '朗读 abandon' })
    expect(speakButton).toBeEnabled()
    expect(speakButton).toHaveAttribute('title', '朗读单词')

    fireEvent.click(speakButton)

    expect(speakMock).toHaveBeenCalledWith('abandon', 0.9)
    expect(card.style.transform).toBe('rotateY(0deg)')
  })

  it('不支持语音时朗读按钮禁用并提示', () => {
    isSpeechSupportedMock.mockReturnValue(false)
    renderCard()

    const speakButton = screen.getByRole('button', { name: '朗读 abandon' })
    expect(speakButton).toBeDisabled()
    expect(speakButton).toHaveAttribute(
      'title',
      '当前浏览器不支持语音朗读'
    )
  })

  it('背面展示释义、真题例句与翻译、emoji 助记及原文例句', () => {
    renderCard(
      makeVocabulary({
        exampleSentence: 'He abandoned his plan.',
        exampleSentenceTranslation: '他放弃了计划。',
        emojiHint: ['🍎', '', '🌳'],
        exampleTranslation: '他们不得不弃车。',
      })
    )

    expect(screen.getByText('释义')).toBeInTheDocument()
    expect(screen.getByText('放弃；抛弃')).toBeInTheDocument()
    expect(screen.getByText('📖 He abandoned his plan.')).toBeInTheDocument()
    expect(screen.getByText('他放弃了计划。')).toBeInTheDocument()
    expect(screen.getByText('💡 🍎 🌳')).toBeInTheDocument()
    expect(screen.getByText('They had to abandon the car.')).toBeInTheDocument()
    expect(screen.getByText('他们不得不弃车。')).toBeInTheDocument()
  })

  it('缺少增强字段时背面仅展示基础释义', () => {
    renderCard(makeVocabulary({ emojiHint: undefined, example: '' }))

    expect(screen.queryByText(/💡/)).not.toBeInTheDocument()
    expect(screen.queryByText(/📖/)).not.toBeInTheDocument()
  })

  it('点击来源按钮跳转原文并编码 articleId，不触发翻转', () => {
    const { card } = renderCard(
      makeVocabulary({ articleId: '2026/10/20', articleTitle: 'Source' })
    )

    const sourceButton = screen.getByTitle('查看原文：Source')
    fireEvent.click(sourceButton)

    expect(navigateMock).toHaveBeenCalledWith(
      '/reading?articleId=2026%2F10%2F20'
    )
    expect(card.style.transform).toBe('rotateY(0deg)')
  })
})
