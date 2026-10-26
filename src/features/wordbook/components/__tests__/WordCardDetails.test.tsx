// WordCardDetails 生词卡片详情单元测试
//
// 覆盖场景：
// 1. 词性释义、例句翻译、笔记与相关短语渲染
// 2. 缺词义 / 音标时展示 AI 补全按钮与来源徽章
// 3. AI 补全成功、失败（Error 与非 Error）、补全中禁用与防重复
// 4. 相关短语折叠展开与部分字段降级
//
// Mock 策略：mock enrichWord 与 AI 来源徽章，聚焦详情组件行为。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import WordCardDetails from '../WordCardDetails'
import { enrichWord } from '../../services/wordbookService'

vi.mock('../../services/wordbookService', () => ({
  enrichWord: vi.fn(),
}))

vi.mock('@/shared/components/AIProviderBadge', () => ({
  default: ({ scenario }: { scenario: string }) => (
    <span data-testid="ai-badge">{scenario}</span>
  ),
}))

const enrichMock = vi.mocked(enrichWord)

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
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    exampleTranslation: '我吃了一个苹果。',
    ...overrides,
  }
}

describe('WordCardDetails 生词详情', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enrichMock.mockResolvedValue(makeWord())
  })

  it('渲染词性释义、例句翻译与笔记', () => {
    render(
      <WordCardDetails
        word={makeWord({ note: '可数名词\n复数 apples' })}
        showToast={vi.fn()}
      />
    )

    expect(screen.getByText('n.')).toBeInTheDocument()
    expect(screen.getByText('苹果')).toBeInTheDocument()
    expect(screen.getByText('"I ate an apple."')).toBeInTheDocument()
    expect(screen.getByText('我吃了一个苹果。')).toBeInTheDocument()
    expect(screen.getByText(/复数 apples/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /AI 补全/ })
    ).not.toBeInTheDocument()
  })

  it('缺少音标时展示 AI 补全按钮与来源徽章', () => {
    render(
      <WordCardDetails word={makeWord({ phonetic: '' })} showToast={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: /AI 补全/ })).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge')).toHaveTextContent('wordEnrich')
  })

  it('AI 补全成功后刷新并提示', async () => {
    const onRefresh = vi.fn()
    const showToast = vi.fn()
    render(
      <WordCardDetails
        word={makeWord({ definition: '' })}
        onRefresh={onRefresh}
        showToast={showToast}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI 补全/ }))
    })

    expect(enrichMock).toHaveBeenCalledWith('apple')
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('AI 补全成功')
    expect(screen.getByRole('button', { name: /AI 补全/ })).toBeEnabled()
  })

  it('AI 补全失败时展示具体错误并保持可重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const showToast = vi.fn()
    enrichMock.mockRejectedValue(new Error('余额不足'))

    render(
      <WordCardDetails word={makeWord({ definition: '' })} showToast={showToast} />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI 补全/ }))
    })

    expect(showToast).toHaveBeenCalledWith('AI 补全失败：余额不足')
    expect(screen.getByRole('button', { name: /AI 补全/ })).toBeEnabled()
    warn.mockRestore()
  })

  it('AI 补全失败且非 Error 时提示稍后重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const showToast = vi.fn()
    enrichMock.mockRejectedValue('unknown')

    render(
      <WordCardDetails word={makeWord({ definition: '' })} showToast={showToast} />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI 补全/ }))
    })

    expect(showToast).toHaveBeenCalledWith('AI 补全失败：请稍后重试')
    warn.mockRestore()
  })

  it('补全中按钮禁用并展示进行中文案，防重复点击', async () => {
    let resolveEnrich: (() => void) | undefined
    enrichMock.mockImplementation(
      () =>
        new Promise<Word>((resolve) => {
          resolveEnrich = () => resolve(makeWord())
        })
    )
    render(
      <WordCardDetails word={makeWord({ definition: '' })} showToast={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: /AI 补全/ }))

    const pendingButton = screen.getByRole('button', { name: /补全中/ })
    expect(pendingButton).toBeDisabled()

    fireEvent.click(pendingButton)
    expect(enrichMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveEnrich?.()
    })

    expect(screen.getByRole('button', { name: /AI 补全/ })).toBeEnabled()
  })

  it('相关短语默认折叠，展开后展示完整字段', () => {
    render(
      <WordCardDetails
        word={makeWord({
          phrases: [
            {
              phrase: 'an apple a day',
              meaning: '一天一苹果',
              example: 'An apple a day keeps the doctor away.',
              exampleTranslation: '一天一苹果，医生远离我。',
            },
            { phrase: 'apple pie', meaning: '', example: '', exampleTranslation: '' },
          ],
        })}
        showToast={vi.fn()}
      />
    )

    const toggle = screen.getByRole('button', { name: /相关短语（2）/ })
    expect(screen.queryByText('an apple a day')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('an apple a day')).toBeInTheDocument()
    expect(screen.getByText('一天一苹果')).toBeInTheDocument()
    expect(
      screen.getByText('例：An apple a day keeps the doctor away.')
    ).toBeInTheDocument()
    expect(screen.getByText('一天一苹果，医生远离我。')).toBeInTheDocument()
    expect(screen.getByText('apple pie')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('an apple a day')).not.toBeInTheDocument()
  })

  it('可选字段缺失时不渲染词性释义、例句与笔记', () => {
    render(
      <WordCardDetails
        word={makeWord({
          pos: '',
          definition: '',
          example: '',
          exampleTranslation: undefined,
          note: '',
          phonetic: '/test/',
        })}
        showToast={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /AI 补全/ })).toBeInTheDocument()
    expect(screen.queryByText('"I ate an apple."')).not.toBeInTheDocument()
    expect(screen.queryByText(/📝/)).not.toBeInTheDocument()
  })
})
