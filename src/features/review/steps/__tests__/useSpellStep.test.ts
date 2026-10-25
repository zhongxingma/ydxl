// 拼写步骤逻辑 hook
//
// 覆盖初始状态、分级提示、键盘输入、正确 / 错误提交、放弃、顽固词计数与定时器清理。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import { useSpellStep } from '../useSpellStep'
import { getMask } from '../spellHint'

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
    example: 'an apple',
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

function submitEvent(): React.FormEvent {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent
}

describe('useSpellStep 拼写步骤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    speechSupportedMock.mockReturnValue(false)
    getByIdMock.mockResolvedValue({ stubbornCount: 2 } as Word)
    updateMock.mockResolvedValue(makeWord())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('初始状态：无提示、无遮罩、提示文案为「显示首尾字母」', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useSpellStep(makeWord(), onComplete))

    expect(result.current.input).toBe('')
    expect(result.current.hintLevel).toBe(0)
    expect(result.current.mask).toBe('')
    expect(result.current.highlightedLetters).toBeUndefined()
    expect(result.current.hintLabel).toBe('显示首尾字母')
    expect(result.current.isCorrect).toBe(false)
    expect(result.current.submitted).toBe(false)
    expect(result.current.speechSupported).toBe(false)
  })

  it('支持语音时挂载 200ms 后自动朗读；卸载清理定时器', () => {
    speechSupportedMock.mockReturnValue(true)
    const { unmount } = renderHook(() => useSpellStep(makeWord(), vi.fn()))

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(speakMock).toHaveBeenCalledWith('apple')

    speakMock.mockClear()
    const second = renderHook(() => useSpellStep(makeWord({ id: 'w2' }), vi.fn()))
    second.unmount()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(speakMock).not.toHaveBeenCalled()
    unmount()
  })

  it('分级提示：首尾 → 元音 → 键盘高亮 → 闪现完整单词', () => {
    const { result } = renderHook(() => useSpellStep(makeWord(), vi.fn()))

    act(() => result.current.handleHint())
    expect(result.current.hintLevel).toBe(1)
    expect(result.current.mask).toBe(getMask('apple', 1))
    expect(result.current.hintLabel).toBe('显示元音')

    act(() => result.current.handleHint())
    expect(result.current.hintLevel).toBe(2)
    expect(result.current.mask).toBe(getMask('apple', 2))
    expect(result.current.hintLabel).toBe('键盘高亮')

    act(() => result.current.handleHint())
    expect(result.current.hintLevel).toBe(3)
    expect(result.current.highlightedLetters).toEqual(new Set(['a', 'p', 'l', 'e']))
    expect(result.current.hintLabel).toBe('查看完整单词')

    act(() => result.current.handleHint())
    expect(result.current.showFlash).toBe(true)
    expect(result.current.flashKey).toBe(1)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.showFlash).toBe(false)
  })

  it('键盘输入：追加字母与退格，提交后不再接受输入', () => {
    const { result } = renderHook(() => useSpellStep(makeWord(), vi.fn()))

    act(() => result.current.handleKeyPress('a'))
    act(() => result.current.handleKeyPress('p'))
    expect(result.current.input).toBe('ap')

    act(() => result.current.handleBackspace())
    expect(result.current.input).toBe('a')

    act(() => result.current.setInput('apple'))
    act(() => result.current.handleSubmit(submitEvent()))
    expect(result.current.submitted).toBe(true)

    act(() => result.current.handleKeyPress('x'))
    act(() => result.current.handleBackspace())
    expect(result.current.input).toBe('apple')
  })

  it('输入为空时提交不触发完成回调', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useSpellStep(makeWord(), onComplete))

    act(() => result.current.handleSubmit(submitEvent()))

    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.submitted).toBe(false)
  })

  it('拼写正确：提交后回调 correct=true 且 correctRate=1', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useSpellStep(makeWord(), onComplete))
    act(() => result.current.setInput('APPLE'))

    act(() => result.current.handleSubmit(submitEvent()))

    expect(onComplete).toHaveBeenCalledWith({
      correct: true,
      correctRate: 1,
      timeSpent: expect.any(Number),
    })
    expect(result.current.submitted).toBe(true)
  })

  it('拼写错误：抖动、闪现、错误计数并累加顽固词', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useSpellStep(makeWord(), onComplete))
    act(() => result.current.setInput('aple'))

    act(() => result.current.handleSubmit(submitEvent()))

    expect(result.current.wrongCount).toBe(1)
    expect(result.current.shaking).toBe(true)
    expect(result.current.showFlash).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getByIdMock).toHaveBeenCalledWith('w1')
    expect(updateMock).toHaveBeenCalledWith('w1', { stubbornCount: 3 })

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(result.current.shaking).toBe(false)

    act(() => {
      vi.advanceTimersByTime(80)
    })
    expect(result.current.showFlash).toBe(false)
  })

  it('顽固词计数更新失败仅告警', async () => {
    getByIdMock.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useSpellStep(makeWord(), vi.fn()))
    act(() => result.current.setInput('x'))

    act(() => result.current.handleSubmit(submitEvent()))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[SpellStep] 更新顽固词计数失败',
      expect.any(Error),
    )
  })

  it('放弃：视为全错回调 correctRate=0 并累加顽固词', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useSpellStep(makeWord(), onComplete))

    act(() => result.current.handleGiveUp())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onComplete).toHaveBeenCalledWith({
      correct: false,
      correctRate: 0,
      timeSpent: expect.any(Number),
    })
    expect(result.current.submitted).toBe(true)
    expect(updateMock).toHaveBeenCalledWith('w1', { stubbornCount: 3 })
  })
})
