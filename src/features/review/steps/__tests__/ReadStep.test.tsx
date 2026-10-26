// ReadStep 朗读步骤视图单元测试
//
// 覆盖场景：
// 1. 单词头部、释义、速度切换、波形、朗读 / 录音按钮与下一步
// 2. 朗读中、录音中、录音回放与评分三档文案
// 3. 不支持语音 / 录音时的降级提示
// 4. AI 提示加载中、错误（有 / 无提示）与拼读分解内容
//
// Mock 策略：mock useReadStep 返回可控状态，mock 头部与来源徽章聚焦视图分支。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Word } from '@/shared/types'
import type { StepResult } from '../../types'
import ReadStep from '../ReadStep'
import { useReadStep } from '../useReadStep'

interface ReadHookResult {
  speechSupported: boolean
  recorderSupported: boolean
  speed: 'normal' | 'slow'
  setSpeed: (s: 'normal' | 'slow') => void
  speaking: boolean
  waveBars: number
  recording: boolean
  recordedUrl: string | null
  score: 1 | 2 | 3 | null
  hint: { phonics: string[]; syllables: number; source: string } | null
  hintLoading: boolean
  hintError: string | null
  handleShowHint: () => void
  handlePlay: () => void
  handleStartRecording: () => void
  handleStopRecording: () => void
  handleComplete: () => void
}

vi.mock('../useReadStep', () => ({
  useReadStep: vi.fn(),
}))

vi.mock('../../components/WordHeader', () => ({
  default: ({ word }: { word: Word }) => <div data-testid="word-header">{word.word}</div>,
}))

vi.mock('@/shared/components/AIProviderBadge', () => ({
  default: ({ scenario }: { scenario: string }) => (
    <span data-testid="ai-badge">{scenario}</span>
  ),
}))

const hookMock = vi.mocked(useReadStep)

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

function baseHook(overrides: Partial<ReadHookResult> = {}): ReadHookResult {
  return {
    speechSupported: true,
    recorderSupported: true,
    speed: 'normal',
    setSpeed: vi.fn(),
    speaking: false,
    waveBars: 4,
    recording: false,
    recordedUrl: null,
    score: null,
    hint: null,
    hintLoading: false,
    hintError: null,
    handleShowHint: vi.fn(),
    handlePlay: vi.fn(),
    handleStartRecording: vi.fn(),
    handleStopRecording: vi.fn(),
    handleComplete: vi.fn(),
    ...overrides,
  }
}

function renderStep(hook: ReadHookResult = baseHook(), word = makeWord()) {
  hookMock.mockReturnValue(hook as never)
  const onComplete = vi.fn<(result: StepResult) => void>()
  const view = render(<ReadStep word={word} onComplete={onComplete} />)
  return { ...view, hook, onComplete }
}

