// 阅读页底部操作区：阅读完成 / 生成练习题 / 阅读下一篇
import clsx from 'clsx'
import type { QuizGenStage } from '../types'

interface ReadingActionsProps {
  quizGenStage: QuizGenStage
  isArticleRead: boolean
  generatingQuestions: boolean
  hasQuestions: boolean
  loadingNext: boolean
  onMarkAsRead: () => void
  onLoadNext: () => void
}

export default function ReadingActions({
  quizGenStage,
  isArticleRead,
  generatingQuestions,
  hasQuestions,
  loadingNext,
  onMarkAsRead,
  onLoadNext,
}: ReadingActionsProps) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      {/* 阅读完成按钮（错误状态下替换为错误提示 + 重试按钮，避免 button 嵌套 button） */}
      {quizGenStage === 'error' ? (
        <div className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-700/60 dark:bg-red-900/20">
          <span className="text-sm text-red-600 dark:text-red-400">生成失败</span>
          <button
            type="button"
            onClick={onMarkAsRead}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            重试
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onMarkAsRead}
          disabled={isArticleRead || generatingQuestions}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            isArticleRead || generatingQuestions
              ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
              : 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600',
          )}
        >
          {generatingQuestions ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              {quizGenStage === 'retrying'
                ? '正在重试...'
                : quizGenStage === 'fallback'
                  ? '正在使用备选方案...'
                  : '生成练习题中...'}
            </>
          ) : isArticleRead ? (
            <>
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              已完成阅读
            </>
          ) : (
            <>
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              阅读完成
            </>
          )}
        </button>
      )}

      {/* 已读但无题目时显示"生成练习题"按钮（允许用户手动触发生成）
          错误状态下隐藏，由上方"重试"按钮替代 */}
      {isArticleRead && !hasQuestions && !generatingQuestions && quizGenStage !== 'error' && (
        <button
          type="button"
          onClick={onMarkAsRead}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
          生成练习题
        </button>
      )}

      {/* 阅读下一篇按钮 */}
      <button
        type="button"
        onClick={onLoadNext}
        disabled={loadingNext}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        {loadingNext ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            加载中...
          </>
        ) : (
          <>
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
            阅读下一篇
          </>
        )}
      </button>
    </div>
  )
}
