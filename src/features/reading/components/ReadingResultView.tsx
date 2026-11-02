// 成绩单视图：正确率/用时/题数汇总、语法填空交互入口、分项详解
import type { Question } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { formatDuration } from '../hooks/useReadingTimer'
import AnswerFeedback from './AnswerFeedback'
import GrammarInterstitial from './GrammarInterstitial'
import PerformanceAnalysis from './PerformanceAnalysis'

interface ReadingResultViewProps {
  articleId: string
  questions: Question[]
  grammarQuestions: Question[]
  answers: Record<number, number>
  grammarAnswers: Record<number, number>
  elapsedSec: number
  grammarInterstitial: boolean
  grammarGenError: string | null
  generatingGrammar: boolean
  retryingGrammar: boolean
  onGenerateGrammar: () => void
  onSkipGrammar: () => void
  onRetryGrammar: () => void
  onViewTranslation: () => void
  onStudyVocabulary: () => void
  onRetry: () => void
  onLocateInArticle: (locationClue: string) => void
}

export default function ReadingResultView({
  articleId,
  questions,
  grammarQuestions,
  answers,
  grammarAnswers,
  elapsedSec,
  grammarInterstitial,
  grammarGenError,
  generatingGrammar,
  retryingGrammar,
  onGenerateGrammar,
  onSkipGrammar,
  onRetryGrammar,
  onViewTranslation,
  onStudyVocabulary,
  onRetry,
  onLocateInArticle,
}: ReadingResultViewProps) {
  const { t } = useTranslation()
  const totalQ = questions.length + grammarQuestions.length
  const correctQ =
    questions.filter((q, idx) => answers[idx] === q.correctIndex).length +
    grammarQuestions.filter((q, idx) => grammarAnswers[idx] === q.correctIndex).length
  const accuracy = totalQ === 0 ? 0 : Math.round((correctQ / totalQ) * 100)

  return (
    <div className="space-y-6">
      {/* 语法填空交互式生成选择页（阅读理解答完但语法填空未就绪时展示）：
          由用户在「生成语法填空并继续答题」与「跳过，直接查看成绩」之间自行选择，
          替代原先静默跳过语法填空分区的行为 */}
      {grammarInterstitial && articleId && (
        <GrammarInterstitial
          grammarGenError={grammarGenError}
          generatingGrammar={generatingGrammar}
          onGenerate={onGenerateGrammar}
          onSkip={onSkipGrammar}
        />
      )}

      {/* 总成绩单 */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('reading.transcript_title')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* 正确率（阅读理解 + 语法填空合并） */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('reading.accuracy_label')}</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {accuracy}%
            </p>
          </div>
          {/* 用时 */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('reading.duration_label')}</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {formatDuration(elapsedSec)}
            </p>
          </div>
          {/* 题数（阅读理解 + 语法填空合计） */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('reading.question_count_label')}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{totalQ}</p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onViewTranslation}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {t('reading.view_translation')}
          </button>
          <button
            type="button"
            onClick={onStudyVocabulary}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t('reading.study_vocabulary')}
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t('reading.retry_quiz')}
          </button>
        </div>
      </div>

      {/* 语法填空生成失败提示（答题流程因语法填空缺失直接跳过该分区时说明原因 + 重试）
          选择页已展示时隐藏，避免与交互式生成入口重复提示 */}
      {grammarQuestions.length === 0 && grammarGenError && !grammarInterstitial && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-900/20">
          <span className="text-sm text-amber-700 dark:text-amber-300">
            {t('reading.result.grammar_missing', { error: grammarGenError })}
          </span>
          <button
            type="button"
            onClick={onRetryGrammar}
            disabled={retryingGrammar}
            className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            {retryingGrammar ? t('reading.retrying') : t('reading.retry')}
          </button>
        </div>
      )}

      {/* 阅读理解成绩段 */}
      {questions.length > 0 && (
        <>
          <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={elapsedSec} />
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('reading.quiz.reading_section')} · {t('reading.question_detail')}
            </h3>
            <AnswerFeedback
              questions={questions}
              answers={answers}
              onRetry={onRetry}
              onLocateInArticle={onLocateInArticle}
            />
          </div>
        </>
      )}

      {/* 语法填空成绩段（仅当有语法填空题时展示） */}
      {grammarQuestions.length > 0 && (
        <>
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('reading.grammar.section')}
            </h3>
          </div>
          <PerformanceAnalysis
            questions={grammarQuestions}
            answers={grammarAnswers}
            elapsedSec={0}
          />
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('reading.grammar.section')} · {t('reading.question_detail')}
            </h3>
            <AnswerFeedback
              questions={grammarQuestions}
              answers={grammarAnswers}
              onRetry={onRetry}
              onLocateInArticle={onLocateInArticle}
            />
          </div>
        </>
      )}
    </div>
  )
}
