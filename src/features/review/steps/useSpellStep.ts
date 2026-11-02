// 拼写步骤逻辑：分级提示、抖动/闪现动画、提交与放弃、顽固词计数
//
// 从 SpellStep 抽离，组件仅负责视图渲染。
import { logger } from '../../../shared/utils/logger'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import type { StepResult } from '../types'
import { getMask } from './spellHint'

// 抖动动画时长（与 CSS shake 一致）
const SHAKE_DURATION_MS = 420
// 闪现浮层时长
const FLASH_DURATION_MS = 500

// 拼写错误计入顽固词计数（与 PracticeStep 一致）
async function incrementStubbornCount(wordId: string): Promise<void> {
  const fresh = await wordRepository.getByIdLocalFirst(wordId)
  const next = (fresh?.stubbornCount ?? 0) + 1
  await wordRepository.update(wordId, { stubbornCount: next })
}

export function useSpellStep(word: Word, onComplete: (result: StepResult) => void) {
  const { t } = useTranslation()
  const startTimeRef = useRef(Date.now())
  const [input, setInput] = useState('')
  // 提示等级：0 无；1 首尾；2 首尾+元音；3 键盘高亮
  const [hintLevel, setHintLevel] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [wrongCount, setWrongCount] = useState(0)
  // 抖动状态
  const [shaking, setShaking] = useState(false)
  // 正确拼写闪现浮层
  const [flashKey, setFlashKey] = useState(0)
  const [showFlash, setShowFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)

  const speechSupported = isSpeechSupported()
  const isCorrect = input.trim().toLowerCase() === word.word.toLowerCase()

  // 当前遮罩字符串（hintLevel >= 1 时显示）
  const mask = hintLevel >= 1 ? getMask(word.word, hintLevel) : ''
  // 自定义键盘高亮字母：单词中包含的字母（去重）
  const highlightedLetters =
    hintLevel >= 3 ? new Set(word.word.toLowerCase().split('')) : undefined

  // 挂载时自动播放发音
  useEffect(() => {
    if (speechSupported) {
      const timer = setTimeout(() => speak(word.word), 200)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [word.word, speechSupported])

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current)
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    }
  }, [])

  // 应用分级提示
  const handleHint = () => {
    if (hintLevel < 3) {
      setHintLevel((l) => l + 1)
    } else {
      // 第 4+ 次：闪现完整单词 0.5s
      setShowFlash(true)
      setFlashKey((k) => k + 1)
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = window.setTimeout(() => {
        setShowFlash(false)
      }, FLASH_DURATION_MS)
    }
  }

  // 触发抖动动画
  const triggerShake = () => {
    setShaking(true)
    if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current)
    shakeTimerRef.current = window.setTimeout(() => {
      setShaking(false)
    }, SHAKE_DURATION_MS)
  }

  // 自定义键盘按键
  const handleKeyPress = (letter: string) => {
    if (submitted) return
    setInput((prev) => prev + letter)
  }
  const handleBackspace = () => {
    if (submitted) return
    setInput((prev) => prev.slice(0, -1))
  }

  // 提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || submitted) return
    if (isCorrect) {
      setSubmitted(true)
      const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
      onComplete({
        correct: true,
        correctRate: 1,
        timeSpent,
      })
    } else {
      // 拼错：抖动 + 闪现正确拼写，不清空输入，允许继续修改
      triggerShake()
      setShowFlash(true)
      setFlashKey((k) => k + 1)
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = window.setTimeout(() => {
        setShowFlash(false)
      }, FLASH_DURATION_MS)
      setWrongCount((c) => c + 1)
      // 错题入待强化池：拼写错误计入顽固词计数（与 PracticeStep 一致）
      void incrementStubbornCount(word.id).catch((err) => {
        logger.warn('[SpellStep] 更新顽固词计数失败', err)
      })
    }
  }

  // 查看答案并完成（correctRate=0）
  const handleGiveUp = () => {
    // 放弃视为全错，计入顽固词计数
    void incrementStubbornCount(word.id).catch((err) => {
      logger.warn('[SpellStep] 放弃时更新顽固词计数失败', err)
    })
    setSubmitted(true)
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
    onComplete({
      correct: false,
      correctRate: 0,
      timeSpent,
    })
  }

  // 提示按钮文案随等级变化
  const hintLabel =
    hintLevel === 0
      ? t('review.hint.first_last')
      : hintLevel === 1
        ? t('review.hint.show_vowels')
        : hintLevel === 2
          ? t('review.hint.keyboard_highlight')
          : t('review.hint.show_full_word')

  return {
    input,
    setInput,
    hintLevel,
    submitted,
    wrongCount,
    shaking,
    flashKey,
    showFlash,
    inputRef,
    speechSupported,
    isCorrect,
    mask,
    highlightedLetters,
    hintLabel,
    handleHint,
    handleKeyPress,
    handleBackspace,
    handleSubmit,
    handleGiveUp,
  }
}
