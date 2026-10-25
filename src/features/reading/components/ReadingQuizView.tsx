// 答题视图：阅读理解与语法填空共用双栏布局（左侧返回入口 + 右侧题目面板）
import type { Question } from '@/shared/types'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
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
          返回阅读
        </button>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {isGrammar
            ? `语法填空 · 第 ${currentIdx + 1} / ${questions.length} 题`
            : `已读 ${formatDuration(elapsedSec)}，共 ${questions.length} 题`}
        </p>
      </div>
      {/* 右侧：题目区（单题切换） */}
      <aside className="lg:col-span-1">
        <div className="sticky top-24">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isGrammar ? '语法填空' : '阅读理解'}
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
