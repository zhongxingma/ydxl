// 朗读步骤逻辑：语速切换、发音播放、跟读录音与鼓励性评分、AI 拼读分解
//
// 从 ReadStep 抽离，组件仅负责视图渲染。
import { logger } from '../../../shared/utils/logger'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Word } from '@/shared/types'
import { aiProvider, type WordBreakdown } from '@/shared/services/ai'
import { breakdownWord, estimateSyllables } from '../utils/phonetics'
import {
  isMediaRecorderSupported,
  isSpeechSupported,
  speakWithTiming,
} from '@/shared/utils/speech'
import type { StepResult } from '../types'

// 星级评分（鼓励性，最低 1 星）
// ratio = 用户录音时长 / 标准时长（归一化为常速）
function scorePronunciation(ratio: number): 1 | 2 | 3 {
  if (ratio >= 0.7 && ratio <= 1.6) return 3
  if (ratio >= 0.4 && ratio <= 2.2) return 2
  return 1
}

export function useReadStep(word: Word, onComplete: (result: StepResult) => void) {
  const { t } = useTranslation()
  // 记录开始时间用于计算用时
  const startTimeRef = useRef(Date.now())
  const [hintLoading, setHintLoading] = useState(false)
  const [hint, setHint] = useState<WordBreakdown | null>(null)
  const [hintError, setHintError] = useState<string | null>(null)

  // 速度切换：normal=1.0 / slow=0.5
  const [speed, setSpeed] = useState<'normal' | 'slow'>('normal')
  const rate = speed === 'slow' ? 0.5 : 1

  // 朗读状态：用于激活波形动画
  const [speaking, setSpeaking] = useState(false)
  // 标准时长（按当前速度测得的播放时长，毫秒）
  const [standardMs, setStandardMs] = useState<number | null>(null)

  // 录音相关状态
  const [recording, setRecording] = useState(false)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordMs, setRecordMs] = useState<number | null>(null)
  const [score, setScore] = useState<1 | 2 | 3 | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordStartRef = useRef<number>(0)

  const speechSupported = isSpeechSupported()
  const recorderSupported = isMediaRecorderSupported()

  // 音节数：优先使用 AI 拼读分解结果，否则按字母估算
  const syllables = hint?.syllables ?? estimateSyllables(word.word)
  // 波形条数：取音节数，至少 3 条以增强视觉效果
  const waveBars = Math.max(3, syllables)

  // 调用 AI 获取单词拼读分解
  const handleShowHint = async () => {
    if (hint || hintLoading) return
    setHintLoading(true)
    setHintError(null)
    try {
      const result = await aiProvider.generateWordBreakdown(word.word)
      setHint(result)
    } catch (err) {
      logger.warn('[ReadStep] 获取拼读分解失败，降级本地估算', err)
      const local = breakdownWord(word.word)
      setHint(local)
      setHintError(t('review.read.hint_fallback'))
    } finally {
      setHintLoading(false)
    }
  }

  // 播放发音（按当前速度），并测量时长用于评分基线
  const handlePlay = async () => {
    if (!speechSupported) return
    setSpeaking(true)
    const ms = await speakWithTiming(word.word, rate)
    setSpeaking(false)
    if (ms > 0) {
      setStandardMs(ms)
      // 若已有录音，重新评分
      if (recordMs !== null) {
        // 归一化为常速时长：慢速时实际播放更长，乘以 rate 还原常速基线
        const normalStandard = ms * rate
        setScore(scorePronunciation(recordMs / normalStandard))
      }
    }
  }

  // 开始录音
  const handleStartRecording = async () => {
    if (!recorderSupported) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        // 释放上一次的 URL 避免内存泄漏
        if (recordedUrl) URL.revokeObjectURL(recordedUrl)
        setRecordedUrl(URL.createObjectURL(blob))
        // 关闭麦克风音轨
        stream.getTracks().forEach((t) => t.stop())
        const duration = Date.now() - recordStartRef.current
        setRecordMs(duration)
        // 若已有标准时长，计算评分
        if (standardMs !== null && standardMs > 0) {
          const normalStandard = standardMs * rate
          setScore(scorePronunciation(duration / normalStandard))
        }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      recordStartRef.current = Date.now()
      setRecording(true)
      setScore(null)
    } catch (err) {
      logger.warn('[ReadStep] 启动录音失败', err)
      setHintError(t('review.read.mic_denied'))
    }
  }

  // 停止录音
  const handleStopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }

  // 组件卸载时释放录音 URL
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
  }, [recordedUrl])

  // 完成本步骤：朗读视为全对
  const handleComplete = () => {
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
    onComplete({ correct: true, correctRate: 1, timeSpent })
  }

  return {
    speechSupported,
    recorderSupported,
    speed,
    setSpeed,
    speaking,
    waveBars,
    recording,
    recordedUrl,
    score,
    hint,
    hintLoading,
    hintError,
    handleShowHint,
    handlePlay,
    handleStartRecording,
    handleStopRecording,
    handleComplete,
  }
}
