// SpellStep 拼写步骤视图单元测试
//
// 覆盖场景：
// 1. 标题、发音按钮、释义 / 音标降级与提交按钮启用条件
// 2. 提交正确 / 错误反馈与禁用态
// 3. 查看答案按钮阈值与回调
// 4. 分级提示（首尾 / 含元音 / 键盘高亮）与音节数
// 5. 正确拼写闪现、抖动与边框状态
//
// Mock 策略：mock useSpellStep 返回可控状态，mock 语音工具断言发音调用。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Word } from '@/shared/types'
import SpellStep from '../SpellStep'
import { useSpellStep } from '../useSpellStep'
import { speak } from '@/shared/utils/speech'

interface SpellHookResult {
  input: string
  setInput: (value: string) => void
  hintLevel: number
  submitted: boolean
  wrongCount: number
  shaking: boolean
  flashKey: number
  showFlash: boolean
  inputRef: { current: HTMLInputElement | null }
  speechSupported: boolean
  isCorrect: boolean
  mask: string
  highlightedLetters: Set<string> | undefined
  hintLabel: string
  handleHint: () => void
  handleKeyPress: (letter: string) => void
  handleBackspace: () => void
  handleSubmit: (e: React.FormEvent) => void
  handleGiveUp: () => void
}

vi.mock('../useSpellStep', () => ({
  useSpellStep: vi.fn(),
}))

vi.mock('@/shared/utils/speech', () => ({
  speak: vi.fn(),
}))

const hookMock = vi.mocked(useSpellStep)
const speakMock = vi.mocked(speak)

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'apple',
    updated_at: now,
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    ...overrides,
  }
}

function baseHook(overrides: Partial<SpellHookResult> = {}): SpellHookResult {
  return {
    input: '',
    setInput: vi.fn(),
    hintLevel: 0,
    submitted: false,
    wrongCount: 0,
    shaking: false,
    flashKey: 0,
    showFlash: false,
    inputRef: createRef<HTMLInputElement>(),
    speechSupported: true,
    isCorrect: false,
    mask: '',
    highlightedLetters: undefined,
    hintLabel: '显示首尾字母',
    handleHint: vi.fn(),
    handleKeyPress: vi.fn(),
    handleBackspace: vi.fn(),
    handleSubmit: vi.fn(),
    handleGiveUp: vi.fn(),
    ...overrides,
  }
}

function renderStep(hook: SpellHookResult = baseHook(), word = makeWord()) {
  hookMock.mockReturnValue(hook as never)
  const onComplete = vi.fn()
  const view = render(<SpellStep word={word} onComplete={onComplete} />)
  return { ...view, hook, onComplete }
}

