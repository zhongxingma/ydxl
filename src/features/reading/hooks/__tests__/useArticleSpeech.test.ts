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
const mockGetVoices = vi.fn<() => SpeechSynthesisVoice[]>(() => [])

// 构造最小语音对象（仅需 lang / name 供选择逻辑使用）
function makeVoice(lang: string, name = lang): SpeechSynthesisVoice {
  return { lang, name } as unknown as SpeechSynthesisVoice
}

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
    mockCancel.mockImplementation(() => {})
    mockPause.mockImplementation(() => {})
    mockResume.mockImplementation(() => {})
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

  // 10. 语音选择优先级：en-US > en-GB > 任意 en > null
  it('语音选择按 en-US / en-GB / en 前缀 / null 依次降级', () => {
    const spoken: MockUtterance[] = []
    mockSpeak.mockImplementation((u: MockUtterance) => {
      spoken.push(u)
    })
    const { result } = renderHook(() => useArticleSpeech())

    mockGetVoices.mockReturnValue([
      makeVoice('fr-FR', 'fr'),
      makeVoice('en-GB', 'gb'),
      makeVoice('en-US', 'us'),
    ])
    act(() => result.current.play(['A']))
    expect((spoken[0].voice as { name: string }).name).toBe('us')

    mockGetVoices.mockReturnValue([makeVoice('fr-FR', 'fr'), makeVoice('en-GB', 'gb')])
    act(() => result.current.play(['B']))
    expect((spoken[1].voice as { name: string }).name).toBe('gb')

    mockGetVoices.mockReturnValue([makeVoice('fr-FR', 'fr'), makeVoice('en-AU', 'au')])
    act(() => result.current.play(['C']))
    expect((spoken[2].voice as { name: string }).name).toBe('au')

    mockGetVoices.mockReturnValue([makeVoice('fr-FR', 'fr')])
    act(() => result.current.play(['D']))
    expect(spoken[3].voice).toBeNull()

    expect(mockGetVoices).toHaveBeenCalledTimes(4)
  })

  // 11. getVoices 抛错：记录警告并回退默认语音
  it('getVoices 抛错时记录警告并继续朗读', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetVoices.mockImplementation(() => {
      throw new Error('voices unavailable')
    })
    const spoken: MockUtterance[] = []
    mockSpeak.mockImplementation((u: MockUtterance) => {
      spoken.push(u)
    })
    const { result } = renderHook(() => useArticleSpeech())

    act(() => result.current.play(['Hello']))

    expect(warnSpy).toHaveBeenCalledWith(
      '[useArticleSpeech] 获取 voices 失败',
      expect.any(Error)
    )
    expect(spoken).toHaveLength(1)
    expect(spoken[0].voice).toBeNull()
    expect(result.current.isPlaying).toBe(true)
    warnSpy.mockRestore()
  })

  // 12. onend 推进段落，最后一段结束后复位
  it('onend 逐段推进 currentParagraph，最后一段结束复位', () => {
    const spoken: MockUtterance[] = []
    mockSpeak.mockImplementation((u: MockUtterance) => {
      spoken.push(u)
    })
    const { result } = renderHook(() => useArticleSpeech())

    act(() => result.current.play(['A', 'B', 'C'], 0))
    expect(result.current.currentParagraph).toBe(0)

    act(() => spoken[0].onend?.())
    expect(result.current.currentParagraph).toBe(1)
    expect(result.current.isPlaying).toBe(true)

    act(() => spoken[2].onend?.())
    expect(result.current.currentParagraph).toBe(-1)
    expect(result.current.isPlaying).toBe(false)
  })

  // 13. onerror 同样推进，最后一段出错后复位并记录警告
  it('onerror 推进段落并记录警告，最后一段出错后复位', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spoken: MockUtterance[] = []
    mockSpeak.mockImplementation((u: MockUtterance) => {
      spoken.push(u)
    })
    const { result } = renderHook(() => useArticleSpeech())

    act(() => result.current.play(['A', 'B'], 0))
    act(() => spoken[0].onerror?.(new Error('synth error')))
    expect(result.current.currentParagraph).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith('[useArticleSpeech] utterance 错误', expect.any(Error))

    act(() => spoken[1].onerror?.(new Error('synth error')))
    expect(result.current.currentParagraph).toBe(-1)
    expect(result.current.isPlaying).toBe(false)
    warnSpy.mockRestore()
  })

  // 14. stop 后旧队列回调因 token 不匹配被丢弃
  it('stop 后旧队列的 onend / onerror 回调被丢弃', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spoken: MockUtterance[] = []
    mockSpeak.mockImplementation((u: MockUtterance) => {
      spoken.push(u)
    })
    const { result } = renderHook(() => useArticleSpeech())

    act(() => result.current.play(['A', 'B'], 0))
    act(() => result.current.stop())
    expect(result.current.currentParagraph).toBe(-1)

    act(() => {
      spoken[0].onend?.()
      spoken[1].onerror?.(new Error('late error'))
    })

    expect(result.current.currentParagraph).toBe(-1)
    expect(result.current.isPlaying).toBe(false)
    // 过期回调不应产生错误警告
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // 15. cancel 抛错：play / stop 均记录警告但不阻断流程
  it('cancel 抛错时 play 与 stop 记录警告且状态仍正确', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockCancel.mockImplementation(() => {
      throw new Error('cancel failed')
    })
    const { result } = renderHook(() => useArticleSpeech())

    act(() => result.current.play(['A'], 0))
    expect(warnSpy).toHaveBeenCalledWith(
      '[useArticleSpeech] play 前 cancel 失败',
      expect.any(Error)
    )
    expect(result.current.isPlaying).toBe(true)

    act(() => result.current.stop())
    expect(warnSpy).toHaveBeenCalledWith('[useArticleSpeech] stop 失败', expect.any(Error))
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentParagraph).toBe(-1)

    // 恢复 cancel，避免卸载 cleanup 再次抛出
    mockCancel.mockImplementation(() => {})
    warnSpy.mockRestore()
  })

  // 16. speak 抛错：记录警告并继续排队后续段落
  it('speak 抛错时记录警告并继续朗读后续段落', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSpeak
      .mockImplementationOnce(() => {
        throw new Error('speak failed')
      })
      .mockImplementation(() => {})
    const { result } = renderHook(() => useArticleSpeech())

    act(() => result.current.play(['A', 'B'], 0))

    expect(warnSpy).toHaveBeenCalledWith('[useArticleSpeech] speak 失败', expect.any(Error))
    expect(mockSpeak).toHaveBeenCalledTimes(2)
    expect(result.current.isPlaying).toBe(true)
    warnSpy.mockRestore()
  })

  // 17. pause / resume 抛错：记录警告但状态仍按调用意图更新
  it('pause / resume 抛错时记录警告但状态仍更新', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useArticleSpeech())
    act(() => result.current.play(['A'], 0))

    mockPause.mockImplementation(() => {
      throw new Error('pause failed')
    })
    act(() => result.current.pause())
    expect(warnSpy).toHaveBeenCalledWith('[useArticleSpeech] pause 失败', expect.any(Error))
    expect(result.current.isPlaying).toBe(false)

    mockResume.mockImplementation(() => {
      throw new Error('resume failed')
    })
    act(() => result.current.resume())
    expect(warnSpy).toHaveBeenCalledWith('[useArticleSpeech] resume 失败', expect.any(Error))
    expect(result.current.isPlaying).toBe(true)
    warnSpy.mockRestore()
  })

  // 18. 播放中调整语速：停止后延迟从当前段落以新语速重播
  it('播放中调整语速会停止并以新语速从当前段落重播', () => {
    vi.useFakeTimers()
    try {
      const spoken: MockUtterance[] = []
      mockSpeak.mockImplementation((u: MockUtterance) => {
        spoken.push(u)
      })
      const { result } = renderHook(() => useArticleSpeech())

      act(() => result.current.play(['A', 'B', 'C'], 0))
      expect(mockSpeak).toHaveBeenCalledTimes(3)

      act(() => result.current.setRate(1.5))

      expect(result.current.rate).toBe(1.5)
      // 立即停止，等待 50ms 后从当前段落重播
      expect(result.current.isPlaying).toBe(false)
      expect(result.current.currentParagraph).toBe(-1)

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(mockSpeak).toHaveBeenCalledTimes(6)
      const replay = spoken.slice(3)
      expect(replay.map((u) => u.text)).toEqual(['A', 'B', 'C'])
      expect(replay.every((u) => u.rate === 1.5)).toBe(true)
      expect(result.current.isPlaying).toBe(true)
      expect(result.current.currentParagraph).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
