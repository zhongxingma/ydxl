// 朗读步骤逻辑 hook
//
// 覆盖初始状态、语速切换、AI 拼读与本地降级、播放计时、录音评分、麦克风失败与完成回调。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import { aiProvider } from '@/shared/services/ai'
import {
  isMediaRecorderSupported,
  isSpeechSupported,
  speakWithTiming,
} from '@/shared/utils/speech'
import { useReadStep } from '../useReadStep'

vi.mock('@/shared/services/ai', () => ({
  aiProvider: {
    generateWordBreakdown: vi.fn(),
  },
}))

vi.mock('@/shared/utils/speech', () => ({
  isSpeechSupported: vi.fn(() => true),
  isMediaRecorderSupported: vi.fn(() => true),
  speakWithTiming: vi.fn(),
}))

const breakdownMock = vi.mocked(aiProvider.generateWordBreakdown)
const speechSupportedMock = vi.mocked(isSpeechSupported)
const recorderSupportedMock = vi.mocked(isMediaRecorderSupported)
const speakWithTimingMock = vi.mocked(speakWithTiming)

class MockMediaRecorder {
  static last: MockMediaRecorder
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onstop?.())

  constructor(public stream: unknown) {
    MockMediaRecorder.last = this
  }
}

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

function installRecorder(): { getUserMedia: ReturnType<typeof vi.fn>; stopTrack: ReturnType<typeof vi.fn> } {
  const stopTrack = vi.fn()
  const getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: stopTrack }],
  })
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  return { getUserMedia, stopTrack }
}

describe('useReadStep 朗读步骤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    speechSupportedMock.mockReturnValue(true)
    recorderSupportedMock.mockReturnValue(true)
    breakdownMock.mockResolvedValue({ phonics: ['ap', 'ple'], syllables: 2 })
    speakWithTimingMock.mockResolvedValue(1000)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window.navigator, 'mediaDevices')
  })

  it('初始状态：正常语速、无提示、波形条数至少 3', () => {
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    expect(result.current.speechSupported).toBe(true)
    expect(result.current.recorderSupported).toBe(true)
    expect(result.current.speed).toBe('normal')
    expect(result.current.hint).toBeNull()
    expect(result.current.hintLoading).toBe(false)
    expect(result.current.hintError).toBeNull()
    expect(result.current.recording).toBe(false)
    expect(result.current.recordedUrl).toBeNull()
    expect(result.current.score).toBeNull()
    expect(result.current.waveBars).toBe(3)
  })

  it('切换慢速后按 0.5 语速播放', async () => {
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    act(() => result.current.setSpeed('slow'))
    expect(result.current.speed).toBe('slow')

    await act(async () => {
      await result.current.handlePlay()
    })

    expect(speakWithTimingMock).toHaveBeenCalledWith('apple', 0.5)
  })

  it('AI 拼读成功：写入提示并按音节数更新波形', async () => {
    breakdownMock.mockResolvedValue({ phonics: ['beau', 'ti', 'ful'], syllables: 4 })
    const { result } = renderHook(() => useReadStep(makeWord({ word: 'beautiful' }), vi.fn()))

    await act(async () => {
      await result.current.handleShowHint()
    })

    expect(breakdownMock).toHaveBeenCalledWith('beautiful')
    expect(result.current.hint).toEqual({ phonics: ['beau', 'ti', 'ful'], syllables: 4 })
    expect(result.current.waveBars).toBe(4)
    expect(result.current.hintLoading).toBe(false)

    // 已有提示时重复点击不再调用 AI
    await act(async () => {
      await result.current.handleShowHint()
    })
    expect(breakdownMock).toHaveBeenCalledTimes(1)
  })

  it('AI 拼读失败：降级本地估算并提示', async () => {
    breakdownMock.mockRejectedValue(new Error('ai down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    await act(async () => {
      await result.current.handleShowHint()
    })

    expect(result.current.hint).toEqual({ phonics: ['a', 'pple'], syllables: 2 })
    expect(result.current.hintError).toBe('AI 拼读分解不可用，已切换本地估算')
    expect(warnSpy).toHaveBeenCalledWith(
      '[ReadStep] 获取拼读分解失败，降级本地估算',
      expect.any(Error),
    )
  })

  it('不支持语音时播放为空操作', async () => {
    speechSupportedMock.mockReturnValue(false)
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    await act(async () => {
      await result.current.handlePlay()
    })

    expect(speakWithTimingMock).not.toHaveBeenCalled()
    expect(result.current.speaking).toBe(false)
  })

  it('录音：开始与停止后生成回放地址并按标准时长评分', async () => {
    const { getUserMedia, stopTrack } = installRecorder()
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    // 先播放一次，得到标准时长 1000ms
    await act(async () => {
      await result.current.handlePlay()
    })

    now = 2000
    await act(async () => {
      await result.current.handleStartRecording()
    })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(result.current.recording).toBe(true)
    expect(MockMediaRecorder.last.start).toHaveBeenCalled()

    now = 2500
    act(() => {
      MockMediaRecorder.last.ondataavailable?.({ data: new Blob(['x']) })
      result.current.handleStopRecording()
    })

    expect(MockMediaRecorder.last.stop).toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
    expect(result.current.recordedUrl).toBe('blob:mock')
    // 录音 500ms / 标准 1000ms = 0.5 → 2 星
    expect(result.current.score).toBe(2)
    expect(stopTrack).toHaveBeenCalled()
  })

  it('录音失败：提示麦克风权限问题', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    vi.stubGlobal('MediaRecorder', MockMediaRecorder)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    await act(async () => {
      await result.current.handleStartRecording()
    })

    expect(result.current.hintError).toBe('无法访问麦克风，请检查浏览器权限')
    expect(result.current.recording).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith('[ReadStep] 启动录音失败', expect.any(Error))
  })

  it('不支持录音时不请求麦克风', async () => {
    const { getUserMedia } = installRecorder()
    recorderSupportedMock.mockReturnValue(false)
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    await act(async () => {
      await result.current.handleStartRecording()
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('未在录音时停止为空操作', () => {
    const { result } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    expect(() => result.current.handleStopRecording()).not.toThrow()
  })

  it('卸载时释放录音回放地址', async () => {
    installRecorder()
    const { result, unmount } = renderHook(() => useReadStep(makeWord(), vi.fn()))

    await act(async () => {
      await result.current.handleStartRecording()
    })
    act(() => {
      result.current.handleStopRecording()
    })
    expect(result.current.recordedUrl).toBe('blob:mock')

    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('完成本步：朗读视为全对', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useReadStep(makeWord(), onComplete))

    act(() => result.current.handleComplete())

    expect(onComplete).toHaveBeenCalledWith({
      correct: true,
      correctRate: 1,
      timeSpent: expect.any(Number),
    })
  })
})
