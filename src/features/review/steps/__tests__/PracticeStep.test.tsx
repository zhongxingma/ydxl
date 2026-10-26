// 复习第三步「练习」组件
//
// 覆盖题目渲染、正确/错误反馈与推进、错题自动跳转与顽固词累加、提示递进、
// 发音播放、题目未生成兜底与卸载清理定时器。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import type { Question } from '../practiceQuestionGenerator'
import { generateQuestions } from '../practiceQuestionGenerator'
import PracticeStep from '../PracticeStep'

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

vi.mock('../practiceQuestionGenerator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../practiceQuestionGenerator')>()
  return {
    ...actual,
    generateQuestions: vi.fn(),
    // 提示排除选项需确定性：以原顺序返回
    shuffle: vi.fn(function shuffle<T>(arr: T[]) {
      return arr.slice()
    }),
  }
})

const getByIdMock = vi.mocked(wordRepository.getByIdLocalFirst)
const updateMock = vi.mocked(wordRepository.update)
const speechSupportedMock = vi.mocked(isSpeechSupported)
const speakMock = vi.mocked(speak)
const generateMock = vi.mocked(generateQuestions)

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

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    type: 'def-to-word',
    stem: '下列哪个单词的意思是「苹果」？',
    options: ['apple', 'banana', 'orange', 'grape'],
    correctIndex: 0,
    eliminated: new Set<number>(),
    letterHintShown: false,
    ...overrides,
  }
}

const secondQuestion = makeQuestion({
  type: 'word-to-def',
  stem: '单词「book」的中文释义是？',
  options: ['书', '笔', '桌子', '椅子'],
})

describe('PracticeStep 练习步骤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    speechSupportedMock.mockReturnValue(false)
    getByIdMock.mockResolvedValue(makeWord({ stubbornCount: 2 }))
    updateMock.mockResolvedValue(makeWord())
    generateMock.mockReturnValue([makeQuestion(), secondQuestion])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始渲染：展示进度、题型、题干与四个选项', () => {
    const word = makeWord()
    render(<PracticeStep word={word} distractors={[]} onComplete={vi.fn()} />)

    expect(screen.getByText('第 1 / 2 题')).toBeInTheDocument()
    expect(screen.getByText('释义 → 单词')).toBeInTheDocument()
    expect(screen.getByText('下列哪个单词的意思是「苹果」？')).toBeInTheDocument()
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('banana')).toBeInTheDocument()
    expect(screen.getByText('orange')).toBeInTheDocument()
    expect(screen.getByText('grape')).toBeInTheDocument()
    expect(generateMock).toHaveBeenCalledWith(word, [])
  })

  it('答对：展示正确反馈与下一题按钮，全部答对后回调 correctRate=1', () => {
    const onComplete = vi.fn()
    render(<PracticeStep word={makeWord()} onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /apple/ }))
    expect(screen.getByText('✓ 回答正确！')).toBeInTheDocument()
    expect(screen.getByText(/已答对 1 \/ 2 题/)).toBeInTheDocument()
    // 正确答案需手动推进
    expect(screen.queryByText(/自动进入下一题/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /下一题/ }))
    expect(screen.getByText('第 2 / 2 题')).toBeInTheDocument()
    expect(screen.getByText('单词「book」的中文释义是？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /书/ }))
    fireEvent.click(screen.getByRole('button', { name: /完成本步/ }))

    expect(onComplete).toHaveBeenCalledWith({
      correct: true,
      correctRate: 1,
      timeSpent: expect.any(Number),
    })
  })

  it('答错：红色反馈、累加顽固词并在 1.5 秒后自动进入下一题', async () => {
    vi.useFakeTimers()
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /banana/ }))

    expect(screen.getByText('✗ 答错了，再接再厉')).toBeInTheDocument()
    expect(screen.getByText('1.5 秒后自动进入下一题…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /下一题/ })).not.toBeInTheDocument()

    await act(async () => {
      await Promise.resolve()
    })
    expect(getByIdMock).toHaveBeenCalledWith('w1')
    expect(updateMock).toHaveBeenCalledWith('w1', { stubbornCount: 3 })

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText('第 2 / 2 题')).toBeInTheDocument()
  })

  it('答错后卸载：清理自动推进定时器', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const { unmount } = render(<PracticeStep word={makeWord()} onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /banana/ }))
    unmount()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('顽固词更新失败仅告警', async () => {
    getByIdMock.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /banana/ }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[PracticeStep] 更新顽固词计数失败',
      expect.any(Error),
    )
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('提示递进：先排除两个错误选项，再显示首字母', () => {
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /排除干扰项/ }))
    expect(screen.getByRole('button', { name: /banana/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /orange/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /grape/ })).toBeEnabled()

    // 点击被排除选项不会作答
    fireEvent.click(screen.getByRole('button', { name: /banana/ }))
    expect(screen.queryByText(/回答正确/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /显示首字母/ }))
    expect(screen.getByText('提示：首字母是「A」')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /显示首字母/ })).not.toBeInTheDocument()
  })

  it('听音选义题：支持语音时展示并触发播放发音', () => {
    speechSupportedMock.mockReturnValue(true)
    generateMock.mockReturnValue([
      makeQuestion({
        type: 'listen-choose-def',
        stem: '🔊 听发音，选出对应的中文释义',
        options: ['苹果', '香蕉', '橙子', '葡萄'],
        stemAudio: 'apple',
      }),
    ])
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /播放发音/ }))
    expect(speakMock).toHaveBeenCalledWith('apple')
  })

  it('听音选义题：不支持语音时不展示播放按钮', () => {
    generateMock.mockReturnValue([
      makeQuestion({
        type: 'listen-choose-def',
        stem: '🔊 听发音，选出对应的中文释义',
        options: ['苹果', '香蕉', '橙子', '葡萄'],
        stemAudio: 'apple',
      }),
    ])
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /播放发音/ })).not.toBeInTheDocument()
  })

  it('看义选音题：选项试听只播放发音不选中答案', () => {
    speechSupportedMock.mockReturnValue(true)
    generateMock.mockReturnValue([
      makeQuestion({
        type: 'def-choose-word',
        stem: '哪个单词表示「苹果」？点击可试听',
        optionAudio: true,
      }),
    ])
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '试听 grape' }))
    expect(speakMock).toHaveBeenCalledWith('grape')
    // 试听不应触发作答
    expect(screen.queryByText(/回答正确/)).not.toBeInTheDocument()
  })

  it('题目为空时展示生成中占位', () => {
    generateMock.mockReturnValue([])
    render(<PracticeStep word={makeWord()} onComplete={vi.fn()} />)

    expect(screen.getByText('正在生成题目...')).toBeInTheDocument()
  })
})
