// 全文朗读 hook：封装 Web Speech API 的多段排队朗读能力
// - 支持 play / pause / resume / stop / setRate / playParagraph
// - 通过 ref 保存 utterance 引用，避免被 GC 导致 onend 不触发
// - 通过 token 机制丢弃旧队列的回调，防止 stop 后旧 onend 误推进状态
// - 组件卸载时自动 stop，避免内存泄漏与卸载后 setState
import { useCallback, useEffect, useRef, useState } from 'react'

/** useArticleSpeech hook 的返回值 */
export interface UseArticleSpeechReturn {
  /** 是否正在朗读 */
  isPlaying: boolean
  /** 当前朗读段落索引，-1 表示未开始 */
  currentParagraph: number
  /** 语速，默认 1.0 */
  rate: number
  /** 当前浏览器是否支持语音合成 */
  isSupported: boolean
  /** 从指定段落开始全文朗读 */
  play: (paragraphs: string[], startIndex?: number) => void
  /** 暂停朗读 */
  pause: () => void
  /** 恢复朗读 */
  resume: () => void
  /** 停止朗读并重置状态 */
  stop: () => void
  /** 设置语速；播放中调整会停止当前播放并从当前段落以新语速重播 */
  setRate: (rate: number) => void
  /** 朗读指定段落（从该段开始往后串联） */
  playParagraph: (paragraphs: string[], index: number) => void
}

/**
 * 文章全文朗读 hook
 *
 * 串联排队多个 SpeechSynthesisUtterance 实现整篇文章的连续朗读，
 * 维护 isPlaying / currentParagraph / rate 状态供 UI 消费。
 * 不支持语音合成的环境下所有方法为 no-op，isPlaying 始终 false。
 */
