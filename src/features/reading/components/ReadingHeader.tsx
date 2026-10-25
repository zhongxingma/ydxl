// 阅读页顶部固定栏：题材 / 难度 / 词数 / 预估时长 / 打印 / 计时 / 进度
import clsx from 'clsx'
import type { ReadingView } from '../store'
import { formatDuration } from '../hooks/useReadingTimer'

interface ReadingHeaderProps {
  isHistoryMode: boolean
  topicLabel: string | null
  difficultyLabel: string | null
  difficultyStyle: string
  wordCount: number
  estimatedMinutes: number
  preparingPrint: boolean
  onPrint: () => void
  elapsedSec: number
  view: ReadingView
  readingProgress: number
}

export default function ReadingHeader({
  isHistoryMode,
  topicLabel,
  difficultyLabel,
  difficultyStyle,
  wordCount,
  estimatedMinutes,
  preparingPrint,
  onPrint,
  elapsedSec,
  view,
  readingProgress,
}: ReadingHeaderProps) {
  return (
    <header className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* 历史文章模式标识：articleId 查询参数存在时显示，区别于今日新文章 */}
        {isHistoryMode && (
          <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            历史文章
          </span>
        )}
        {/* 题材标签 */}
        {topicLabel && (
          <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {topicLabel}
          </span>
        )}
        {/* 难度徽章 */}
        {difficultyLabel && (
          <span className={clsx('rounded px-2 py-0.5 font-medium', difficultyStyle)}>
            {difficultyLabel}
          </span>
        )}
        {/* 词数 */}
        <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {wordCount} 词
        </span>
        {/* 预计阅读时间 */}
        <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          约 {estimatedMinutes} 分钟
        </span>
        {/* 打印按钮：一键打印完整练习（原文/题目/答案/单词/短语/翻译）；题目未生成时先补齐再打印 */}
        <button
          type="button"
          onClick={onPrint}
          disabled={preparingPrint}
          className="ml-auto inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="打印完整练习"
          title="打印完整练习：文章原文、题目、答案、重点单词、短语与全文翻译"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Z"
            />
          </svg>
          {preparingPrint ? '准备中...' : '打印'}
        </button>
        {/* 计时器 */}
        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-mono text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
          </svg>
          {formatDuration(elapsedSec)}
        </span>
      </div>
      {/* 阅读进度条（仅 reading 视图显示） */}
      {view === 'reading' && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
      )}
    </header>
  )
}
