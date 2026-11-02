// 语音合成工具：封装 Web Speech API 的发音功能
// 使用前必须检查浏览器支持，避免在不支持的环境下抛错
// 该工具为纯浏览器 API 封装，无业务依赖，供 reading/review/wordbook 等模块共享

// 检查浏览器是否支持 SpeechSynthesis API
import { logger } from './logger'
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// 检查浏览器是否支持 MediaRecorder API
export function isMediaRecorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'MediaRecorder' in window &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
}

/**
 * 朗读指定文本
 * @param text 要朗读的文本
 * @param rate 语速，默认 1.0；慢速发音使用 0.5
 */
export function speak(text: string, rate = 1): void {
  if (!isSpeechSupported()) {
    logger.warn('[speech] 当前浏览器不支持语音合成')
    return
  }
  try {
    // 取消之前的发音队列，避免叠加
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    utterance.lang = 'en-US'
    window.speechSynthesis.speak(utterance)
  } catch (err) {
    logger.warn('[speech] 朗读失败', err)
  }
}

/**
 * 带计时的朗读：返回本次朗读实际耗时（毫秒）
 * 利用 SpeechSynthesisUtterance 的 end 事件估算发音时长
 * 用于朗读环节的鼓励性评分基线
 * @param text 要朗读的文本
 * @param rate 语速，默认 1.0
 * @returns 朗读耗时（毫秒）；不支持或失败时返回 0
 */
export function speakWithTiming(text: string, rate = 1): Promise<number> {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) {
      resolve(0)
      return
    }
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = rate
      utterance.lang = 'en-US'
      const start = Date.now()
      const finish = (ms: number) => {
        try {
          utterance.onend = null
          utterance.onerror = null
        } catch (err) {
          if (import.meta.env.DEV)
            logger.warn('[speech] 清理 utterance 事件回调失败', err)
        }
        resolve(ms)
      }
      utterance.onend = () => finish(Date.now() - start)
      utterance.onerror = () => finish(0)
      window.speechSynthesis.speak(utterance)
    } catch (err) {
      logger.warn('[speech] 计时朗读失败', err)
      resolve(0)
    }
  })
}
