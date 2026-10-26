// 语音合成工具
//
// 覆盖 API 支持性检测、普通朗读、计时朗读（onend / onerror）、失败降级与媒体录制支持检测。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isSpeechSupported,
  isMediaRecorderSupported,
  speak,
  speakWithTiming,
} from '../speech'

class MockUtterance {
  static instances: MockUtterance[] = []
  text: string
  rate = 1
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
    MockUtterance.instances.push(this)
  }
}

const speechSynthesisMock = {
  cancel: vi.fn(),
  speak: vi.fn(),
}

function removeSpeech(): void {
  Reflect.deleteProperty(window, 'speechSynthesis')
}

function removeMediaRecorder(): void {
  Reflect.deleteProperty(window, 'MediaRecorder')
  Reflect.deleteProperty(window.navigator, 'mediaDevices')
}

describe('speech 语音合成工具', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUtterance.instances = []
    removeSpeech()
    removeMediaRecorder()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    removeSpeech()
    removeMediaRecorder()
  })

  it('不支持 speechSynthesis 时检测为 false', () => {
    expect(isSpeechSupported()).toBe(false)
  })

  it('支持 speechSynthesis 时检测为 true', () => {
    vi.stubGlobal('speechSynthesis', speechSynthesisMock)
    expect(isSpeechSupported()).toBe(true)
  })

  it('不支持 MediaRecorder / getUserMedia 时检测为 false', () => {
    expect(isMediaRecorderSupported()).toBe(false)
  })

  it('同时支持 MediaRecorder 与 getUserMedia 时检测为 true', () => {
    vi.stubGlobal('MediaRecorder', class {})
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    })

    expect(isMediaRecorderSupported()).toBe(true)
  })

  it('不支持语音时 speak 告警且不调用 API', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    speak('apple')

    expect(warnSpy).toHaveBeenCalledWith('[speech] 当前浏览器不支持语音合成')
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled()
  })

  it('speak：取消旧队列并按语速朗读英文', () => {
    vi.stubGlobal('speechSynthesis', speechSynthesisMock)
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)

    speak('apple', 0.5)

    expect(speechSynthesisMock.cancel).toHaveBeenCalledTimes(1)
    expect(MockUtterance.instances).toHaveLength(1)
    expect(MockUtterance.instances[0].text).toBe('apple')
    expect(MockUtterance.instances[0].rate).toBe(0.5)
    expect(MockUtterance.instances[0].lang).toBe('en-US')
    expect(speechSynthesisMock.speak).toHaveBeenCalledWith(MockUtterance.instances[0])
  })

  it('speak：构造或播放抛错时告警', () => {
    vi.stubGlobal('speechSynthesis', speechSynthesisMock)
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor() {
          throw new Error('utterance failed')
        }
      },
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    speak('apple')

    expect(warnSpy).toHaveBeenCalledWith('[speech] 朗读失败', expect.any(Error))
  })

  it('speakWithTiming：不支持语音时返回 0', async () => {
    await expect(speakWithTiming('apple')).resolves.toBe(0)
  })

  it('speakWithTiming：onend 返回实际耗时', async () => {
    vi.stubGlobal('speechSynthesis', speechSynthesisMock)
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const pending = speakWithTiming('apple', 0.5)
    const utterance = MockUtterance.instances[0]
    expect(speechSynthesisMock.cancel).toHaveBeenCalled()
    expect(utterance.rate).toBe(0.5)
    expect(utterance.lang).toBe('en-US')

    now = 1350
    utterance.onend?.()

    await expect(pending).resolves.toBe(350)
    expect(utterance.onend).toBeNull()
    expect(utterance.onerror).toBeNull()
  })

  it('speakWithTiming：onerror 返回 0', async () => {
    vi.stubGlobal('speechSynthesis', speechSynthesisMock)
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)

    const pending = speakWithTiming('apple')
    MockUtterance.instances[0].onerror?.()

    await expect(pending).resolves.toBe(0)
  })

  it('speakWithTiming：播放抛错时告警并返回 0', async () => {
    vi.stubGlobal('speechSynthesis', {
      cancel: vi.fn(),
      speak: vi.fn(() => {
        throw new Error('speak failed')
      }),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(speakWithTiming('apple')).resolves.toBe(0)
    expect(warnSpy).toHaveBeenCalledWith('[speech] 计时朗读失败', expect.any(Error))
  })
})
