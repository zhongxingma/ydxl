// 五步复习 - 第四步：拼写（分级提示 + 抖动动画 + 闪现）
// 1. 自动播放单词发音（mount 时）
// 2. 分级提示（提示按钮点击次数递进）：
//    - 第 1 次：显示首尾字母（a____e）
//    - 第 2 次：在首尾基础上露出 1-2 个元音
//    - 第 3 次：自定义键盘高亮可能字母（单词中包含的字母）
//    - 第 4+ 次：显示完整单词 0.5 秒后清空（闪现浮层）
// 3. 拼错抖动动画：提交错误时输入框 animate-shake
// 4. 正确拼写闪现：拼错后输入框上方闪现正确拼写 0.5 秒
// 5. 拼对则完成；多次拼错可"查看答案"完成（correctRate=0）
import { useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import HintButton from '../components/HintButton'
import CustomKeyboard from '../components/CustomKeyboard'
import { cn } from '@/shared/utils/cn'
import { estimateSyllables } from '../utils/phonetics'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import type { StepResult } from '../types'
import '../review-animations.css'

interface SpellStepProps {
  word: Word
  onComplete: (result: StepResult) => void
}

// 生成首尾字母 + 元音提示的遮罩
// level 1：仅首尾；level 2：首尾 + 1-2 个元音
function getMask(word: string, level: number): string {
  const lower = word.toLowerCase()
  if (lower.length === 0) return ''
  const revealed = new Set<number>()
  revealed.add(0)
  if (lower.length > 1) revealed.add(lower.length - 1)

  if (level >= 2) {
    // 露出中间 1-2 个元音（非首尾位置）
    const vowelPositions: number[] = []
    for (let i = 1; i < lower.length - 1; i++) {
      if (/[aeiou]/.test(lower[i])) vowelPositions.push(i)
    }
    vowelPositions.slice(0, 2).forEach((p) => revealed.add(p))
  }

  return lower
    .split('')
    .map((c, i) => (revealed.has(i) ? c : '_'))
    .join('')
}

// 抖动动画时长（与 CSS shake 一致）
const SHAKE_DURATION_MS = 420
// 闪现浮层时长
const FLASH_DURATION_MS = 500
// 显示"查看答案"按钮的最低错误次数
const GIVE_UP_THRESHOLD = 2

export default function SpellStep({ word, onComplete }: SpellStepProps) {
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
      void (async () => {
        try {
          const fresh = await wordRepository.getByIdLocalFirst(word.id)
          const next = (fresh?.stubbornCount ?? 0) + 1
          await wordRepository.update(word.id, { stubbornCount: next })
        } catch (err) {
          console.warn('[SpellStep] 更新顽固词计数失败', err)
        }
      })()
    }
  }

  // 查看答案并完成（correctRate=0）
  const handleGiveUp = () => {
    // 放弃视为全错，计入顽固词计数
    void (async () => {
      try {
        const fresh = await wordRepository.getByIdLocalFirst(word.id)
        const next = (fresh?.stubbornCount ?? 0) + 1
        await wordRepository.update(word.id, { stubbornCount: next })
      } catch (err) {
        console.warn('[SpellStep] 放弃时更新顽固词计数失败', err)
      }
    })()
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
      ? '显示首尾字母'
      : hintLevel === 1
        ? '显示元音'
        : hintLevel === 2
          ? '键盘高亮'
          : '查看完整单词'

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          请根据发音拼写单词
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          点击下方按钮可重复播放发音
        </p>
      </div>

      {/* 发音按钮 */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => speak(word.word)}
          disabled={!speechSupported}
          className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
          aria-label="播放发音"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.96 0-1.74-.78-1.74-1.74V9.99c0-.96.78-1.74 1.74-1.74H6.75Z" />
          </svg>
        </button>
      </div>

      {!speechSupported && (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
          当前浏览器不支持语音合成，请根据音标拼写
        </p>
      )}

      {/* 音标提示（不支持发音时显示） */}
      {!speechSupported && word.phonetic && (
        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
          音标：<span className="font-mono">{word.phonetic}</span>
        </p>
      )}

      {/* 中文释义提示 */}
      <div className="text-center">
        {word.definition ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            中文释义：<span className="font-medium">{word.definition}</span>
          </p>
        ) : word.phonetic ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            音标：<span className="font-mono">{word.phonetic}</span>
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            （释义与音标缺失，请根据发音拼写）
          </p>
        )}
      </div>

      {/* 输入区（含正确拼写闪现浮层） */}
      <form onSubmit={handleSubmit} className="relative space-y-2">
        {/* 正确拼写闪现浮层（绝对定位） */}
        {showFlash && (
          <div
            key={flashKey}
            className="flash-appear pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-md bg-green-100 px-4 py-1.5 text-lg font-semibold text-green-700 shadow dark:bg-green-900/40 dark:text-green-300"
            role="status"
          >
            {word.word}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={submitted}
          placeholder="请输入单词..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-lg border bg-white px-4 py-2.5 text-center text-lg font-medium text-gray-900 outline-none transition-colors dark:bg-gray-800 dark:text-gray-100',
            shaking && 'animate-shake',
            submitted
              ? isCorrect
                ? 'border-green-400 dark:border-green-500'
                : 'border-red-400 dark:border-red-500'
              : wrongCount > 0
                ? 'border-red-300 focus:border-indigo-500 dark:border-red-700 dark:focus:border-indigo-400'
                : 'border-gray-300 focus:border-indigo-500 dark:border-gray-600 dark:focus:border-indigo-400',
          )}
        />
        {/* 提交按钮 */}
        {!submitted && (
          <div className="flex items-center justify-between gap-2">
            {wrongCount >= GIVE_UP_THRESHOLD ? (
              <button
                type="button"
                onClick={handleGiveUp}
                className="text-xs text-gray-400 underline transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                查看答案并完成
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-indigo-500 dark:hover:bg-indigo-600 dark:disabled:bg-gray-600"
            >
              提交
            </button>
          </div>
        )}
      </form>

      {/* 提示按钮（多级，始终可点击） */}
      {!submitted && (
        <HintButton onShowHint={handleHint} hintShown={false} label={hintLabel} />
      )}

      {/* 提示内容：首尾字母 / 元音遮罩 */}
      {hintLevel >= 1 && mask && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">
            🔤 字母提示{hintLevel >= 2 ? '（含元音）' : '（首尾）'}
          </h4>
          <p className="mt-1 font-mono text-lg tracking-widest text-gray-800 dark:text-gray-200">
            {mask}
          </p>
        </div>
      )}

      {/* 自定义键盘（提示等级 3 时高亮可能字母） */}
      {hintLevel >= 3 && !submitted && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="mb-2 text-center text-sm font-semibold text-blue-800 dark:text-blue-200">
            ⌨️ 自定义键盘（高亮字母为单词可能包含的字母）
          </h4>
          <CustomKeyboard
            onKeyPress={handleKeyPress}
            onBackspace={handleBackspace}
            highlightedLetters={highlightedLetters}
          />
        </div>
      )}

      {/* 音节数提示（提示等级 >= 2 时附加展示） */}
      {hintLevel >= 2 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">🎵 音节数</h4>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            这个单词有 <span className="font-bold">{estimateSyllables(word.word)}</span> 个音节
          </p>
        </div>
      )}

      {/* 答题反馈 */}
      {submitted && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm',
            isCorrect
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
          )}
        >
          {isCorrect ? '✓ 拼写正确！' : '✗ 拼写错误'}
          {!isCorrect && (
            <p className="mt-1">
              正确答案：<span className="font-mono font-semibold">{word.word}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
