//
// 测试范围：
// 1. 初始状态：isPlaying=false、currentParagraph=-1、rate=1.0、isSupported=true
// 2. play() 设置 isPlaying=true 并推进 currentParagraph
// 3. pause() 设置 isPlaying=false
// 4. resume() 设置 isPlaying=true
// 5. stop() 重置 isPlaying=false、currentParagraph=-1
// 6. setRate() 更新 rate
// 7. 不支持语音合成时 isSupported=false，play 为 no-op
// 8. playParagraph 从指定段落开始
// 9. 组件卸载时调用 stop()（cleanup）
//
// Mock 策略：使用 vi.stubGlobal 替换 window.speechSynthesis 与 SpeechSynthesisUtterance

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArticleSpeech } from '../useArticleSpeech'

// ---------- Mock speechSynthesis ----------

const mockSpeak = vi.fn()
const mockCancel = vi.fn()
const mockPause = vi.fn()
const mockResume = vi.fn()
const mockGetVoices = vi.fn(() => [])

// Mock SpeechSynthesisUtterance 构造器
// 需模拟 text/rate/lang/voice/onend/onerror 属性
class MockUtterance {
  text: string
  rate = 1
  lang = ''
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

describe('useArticleSpeech', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('speechSynthesis', {
      speak: mockSpeak,
      cancel: mockCancel,
      pause: mockPause,
      resume: mockResume,
      getVoices: mockGetVoices,
    })
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
    // 触发 utterance.onend 模拟朗读完成
    mockSpeak.mockImplementation((utterance: MockUtterance) => {
      setTimeout(() => utterance.onend?.(), 0)
    })
    mockGetVoices.mockReturnValue([])
  })

  // 注意：不使用 afterEach unstub，因 testing-library 的 cleanup（afterEach LIFO 中
  // 晚于本 hook 注册、故先执行）卸载组件时仍需访问 speechSynthesis。
  // 改为 afterAll 统一清理，避免 React cleanup 时 speechSynthesis 已被移除。
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  // 1. 初始状态
  it('初始状态：isPlaying=false、currentParagraph=-1、rate=1.0、isSupported=true', () => {
    const { result } = renderHook(() => useArticleSpeech())

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentParagraph).toBe(-1)
    expect(result.current.rate).toBe(1.0)
    expect(result.current.isSupported).toBe(true)
  })

  // 2. play() 设置 isPlaying=true 并推进 currentParagraph
  it('play() 设置 isPlaying=true 并推进 currentParagraph', () => {
    const { result } = renderHook(() => useArticleSpeech())

    act(() => {
      result.current.play(['Hello', 'World'], 0)
    })

    // isPlaying 设为 true
    expect(result.current.isPlaying).toBe(true)
    // currentParagraph 从 -1 推进到 startIndex（0）
    expect(result.current.currentParagraph).toBe(0)
    // 验证为每个段落创建 utterance 并调用 speak
    expect(mockSpeak).toHaveBeenCalledTimes(2)
  })

  // 3. pause() 设置 isPlaying=false
  it('pause() 设置 isPlaying=false', () => {
    const { result } = renderHook(() => useArticleSpeech())

    act(() => {
      result.current.play(['Hello'], 0)
    })
    expect(result.current.isPlaying).toBe(true)

    act(() => {
      result.current.pause()
    })

    expect(result.current.isPlaying).toBe(false)
    expect(mockPause).toHaveBeenCalled()
  })

  // 4. resume() 设置 isPlaying=true
  it('resume() 设置 isPlaying=true', () => {
    const { result } = renderHook(() => useArticleSpeech())

    act(() => {
      result.current.play(['Hello'], 0)
    })
    act(() => {
      result.current.pause()
    })
    expect(result.current.isPlaying).toBe(false)

    act(() => {
      result.current.resume()
    })

    expect(result.current.isPlaying).toBe(true)
    expect(mockResume).toHaveBeenCalled()
  })

  // 5. stop() 重置 isPlaying=false、currentParagraph=-1
  it('stop() 重置 isPlaying=false、currentParagraph=-1', () => {
    const { result } = renderHook(() => useArticleSpeech())

    act(() => {
      result.current.play(['Hello', 'World'], 0)
    })
    expect(result.current.isPlaying).toBe(true)
    expect(result.current.currentParagraph).toBe(0)

    act(() => {
      result.current.stop()
    })

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentParagraph).toBe(-1)
    expect(mockCancel).toHaveBeenCalled()
  })

  // 6. setRate() 更新 rate
  it('setRate() 更新 rate', () => {
    const { result } = renderHook(() => useArticleSpeech())

    expect(result.current.rate).toBe(1.0)

    act(() => {
      result.current.setRate(1.5)
    })

    expect(result.current.rate).toBe(1.5)
  })

  // 7. 不支持语音合成时 isSupported=false，play 为 no-op
  it('不支持语音合成时 isSupported=false，play 为 no-op', () => {
    // 移除 speechSynthesis stub 模拟不支持的环境
    vi.unstubAllGlobals()
    // setup.ts 在全局安装了 speechSynthesis fallback stub（供 WordPopover 等组件测试使用），
    // vi.unstubAllGlobals 仅撤销 vi.stubGlobal 注册的值，不会移除 setup.ts 通过
    // Object.defineProperty 安装的属性。这里显式删除以真正模拟不支持语音合成的环境。
    delete (window as { speechSynthesis?: unknown }).speechSynthesis

    const { result } = renderHook(() => useArticleSpeech())

    expect(result.current.isSupported).toBe(false)

    act(() => {
      result.current.play(['Hello'], 0)
    })

    // play 为 no-op：状态保持初始值
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentParagraph).toBe(-1)
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  // 8. playParagraph 从指定段落开始
  it('playParagraph 从指定段落开始', () => {
    const { result } = renderHook(() => useArticleSpeech())

    act(() => {
      result.current.playParagraph(['A', 'B', 'C'], 1)
    })

    expect(result.current.isPlaying).toBe(true)
    // currentParagraph 从指定索引 1 开始
    expect(result.current.currentParagraph).toBe(1)
    // 从段落 1 开始，应 speak 2 次（B 和 C）
    expect(mockSpeak).toHaveBeenCalledTimes(2)
  })

  // 9. 组件卸载时调用 stop()（cleanup）
  it('组件卸载时调用 stop()（cleanup）', () => {
    const { result, unmount } = renderHook(() => useArticleSpeech())

    act(() => {
      result.current.play(['Hello'], 0)
    })
    // play 时已 cancel 一次（清理旧队列），重置计数以便验证卸载时的 cancel
    mockCancel.mockClear()

    act(() => {
      unmount()
    })

    // 卸载时应调用 stop → speechSynthesis.cancel
    expect(mockCancel).toHaveBeenCalled()
  })
})