export function useArticleSpeech(): UseArticleSpeechReturn {
  // 浏览器支持判断：SSR 安全
  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentParagraph, setCurrentParagraph] = useState(-1)
  const [rate, setRateState] = useState(1.0)

  // 保存当前队列所有 utterance 引用，防止 GC 导致 onend 不触发
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([])
  // 队列令牌：每次 play/stop 自增，旧队列回调检测到 token 不匹配即返回
  const tokenRef = useRef(0)
  // 当前播放的段落列表，供 setRate 重播时读取
  const paragraphsRef = useRef<string[] | null>(null)
  // 最新语速，供 createUtterance 同步读取（避免闭包陈旧）
  const rateRef = useRef(rate)

  /**
   * 选择英文语音：优先 en-US，其次 en-GB，最后任意 en 开头
   * getVoices() 在部分浏览器首次调用返回空数组，此时返回 null 让浏览器选默认
   */
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (!isSupported) return null
    try {
      const voices = window.speechSynthesis.getVoices()
      if (!voices || voices.length === 0) return null
      return (
        voices.find((v) => v.lang === 'en-US') ??
        voices.find((v) => v.lang === 'en-GB') ??
        voices.find((v) => v.lang.startsWith('en')) ??
        null
      )
    } catch (err) {
      console.warn('[useArticleSpeech] 获取 voices 失败', err)
      return null
    }
  }, [isSupported])

  /**
   * 创建单个段落的 utterance，绑定 onend/onerror 回调
   * @param text 段落文本
   * @param index 该段落在全文章中的绝对索引
   * @param total 全文段落数
   * @param token 当前队列令牌，用于判断回调是否过期
   */
  const createUtterance = useCallback(
    (
      text: string,
      index: number,
      total: number,
      token: number,
    ): SpeechSynthesisUtterance => {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = rateRef.current
      u.lang = 'en-US'
      const voice = pickVoice()
      if (voice) u.voice = voice

      // 段落朗读结束：推进 currentParagraph，若已是最后一段则停止
      u.onend = () => {
        // token 不匹配说明已被新队列取消，丢弃本次回调
        if (tokenRef.current !== token) return
        if (index + 1 >= total) {
          setIsPlaying(false)
          setCurrentParagraph(-1)
          utterancesRef.current = []
        } else {
          setCurrentParagraph(index + 1)
        }
      }

      // 段落朗读出错：同样推进，避免队列卡死
      u.onerror = (e) => {
        if (tokenRef.current !== token) return
        console.warn('[useArticleSpeech] utterance 错误', e)
        if (index + 1 >= total) {
          setIsPlaying(false)
          setCurrentParagraph(-1)
          utterancesRef.current = []
        } else {
          setCurrentParagraph(index + 1)
        }
      }
      return u
    },
    [pickVoice],
  )

  /**
   * 停止朗读并重置状态
   * 自增 token 使旧队列的 onend/onerror 回调失效
   */
  const stop = useCallback(() => {
    if (!isSupported) return
    tokenRef.current += 1
    try {
      window.speechSynthesis.cancel()
    } catch (err) {
      console.warn('[useArticleSpeech] stop 失败', err)
    }
    utterancesRef.current = []
    setIsPlaying(false)
    setCurrentParagraph(-1)
  }, [isSupported])

  /**
   * 从指定段落开始全文朗读
   * 先清理之前队列，再从 startIndex 串联排队后续所有段落
   */
  const play = useCallback(
    (paragraphs: string[], startIndex = 0) => {
      if (!isSupported || paragraphs.length === 0) return
      // 保存当前播放列表，供 setRate 重播时读取
      paragraphsRef.current = paragraphs
      // 先清理：自增 token 使旧队列回调失效
      tokenRef.current += 1
      const token = tokenRef.current
      try {
        window.speechSynthesis.cancel()
      } catch (err) {
        console.warn('[useArticleSpeech] play 前 cancel 失败', err)
      }
      utterancesRef.current = []

      setIsPlaying(true)
      setCurrentParagraph(startIndex)

      const utterances: SpeechSynthesisUtterance[] = []
      for (let i = startIndex; i < paragraphs.length; i += 1) {
        const u = createUtterance(paragraphs[i], i, paragraphs.length, token)
        utterances.push(u)
        try {
          window.speechSynthesis.speak(u)
        } catch (err) {
          console.warn('[useArticleSpeech] speak 失败', err)
        }
      }
      utterancesRef.current = utterances
    },
    [isSupported, createUtterance],
  )

  /** 暂停朗读 */
  const pause = useCallback(() => {
    if (!isSupported) return
    try {
      window.speechSynthesis.pause()
    } catch (err) {
      console.warn('[useArticleSpeech] pause 失败', err)
    }
    setIsPlaying(false)
  }, [isSupported])

  /** 恢复朗读 */
  const resume = useCallback(() => {
    if (!isSupported) return
    try {
      window.speechSynthesis.resume()
    } catch (err) {
      console.warn('[useArticleSpeech] resume 失败', err)
    }
    setIsPlaying(true)
  }, [isSupported])

  /** 设置语速：立即更新 ref；播放中调整会停止当前播放并从当前段落以新语速重播 */
  const setRate = useCallback((newRate: number) => {
    // 立即更新 ref，确保后续 createUtterance 同步读取到新语速
    rateRef.current = newRate
    setRateState(newRate)
    // 播放中调整语速：停止后以新语速从当前段落重播
    if (isPlaying) {
      const currentIdx = currentParagraph
      const paragraphs = paragraphsRef.current
      stop()
      if (paragraphs && paragraphs.length > 0 && currentIdx >= 0) {
        // 延迟一帧确保 stop 完成后再重播
        window.setTimeout(() => play(paragraphs, currentIdx), 50)
      }
    }
  }, [isPlaying, currentParagraph, play, stop])

  /** 朗读指定段落：从该段开始往后串联 */
  const playParagraph = useCallback(
    (paragraphs: string[], index: number) => {
      play(paragraphs, index)
    },
    [play],
  )

  // 组件卸载时调用 stop，避免内存泄漏与卸载后 setState
  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    isPlaying,
    currentParagraph,
    rate,
    isSupported,
    play,
    pause,
    resume,
    stop,
    setRate,
    playParagraph,
  }
}
