// 答题视图：阅读理解与语法填空共用双栏布局（左侧返回入口 + 右侧题目面板）
import type { Question } from '@/shared/types'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { formatDuration } from '../hooks/useReadingTimer'
import QuestionPanel from './QuestionPanel'

interface ReadingQuizViewProps {
  mode: 'reading' | 'grammar'
  questions: Question[]
  currentIdx: number
  answers: Record<number, number>
  elapsedSec: number
  onBackToReading: () => void
  onAnswer: (questionIdx: number, optionIndex: number) => void
  onNext: () => void
}

export default function ReadingQuizView({
  mode,
  questions,
  currentIdx,
  answers,
  elapsedSec,
  onBackToReading,
  onAnswer,
  onNext,
}: ReadingQuizViewProps) {
  const { t } = useTranslation()
  const isGrammar = mode === 'grammar'
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
      {/* 左侧：返回阅读入口 */}
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBackToReading}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('reading.quiz.back_to_reading')}
        </button>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {isGrammar
            ? t('reading.quiz.grammar_progress', { current: currentIdx + 1, total: questions.length })
            : t('reading.quiz.reading_progress', {
                duration: formatDuration(elapsedSec),
                count: questions.length,
              })}
        </p>
      </div>
      {/* 右侧：题目区（单题切换） */}
      <aside className="lg:col-span-1">
        <div className="sticky top-24">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isGrammar ? t('reading.grammar.section') : t('reading.quiz.reading_section')}
            </h2>
            {/* AI 来源徽章：练习题由哪个 AI 接口生成 */}
            <AIProviderBadge scenario={isGrammar ? 'grammar_fill' : 'questions'} />
          </div>
          <QuestionPanel
            questions={questions}
            currentIdx={currentIdx}
            answers={answers}
            onAnswer={onAnswer}
            onNext={onNext}
          />
        </div>
      </aside>
    </div>
  )
}