describe('SpellStep 拼写步骤视图', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染标题、发音按钮、释义与禁用的空提交按钮', () => {
    renderStep()

    expect(screen.getByText('请根据发音拼写单词')).toBeInTheDocument()
    expect(screen.getByText(/中文释义：/)).toBeInTheDocument()
    expect(screen.getByText('苹果')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '播放发音' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /显示首尾字母/ })).toBeInTheDocument()
  })

  it('点击发音按钮调用 speak', () => {
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: '播放发音' }))

    expect(speakMock).toHaveBeenCalledWith('apple')
  })

  it('缺少释义时回退音标，再缺失则展示提示', () => {
    const { rerender } = renderStep(baseHook(), makeWord({ definition: '' }))
    expect(screen.getByText(/音标：/)).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()

    hookMock.mockReturnValue(baseHook() as never)
    rerender(<SpellStep word={makeWord({ definition: '', phonetic: '' })} onComplete={vi.fn()} />)
    expect(
      screen.getByText('（释义与音标缺失，请根据发音拼写）')
    ).toBeInTheDocument()
  })

  it('不支持语音时禁用发音并展示音标提示', () => {
    renderStep(baseHook({ speechSupported: false }))

    expect(screen.getByRole('button', { name: '播放发音' })).toBeDisabled()
    expect(
      screen.getByText('当前浏览器不支持语音合成，请根据音标拼写')
    ).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()
  })

  it('输入内容后提交按钮启用并触发提交', () => {
    const hook = baseHook({ input: 'app' })
    renderStep(hook)

    expect(screen.getByRole('button', { name: '提交' })).toBeEnabled()

    fireEvent.submit(screen.getByRole('button', { name: '提交' }).closest('form') as HTMLFormElement)
    expect(hook.handleSubmit).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText('请输入单词...'), {
      target: { value: 'appl' },
    })
    expect(hook.setInput).toHaveBeenCalledWith('appl')
  })

  it('空白输入时提交按钮保持禁用', () => {
    renderStep(baseHook({ input: '   ' }))

    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()
  })

  it('提交正确时展示成功反馈并隐藏提交与提示按钮', () => {
    renderStep(baseHook({ submitted: true, isCorrect: true, input: 'apple' }))

    expect(screen.getByText('✓ 拼写正确！')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /显示首尾字母/ })
    ).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('请输入单词...')).toBeDisabled()
  })

  it('提交错误时展示正确答案', () => {
    renderStep(baseHook({ submitted: true, isCorrect: false, input: 'aplle' }))

    expect(screen.getByText('✗ 拼写错误')).toBeInTheDocument()
    expect(screen.getByText(/正确答案：/)).toBeInTheDocument()
    expect(screen.getByText('apple')).toBeInTheDocument()
  })

  it('错误次数达到阈值时展示查看答案按钮', () => {
    const hook = baseHook({ wrongCount: 2 })
    const { rerender } = renderStep(hook)

    fireEvent.click(screen.getByRole('button', { name: '查看答案并完成' }))
    expect(hook.handleGiveUp).toHaveBeenCalledTimes(1)

    hookMock.mockReturnValue(baseHook({ wrongCount: 1 }) as never)
    rerender(<SpellStep word={makeWord()} onComplete={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: '查看答案并完成' })
    ).not.toBeInTheDocument()
  })

  it('一级提示展示首尾字母遮罩', () => {
    renderStep(baseHook({ hintLevel: 1, mask: 'a___e' }))

    expect(screen.getByText('🔤 字母提示（首尾）')).toBeInTheDocument()
    expect(screen.getByText('a___e')).toBeInTheDocument()
  })

  it('二级提示展示含元音遮罩与音节数', () => {
    renderStep(baseHook({ hintLevel: 2, mask: 'a_ple', highlightedLetters: undefined }))

    expect(screen.getByText('🔤 字母提示（含元音）')).toBeInTheDocument()
    expect(screen.getByText('🎵 音节数')).toBeInTheDocument()
    expect(screen.getByText(/这个单词有/)).toBeInTheDocument()
  })

  it('三级提示展示自定义键盘并高亮字母', () => {
    const hook = baseHook({
      hintLevel: 3,
      mask: 'apple',
      highlightedLetters: new Set(['a', 'p', 'l', 'e']),
    })
    renderStep(hook)

    expect(
      screen.getByText('⌨️ 自定义键盘（高亮字母为单词可能包含的字母）')
    ).toBeInTheDocument()
    const letterA = screen.getByRole('button', { name: '字母 a' })
    expect(letterA.className).toContain('bg-green-100')

    fireEvent.click(letterA)
    expect(hook.handleKeyPress).toHaveBeenCalledWith('a')

    fireEvent.click(screen.getByRole('button', { name: '退格' }))
    expect(hook.handleBackspace).toHaveBeenCalledTimes(1)
  })

  it('提交后不展示自定义键盘', () => {
    renderStep(
      baseHook({
        hintLevel: 3,
        submitted: true,
        isCorrect: true,
        highlightedLetters: new Set(['a']),
      })
    )

    expect(
      screen.queryByText('⌨️ 自定义键盘（高亮字母为单词可能包含的字母）')
    ).not.toBeInTheDocument()
  })

  it('正确拼写闪现浮层与抖动样式生效', () => {
    renderStep(baseHook({ showFlash: true, shaking: true, wrongCount: 1 }))

    expect(screen.getByRole('status')).toHaveTextContent('apple')
    expect(screen.getByPlaceholderText('请输入单词...').className).toContain(
      'animate-shake'
    )
  })
})