describe('ReadStep 朗读步骤视图', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染单词、释义、速度切换、波形与操作按钮', () => {
    const { container, hook } = renderStep()

    expect(screen.getByTestId('word-header')).toHaveTextContent('apple')
    expect(screen.getByText('释义：')).toBeInTheDocument()
    expect(screen.getByText('跟读练习')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '常速' }).className).toContain(
      'bg-indigo-600'
    )
    expect(screen.getByRole('button', { name: '慢速' })).toBeInTheDocument()
    expect(container.querySelectorAll('.wave-bar')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '朗读' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始跟读/ })).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge')).toHaveTextContent('wordBreakdown')

    fireEvent.click(screen.getByRole('button', { name: /开始跟读/ }))
    expect(hook.handleStartRecording).toHaveBeenCalledTimes(1)
  })

  it('切换慢速并展示选中态', () => {
    const hook = baseHook({ speed: 'slow' })
    renderStep(hook)

    expect(screen.getByRole('button', { name: '慢速' }).className).toContain(
      'bg-indigo-600'
    )

    fireEvent.click(screen.getByRole('button', { name: '常速' }))
    expect(hook.setSpeed).toHaveBeenCalledWith('normal')

    fireEvent.click(screen.getByRole('button', { name: '慢速' }))
    expect(hook.setSpeed).toHaveBeenCalledWith('slow')
  })

  it('朗读中按钮禁用并激活波形动画', () => {
    const { container } = renderStep(baseHook({ speaking: true }))

    expect(screen.getByRole('button', { name: '朗读中…' })).toBeDisabled()
    expect(container.querySelector('.wave-active')).not.toBeNull()
  })

  it('录音中展示停止按钮并可停止', () => {
    const hook = baseHook({ recording: true })
    renderStep(hook)

    expect(screen.queryByRole('button', { name: /开始跟读/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    expect(hook.handleStopRecording).toHaveBeenCalledTimes(1)
  })

  it('录音完成后展示回放音频', () => {
    const { container } = renderStep(baseHook({ recordedUrl: 'blob:record' }))

    expect(screen.getByText('你的录音：')).toBeInTheDocument()
    expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:record')
  })

  it('三档评分分别展示对应鼓励文案', () => {
    const { rerender } = renderStep(baseHook({ score: 3 }))
    expect(screen.getByLabelText('3 星')).toBeInTheDocument()
    expect(screen.getByText('发音很棒！')).toBeInTheDocument()

    hookMock.mockReturnValue(baseHook({ score: 2 }) as never)
    rerender(<ReadStep word={makeWord()} onComplete={vi.fn()} />)
    expect(screen.getByText('不错，继续加油！')).toBeInTheDocument()

    hookMock.mockReturnValue(baseHook({ score: 1 }) as never)
    rerender(<ReadStep word={makeWord()} onComplete={vi.fn()} />)
    expect(screen.getByText('勇敢开口就是好开始！')).toBeInTheDocument()
  })

  it('不支持语音与录音时隐藏对应控件并展示提示', () => {
    const { container } = renderStep(
      baseHook({ speechSupported: false, recorderSupported: false })
    )

    expect(screen.queryByRole('button', { name: '常速' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '朗读' })).not.toBeInTheDocument()
    expect(container.querySelector('.wave-bar')).toBeNull()
    expect(
      screen.getByText('当前浏览器不支持录音功能，请使用朗读按钮练习跟读。')
    ).toBeInTheDocument()
  })

  it('缺少释义时不渲染释义区块', () => {
    renderStep(baseHook(), makeWord({ definition: '' }))

    expect(screen.queryByText('释义：')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-badge')).not.toBeInTheDocument()
  })

  it('提示加载中展示生成文案', () => {
    renderStep(baseHook({ hintLoading: true }))

    expect(screen.getByText('正在生成拼读分解...')).toBeInTheDocument()
  })

  it('提示错误按是否有提示切换颜色并展示拼读内容', () => {
    const { rerender } = renderStep(baseHook({ hintError: 'AI 不可用' }))

    expect(screen.getByText('AI 不可用').className).toContain('bg-red-50')

    hookMock.mockReturnValue(
      baseHook({
        hint: { phonics: ['a', 'pp', 'le'], syllables: 2, source: 'ai' },
        hintError: '已切换本地估算',
      }) as never
    )
    rerender(<ReadStep word={makeWord()} onComplete={vi.fn()} />)

    expect(screen.getByText('已切换本地估算').className).toContain('bg-blue-50')
    expect(screen.getByText('🔤 自然拼读')).toBeInTheDocument()
    expect(screen.getByText('a - pp - le')).toBeInTheDocument()
    expect(screen.getByText('🎵 音节数')).toBeInTheDocument()
    expect(screen.getByText('2 个音节')).toBeInTheDocument()
  })

  it('点击提示与下一步触发对应回调', () => {
    const hook = baseHook()
    renderStep(hook)

    fireEvent.click(screen.getByRole('button', { name: /拼读分解/ }))
    expect(hook.handleShowHint).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    expect(hook.handleComplete).toHaveBeenCalledTimes(1)
  })
})
