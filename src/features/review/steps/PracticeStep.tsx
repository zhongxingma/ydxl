// 五步复习 - 第三步：练习（题型多样化增强版）
//
// 题目生成（7 种题型、干扰项挑选、随机 3-5 题）见 ./practiceQuestionGenerator。
// 本组件只负责答题交互：
// - 错题即时反馈：正确选项绿色高亮，错误选项红色高亮，停留 1.5s 自动进入下一题
// - 错题入待强化池：word.stubbornCount += 1
import { useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import { cn } from '@/shared/utils/cn'
import HintButton from '../components/HintButton'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import type { StepResult } from '../types'
import {
  generateQuestions,
  shuffle,
  TYPE_LABEL,
  type Question,
} from './practiceQuestionGenerator'

interface PracticeStepProps {
  word: Word
  // 其他单词，用于生成干扰项
  distractors?: Word[]
  onComplete: (result: StepResult) => void
}

export default function PracticeStep({ word, distractors = [], onComplete }: PracticeStepProps) {
  const startTimeRef = useRef(Date.now())
  // 用 useState 初始化生成题目；父组件通过 key={word.id} 在单词切换时重新挂载本组件
  const [questions, setQuestions] = useState<Question[]>(() =>
    generateQuestions(word, distractors),
  )
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [answered, setAnswered] = useState(false)
  const [hintLevel, setHintLevel] = useState(0) // 0: 无提示; 1: 排除两个错误选项; 2: 显示首字母
  // 是否正在自动进入下一题（错题 1.5s 后自动推进）
  const [autoAdvancing, setAutoAdvancing] = useState(false)
  // 自动推进定时器引用（卸载时清理，避免对已卸载组件 setState）
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清理自动推进定时器
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current)
    }
  }, [])

  const speechSupported = isSpeechSupported()
  const current = questions[currentIdx]

  // 错题入待强化池：word.stubbornCount += 1（读取最新值后累加，失败静默）
  // 使用 getByIdLocalFirst：复习队列中的单词可能仅存在于本地缓存，
  // 服务器返回 404 时仍可从本地缓存读取并更新顽固词计数
  const incrementStubborn = () => {
    void (async () => {
      try {
        const fresh = await wordRepository.getByIdLocalFirst(word.id)
        const next = (fresh?.stubbornCount ?? 0) + 1
        await wordRepository.update(word.id, { stubbornCount: next })
      } catch (err) {
        console.warn('[PracticeStep] 更新顽固词计数失败', err)
      }
    })()
  }

  // 进入下一题 / 完成本步
  const goNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx((i) => i + 1)
      setSelectedIdx(null)
      setAnswered(false)
      setHintLevel(0)
      setAutoAdvancing(false)
    } else {
      // 全部完成
      const total = questions.length
      const correctRate = total > 0 ? correctCount / total : 0
      const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
      onComplete({
        correct: correctRate === 1,
        correctRate,
        timeSpent,
      })
    }
  }

  // 选择答案
  const handleSelect = (idx: number) => {
    if (answered || current.eliminated.has(idx)) return
    setSelectedIdx(idx)
    setAnswered(true)
    if (idx === current.correctIndex) {
      setCorrectCount((c) => c + 1)
    } else {
      // 错题入待强化池
      incrementStubborn()
      // 错题 1.5s 后自动进入下一题
      setAutoAdvancing(true)
      if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = setTimeout(() => goNext(), 1500)
    }
  }

  // 播放选项单词发音（看义选音题用）
  const handlePlayOption = (e: React.MouseEvent, text: string) => {
    e.stopPropagation()
    if (speechSupported) speak(text)
  }

  // 应用提示
  const handleHint = () => {
    if (hintLevel === 0) {
      // 排除两个错误选项
      const wrongIndices = current.options
        .map((_, i) => i)
        .filter((i) => i !== current.correctIndex)
      const toEliminate = shuffle(wrongIndices).slice(0, 2)
      setQuestions((prev) =>
        prev.map((q, i) =>
          i === currentIdx
            ? { ...q, eliminated: new Set([...q.eliminated, ...toEliminate]) }
            : q,
        ),
      )
      setHintLevel(1)
    } else if (hintLevel === 1) {
      // 显示首字母
      setQuestions((prev) =>
        prev.map((q, i) => (i === currentIdx ? { ...q, letterHintShown: true } : q)),
      )
      setHintLevel(2)
    }
  }

  // 防御性：题目未生成完毕
  if (!current) {
    return (
      <div className="py-8 text-center text-gray-500 dark:text-gray-400">
        正在生成题目...
      </div>
    )
  }

  // 首字母提示文本：单词类题型显示首字母，释义类显示音节信息
  const letterHintText =
    current.letterHintShown &&
    (current.type === 'def-to-word' ||
      current.type === 'fill-blank' ||
      current.type === 'def-choose-word')
      ? word.word.charAt(0).toUpperCase()
      : null

  return (
    <div className="space-y-4">
      {/* 进度提示 */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          第 {currentIdx + 1} / {questions.length} 题
        </span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          {TYPE_LABEL[current.type]}
        </span>
      </div>

      {/* 题干 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-base text-gray-900 dark:text-gray-100">{current.stem}</p>
        {/* 听音选义题：播放按钮 */}
        {current.stemAudio && speechSupported && (
          <button
            type="button"
            onClick={() => speak(current.stemAudio!)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
          >
            <SpeakerIcon /> 播放发音
          </button>
        )}
        {/* 首字母提示 */}
        {letterHintText && (
          <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">
            提示：首字母是「{letterHintText}」
          </p>
        )}
      </div>

      {/* 选项 */}
      <div className="space-y-2">
        {current.options.map((option, idx) => {
          const isSelected = selectedIdx === idx
          const isCorrect = idx === current.correctIndex
          const isEliminated = current.eliminated.has(idx)
          const canPlay = current.optionAudio && speechSupported && !answered
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelect(idx)}
              disabled={answered || isEliminated}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors',
                isEliminated && 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300 line-through dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-600',
                !isEliminated && !answered && 'border-gray-200 bg-white text-gray-800 hover:border-indigo-300 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-indigo-700 dark:hover:bg-gray-700',
                !isEliminated && answered && isCorrect && 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300',
                !isEliminated && answered && isSelected && !isCorrect && 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300',
                !isEliminated && answered && !isCorrect && !isSelected && 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
              )}
            >
              {/* 选项序号 */}
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {String.fromCharCode(65 + idx)}
              </span>
              <span className="flex-1">{option}</span>
              {/* 看义选音题：试听按钮 */}
              {canPlay && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handlePlayOption(e, option)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handlePlayOption(e as unknown as React.MouseEvent, option)
                    }
                  }}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300"
                  aria-label={`试听 ${option}`}
                >
                  <SpeakerIcon />
                </span>
              )}
              {/* 答题后图标 */}
              {answered && isCorrect && (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-5 w-5 text-green-600 dark:text-green-400" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              )}
              {answered && isSelected && !isCorrect && (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          )
        })}
      </div>

      {/* 提示按钮（仅未答题时可用） */}
      {!answered && hintLevel < 2 && (
        <HintButton
          onShowHint={handleHint}
          hintShown={false}
          label={hintLevel === 0 ? '排除干扰项' : '显示首字母'}
        />
      )}

      {/* 答题反馈 */}
      {answered && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm',
            selectedIdx === current.correctIndex
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
          )}
        >
          {selectedIdx === current.correctIndex ? '✓ 回答正确！' : '✗ 答错了，再接再厉'}
          <span className="ml-2 text-gray-500 dark:text-gray-400">
            （已答对 {correctCount} / {questions.length} 题）
          </span>
          {autoAdvancing && (
            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">1.5 秒后自动进入下一题…</span>
          )}
        </div>
      )}

      {/* 下一题 / 完成按钮（仅正确答案时手动推进，错题自动推进） */}
      {answered && !autoAdvancing && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {currentIdx < questions.length - 1 ? '下一题' : '完成本步'}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// 喇叭图标
function SpeakerIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.96 0-1.74-.78-1.74-1.74V9.99c0-.96.78-1.74 1.74-1.74H6.75Z" />
    </svg>
  )
}
