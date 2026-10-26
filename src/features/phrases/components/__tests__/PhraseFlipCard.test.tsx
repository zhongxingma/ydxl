// PhraseFlipCard 重点短语翻转卡片单元测试
//
// 覆盖场景：
// 1. 正面：PHRASE 标签、短语文案与提示
// 2. 翻转交互与再次点击复位
// 3. 发音按钮：支持性、朗读调用与阻止冒泡
// 4. 背面：释义、例句与翻译、缺少例句时的降级
// 5. 来源按钮跳转原文（articleId 编码）且不触发翻转
//
// Mock 策略：mock useNavigate 捕获跳转路径，mock 语音工具控制支持性与朗读断言。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PhraseWithSource } from '../../types'
import PhraseFlipCard from '../PhraseFlipCard'
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

function makePhrase(
  overrides: Partial<PhraseWithSource> = {}
): PhraseWithSource {
  return {
    phrase: 'take care of',
    meaning: '照顾；照料',
    example: 'She takes care of her sister.',
    exampleTranslation: '她照顾她的妹妹。',
    articleId: '2026-10-20',
    articleTitle: 'A Brave Boy',
    readAt: Date.now(),
    ...overrides,
  }
}

function renderCard(phrase: PhraseWithSource = makePhrase()) {
  const view = render(<PhraseFlipCard phrase={phrase} />)
  const card = view.container.querySelector(
    '[style*="preserve-3d"]'
  ) as HTMLElement
  return { ...view, card }
}

describe('PhraseFlipCard 重点短语翻转卡片', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSpeechSupportedMock.mockReturnValue(true)
  })

  it('正面展示 PHRASE 标签、短语与提示', () => {
    renderCard()

    expect(screen.getByText('PHRASE')).toBeInTheDocument()
    expect(screen.getByText('take care of')).toBeInTheDocument()
    expect(screen.getByText('点击查看释义')).toBeInTheDocument()
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

    const speakButton = screen.getByRole('button', { name: '朗读 take care of' })
    expect(speakButton).toBeEnabled()
    expect(speakButton).toHaveAttribute('title', '朗读短语')

    fireEvent.click(speakButton)

    expect(speakMock).toHaveBeenCalledWith('take care of', 0.9)
    expect(card.style.transform).toBe('rotateY(0deg)')
  })

  it('不支持语音时朗读按钮禁用并提示', () => {
    isSpeechSupportedMock.mockReturnValue(false)
    renderCard()

    const speakButton = screen.getByRole('button', { name: '朗读 take care of' })
    expect(speakButton).toBeDisabled()
    expect(speakButton).toHaveAttribute(
      'title',
      '当前浏览器不支持语音朗读'
    )
  })

  it('背面展示释义、例句与翻译', () => {
    renderCard()

    expect(screen.getByText('释义')).toBeInTheDocument()
    expect(screen.getByText('照顾；照料')).toBeInTheDocument()
    expect(screen.getByText('She takes care of her sister.')).toBeInTheDocument()
    expect(screen.getByText('她照顾她的妹妹。')).toBeInTheDocument()
  })

  it('缺少例句时不展示例句与翻译区域', () => {
    renderCard(makePhrase({ example: '', exampleTranslation: undefined }))

    expect(
      screen.queryByText('She takes care of her sister.')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('她照顾她的妹妹。')).not.toBeInTheDocument()
  })

  it('有例句但无翻译时仅展示英文例句', () => {
    renderCard(makePhrase({ exampleTranslation: undefined }))

    expect(screen.getByText('She takes care of her sister.')).toBeInTheDocument()
    expect(screen.queryByText('她照顾她的妹妹。')).not.toBeInTheDocument()
  })

  it('点击来源按钮跳转原文并编码 articleId，不触发翻转', () => {
    const { card } = renderCard(
      makePhrase({ articleId: '2026/10/20', articleTitle: 'Source' })
    )

    fireEvent.click(screen.getByTitle('查看原文：Source'))

    expect(navigateMock).toHaveBeenCalledWith(
      '/reading?articleId=2026%2F10%2F20'
    )
    expect(card.style.transform).toBe('rotateY(0deg)')
  })
})
