// 答题反馈与解析组件
// 提交后切换渲染，显示每题正误、正确答案标识、解析（原文定位 + 干扰项排除原因）
// 增强版：
// - 原文定位（locationClue）以波浪下划线样式标注，便于视觉定位
// - 选项区分为"为何对"（正确项）与"为何错"（错误项）解析
// - 提供"跳转回原文"按钮，回调父组件切回 reading 视图并滚动到对应位置
import clsx from 'clsx'
import { useState } from 'react'
import type { Question } from '@/shared/types'
import { CheckIcon, CrossIcon } from '@/shared/components/icons'
import { OPTION_LETTERS, QUESTION_TYPE_LABEL } from '../types'

interface AnswerFeedbackProps {
  questions: Question[]
  // 用户作答：题号（在 questions 数组中的下标） -> 选项下标
  answers: Record<number, number>
  // 重新答题回调
  onRetry: () => void
  // 跳转回原文：传入 locationClue 文本，由父组件切回 reading 视图并滚动定位
  onLocateInArticle?: (locationClue: string) => void
}

// 跳转图标
function LocateIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
      />
    </svg>
  )
}

export default function AnswerFeedback({
  questions,
  answers,
  onRetry,
  onLocateInArticle,
}: AnswerFeedbackProps) {
  // 已展开详解的题目集合（点击题目卡片头部切换）
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set())

  const toggleExpand = (idx: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  // 计算总分
  const correctCount = questions.filter((q, idx) => answers[idx] === q.correctIndex).length
  const totalCount = questions.length
  const scorePercent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0

  return (
    <div className="space-y-4">
      {/* 总分展示 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">本次得分</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {correctCount} / {totalCount}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500 dark:text-gray-400">正确率</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {scorePercent}%
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 w-full rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          重新答题
        </button>
      </div>

      {/* 每题反馈（可折叠） */}
      {questions.map((q, idx) => {
        const userAnswer = answers[idx]
        const isCorrect = userAnswer === q.correctIndex
        const expanded = expandedSet.has(idx)
        return (
          <div
            key={q.id}
            className={clsx(
              'rounded-lg border bg-white shadow-sm dark:bg-gray-800',
              isCorrect
                ? 'border-emerald-200 dark:border-emerald-700/60'
                : 'border-rose-200 dark:border-rose-700/60'
            )}
          >
            {/* 题干 + 正误判断（点击展开/收起详解） */}
            <button
              type="button"
              onClick={() => toggleExpand(idx)}
              className="flex w-full items-start gap-2 p-4 text-left"
            >
              <span className="mt-0.5 text-sm font-semibold text-gray-400 dark:text-gray-500">
                {idx + 1}.
              </span>
              <div className="flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {QUESTION_TYPE_LABEL[q.type]}
                  </span>
                  <span
                    className={clsx(
                      'rounded px-1.5 py-0.5 text-xs font-medium',
                      isCorrect
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                    )}
                  >
                    {isCorrect ? '正确' : '错误'}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 md:text-base">
                  {q.stem}
                </p>
              </div>
              <span className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {expanded ? '收起' : '详解'}
              </span>
            </button>

            {/* 详解内容（默认展开） */}
            {expanded && (
              <div className="border-t border-gray-100 px-4 pb-4 pt-3 dark:border-gray-700/60">
                {/* 选项：正确答案标绿勾，用户答错的选项标红叉 */}
                <div className="space-y-1.5">
                  {q.options.map((opt, optIdx) => {
                    const isCorrectOption = optIdx === q.correctIndex
                    const isUserWrongChoice = optIdx === userAnswer && !isCorrectOption
                    return (
                      <div
                        key={optIdx}
                        className={clsx(
                          'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                          isCorrectOption &&
                            'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20',
                          isUserWrongChoice &&
                            'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20',
                          !isCorrectOption &&
                            !isUserWrongChoice &&
                            'border-gray-200 dark:border-gray-700'
                        )}
                      >
                        <span
                          className={clsx(
                            'font-medium',
                            isCorrectOption
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : isUserWrongChoice
                                ? 'text-rose-700 dark:text-rose-300'
                                : 'text-gray-700 dark:text-gray-300'
                          )}
                        >
                          {OPTION_LETTERS[optIdx]}.
                        </span>
                        <span className="flex-1 text-gray-800 dark:text-gray-200">{opt}</span>
                        {isCorrectOption && (
                          <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        {isUserWrongChoice && (
                          <CrossIcon className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* 解析：原文定位 + 干扰项排除原因 */}
                <div className="mt-3 space-y-2 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-700/40">
                  {/* 原文定位：波浪下划线标注 */}
                  {q.locationClue && (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                          原文定位线索
                        </p>
                        {onLocateInArticle && (
                          <button
                            type="button"
                            onClick={() => onLocateInArticle(q.locationClue)}
                            className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                          >
                            <LocateIcon className="h-3 w-3" />
                            跳转回原文
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 text-gray-800 dark:text-gray-200">
                        <u className="decoration-wavy decoration-indigo-400 underline-offset-4">
                          {q.locationClue}
                        </u>
                      </p>
                    </div>
                  )}
                  {/* 解析：整体展示（含正确项"为何对"与干扰项"为何错"） */}
                  {q.explanation && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                        解析（含正确项依据 / 干扰项排除原因）
                      </p>
                      <p className="mt-0.5 text-gray-800 dark:text-gray-200">{q.explanation}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
