// ReviewSessionView 复习会话视图单元测试
//
// 覆盖场景：
// 1. 五步步骤内容按 currentStep 渲染，进度文案与进度条百分比正确
// 2. 练习步骤干扰项排除当前词
// 3. 步骤完成回调携带当前步骤与结果
// 4. 提示按钮展示当前步骤提示，切换步骤后自动重置
// 5. 返回列表与步骤导航切换
//
// Mock 策略：mock 五个步骤组件为轻量替身，进度条与提示按钮使用真实组件
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReviewStep, Word } from '@/shared/types'
import type { StepResult } from '../../types'
import { STEP_ORDER } from '../../types'
import ReviewSessionView from '../ReviewSessionView'

function stepMock(testId: string, label: string) {
  return {
    default: ({
      word,
      onComplete,
    }: {
      word: Word
      onComplete: (result: StepResult) => void
    }) => (
      <div data-testid={testId}>
        <span>{word.word}</span>
        <button
          type="button"
          onClick={() => onComplete({ correct: true, correctRate: 1, timeSpent: 5 })}
        >
          {label}
        </button>
      </div>
    ),
  }
}

vi.mock('../../steps/LearnStep', () => stepMock('learn-step', '提交识记'))
vi.mock('../../steps/ReadStep', () => stepMock('read-step', '提交朗读'))
vi.mock('../../steps/SpellStep', () => stepMock('spell-step', '提交拼写'))
vi.mock('../../steps/WriteStep', () => stepMock('write-step', '提交默写'))

vi.mock('../../steps/PracticeStep', () => ({
  default: ({
    word,
    distractors,
    onComplete,
  }: {
    word: Word
    distractors: Word[]
    onComplete: (result: StepResult) => void
  }) => (
    <div data-testid="practice-step">
      <span>{word.word}</span>
      <span data-testid="distractors">
        {distractors.map((d) => d.word).join(',')}
      </span>
      <button
        type="button"
        onClick={() => onComplete({ correct: false, correctRate: 0, timeSpent: 8 })}
      >
        提交练习
      </button>
    </div>
  ),
}))

function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: `/ˈ${id}/`,
    pos: 'n.',
    definition: `${id} 释义`,
    example: `${id} example`,
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

interface Props {
  currentWord: Word
  currentStep: ReviewStep
  unlockedSteps: Set<ReviewStep>
  completedSteps: Set<ReviewStep>
  reviewQueue: Word[]
  goToStep: (step: ReviewStep) => void
  onBackToList: () => void
  onComplete: (step: ReviewStep, result: StepResult) => Promise<void>
}

function makeProps(overrides: Partial<Props> = {}): Props {
  const currentWord = makeWord('apple')
  return {
    currentWord,
    currentStep: 'learn',
    unlockedSteps: new Set(STEP_ORDER),
    completedSteps: new Set<ReviewStep>(),
    reviewQueue: [currentWord, makeWord('pear')],
    goToStep: vi.fn(),
    onBackToList: vi.fn(),
    onComplete: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('ReviewSessionView 复习会话视图', () => {
  it('识记步骤：渲染步骤内容、进度文案与 20% 进度条', () => {
    const props = makeProps()
    render(<ReviewSessionView {...props} />)

    expect(screen.getByRole('heading', { name: '单词复习' })).toBeInTheDocument()
    expect(screen.getByTestId('learn-step')).toBeInTheDocument()
    expect(screen.getByText('步骤 1/5 · 识记')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('按 currentStep 依次渲染朗读 / 练习 / 拼写 / 默写步骤', () => {
    const props = makeProps()
    const { rerender } = render(<ReviewSessionView {...props} />)

    rerender(<ReviewSessionView {...props} currentStep="read" />)
    expect(screen.getByTestId('read-step')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()

    rerender(<ReviewSessionView {...props} currentStep="practice" />)
    expect(screen.getByTestId('practice-step')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()

    rerender(<ReviewSessionView {...props} currentStep="spell" />)
    expect(screen.getByTestId('spell-step')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()

    rerender(<ReviewSessionView {...props} currentStep="write" />)
    expect(screen.getByTestId('write-step')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('练习步骤的干扰项排除当前词', () => {
    render(<ReviewSessionView {...makeProps({ currentStep: 'practice' })} />)

    expect(screen.getByTestId('distractors')).toHaveTextContent('pear')
    expect(screen.getByTestId('distractors')).not.toHaveTextContent('apple')
  })

  it('步骤完成时回调携带当前步骤与结果', () => {
    const onComplete = vi.fn(async () => {})
    render(<ReviewSessionView {...makeProps({ onComplete })} />)

    fireEvent.click(screen.getByRole('button', { name: '提交识记' }))

    expect(onComplete).toHaveBeenCalledWith('learn', {
      correct: true,
      correctRate: 1,
      timeSpent: 5,
    })
  })

  it('练习步骤完成时回调携带 practice 与结果', () => {
    const onComplete = vi.fn(async () => {})
    render(
      <ReviewSessionView {...makeProps({ currentStep: 'practice', onComplete })} />
    )

    fireEvent.click(screen.getByRole('button', { name: '提交练习' }))

    expect(onComplete).toHaveBeenCalledWith('practice', {
      correct: false,
      correctRate: 0,
      timeSpent: 8,
    })
  })

  it('点击提示按钮展示当前步骤提示，切换步骤后自动重置', () => {
    const props = makeProps()
    const { rerender } = render(<ReviewSessionView {...props} />)

    expect(
      screen.queryByText('仔细阅读词根词缀拆解与助记口诀，建立第一印象')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '显示提示（识记）' }))

    expect(
      screen.getByText('仔细阅读词根词缀拆解与助记口诀，建立第一印象')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提示已显示' })).toBeDisabled()

    rerender(<ReviewSessionView {...props} currentStep="read" />)

    expect(
      screen.queryByText('仔细阅读词根词缀拆解与助记口诀，建立第一印象')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '显示提示（朗读）' })).toBeEnabled()
  })

  it('点击返回列表触发回调', () => {
    const onBackToList = vi.fn()
    render(<ReviewSessionView {...makeProps({ onBackToList })} />)

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }))

    expect(onBackToList).toHaveBeenCalledTimes(1)
  })

  it('点击已解锁步骤导航切换步骤', () => {
    const goToStep = vi.fn()
    render(<ReviewSessionView {...makeProps({ goToStep })} />)

    fireEvent.click(screen.getByRole('button', { name: '步骤 2：朗读' }))

    expect(goToStep).toHaveBeenCalledWith('read')
  })
})
