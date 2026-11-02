// 阅读理解题答题面板（单题切换模式）
// 一次展示一题，用户作答后立即反馈对错与解析，点击"下一题"切换到下一题
// 最后一题完成后"下一题"按钮变为"查看成绩"
import clsx from 'clsx'
import type { Question } from '@/shared/types'
import { CheckIcon, CrossIcon } from '@/shared/components/icons'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { OPTION_LETTERS } from '../types'

interface QuestionPanelProps {
  questions: Question[]
  // 当前题目下标
  currentIdx: number
  // 用户作答：题号（在 questions 数组中的下标） -> 选项下标
  answers: Record<number, number>
  // 选择某题的某选项
  onAnswer: (questionIdx: number, optionIndex: number) => void
  // 下一题（或查看成绩）
  onNext: () => void
}

export default function QuestionPanel({
  questions,
  currentIdx,
  answers,
  onAnswer,
  onNext,
}: QuestionPanelProps) {
  const { t } = useTranslation()
  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {t('reading.quiz.empty')}
      </div>
    )
  }

  // 边界保护：currentIdx 越界时取首题
  const safeIdx = Math.min(Math.max(0, currentIdx), questions.length - 1)
  const q = questions[safeIdx]
  const selected = answers[safeIdx]
  const hasAnswered = selected !== undefined
  const isCorrect = hasAnswered && selected === q.correctIndex
  const isLast = safeIdx === questions.length - 1

  return (
    <div className="space-y-4">
      {/* 进度指示器 */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          {t('reading.quiz.progress', { current: safeIdx + 1, total: questions.length })}
        </span>
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          {t(`reading.question_type.${q.type}`)}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{
            width: `${((safeIdx + 1) / questions.length) * 100}%`,
          }}
        />
      </div>

      {/* 题目卡片 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {/* 题干 */}
        <p className="mb-4 text-sm font-medium text-gray-900 dark:text-gray-100 md:text-base">
          {q.stem}
        </p>

        {/* 选项 */}
        <div className="space-y-1.5">
          {q.options.map((opt, optIdx) => {
            const isSelected = selected === optIdx
            const isCorrectOption = optIdx === q.correctIndex
            // 选后才显示对错样式
            const showCorrect = hasAnswered && isCorrectOption
            const showWrong = hasAnswered && isSelected && !isCorrectOption
            return (
              <button
                key={optIdx}
                type="button"
                disabled={hasAnswered}
                onClick={() => onAnswer(safeIdx, optIdx)}
                className={clsx(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  !hasAnswered &&
                    (isSelected
                      ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/30'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'),
                  showCorrect &&
                    'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20',
                  showWrong &&
                    'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20',
                  hasAnswered &&
                    !showCorrect &&
                    !showWrong &&
                    'border-gray-200 dark:border-gray-700'
                )}
              >
                <span
                  className={clsx(
                    'font-medium',
                    showCorrect
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : showWrong
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-gray-700 dark:text-gray-300'
                  )}
                >
                  {OPTION_LETTERS[optIdx]}.
                </span>
                <span className="flex-1 text-gray-800 dark:text-gray-200">{opt}</span>
                {showCorrect && (
                  <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                {showWrong && (
                  <CrossIcon className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                )}
              </button>
            )
          })}
        </div>

        {/* 选后立即反馈：解析小字 */}
        {hasAnswered && (
          <div className="mt-3 space-y-2 rounded-md bg-gray-50 p-3 text-xs dark:bg-gray-700/40">
            <p
              className={clsx(
                'font-medium',
                isCorrect
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-rose-700 dark:text-rose-300'
              )}
            >
              {isCorrect ? t('reading.quiz.answer_correct') : t('reading.quiz.answer_wrong')}
            </p>
            {q.locationClue && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">{t('reading.quiz.location_prefix')}</p>
                <p className="mt-0.5 text-gray-800 dark:text-gray-200">
                  <u className="decoration-wavy decoration-indigo-400 underline-offset-4">
                    {q.locationClue}
                  </u>
                </p>
              </div>
            )}
            {q.explanation && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">{t('reading.quiz.explanation_prefix')}</p>
                <p className="mt-0.5 text-gray-800 dark:text-gray-200">{q.explanation}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 下一题 / 查看成绩按钮 */}
      <button
        type="button"
        onClick={onNext}
        disabled={!hasAnswered}
        className={clsx(
          'w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
          hasAnswered
            ? 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
            : 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-500'
        )}
      >
        {isLast ? t('reading.quiz.view_result') : t('reading.quiz.next')}
      </button>
    </div>
  )
}
