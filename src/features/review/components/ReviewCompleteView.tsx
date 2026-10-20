// 复习完成评价弹窗：用户主观反馈"已掌握"/"还需复习"
// 五步全部完成后展示，调用方根据评价构造加权输入并触发 SM-2 更新
import { useState } from 'react'
import type { Word } from '@/shared/types'

// 评价选项
export type Rating = 'mastered' | 'review'

interface ReviewCompleteViewProps {
  word: Word | null
  onRating: (rating: Rating) => Promise<void>
  onBackToList: () => void
}

export default function ReviewCompleteView({
  word,
  onRating,
  onBackToList,
}: ReviewCompleteViewProps) {
  // 评价按钮应用中标志（防重复点击）
  const [applying, setApplying] = useState(false)

  const handleRating = async (rating: Rating) => {
    if (applying) return
    setApplying(true)
    try {
      await onRating(rating)
    } finally {
      setApplying(false)
    }
  }

  if (!word) {
    // 兜底：无当前词时直接返回列表
    return (
      <div className="py-16 text-center text-gray-500 dark:text-gray-400">
        状态异常，请返回列表。
        <div className="mt-4">
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">复习评价</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          你已完成五步复习，请根据本次掌握情况做出评价，将用于更新记忆曲线。
        </p>

        {/* 当前词简要信息 */}
        <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xl font-bold text-gray-900 dark:text-gray-100">{word.word}</span>
            {word.phonetic && (
              <span className="text-sm text-gray-500 dark:text-gray-400">{word.phonetic}</span>
            )}
          </div>
          {word.definition && (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {word.pos && (
                <span className="mr-1 text-gray-500 dark:text-gray-400">{word.pos}.</span>
              )}
              {word.definition}
            </p>
          )}
        </div>

        {/* 评价按钮 */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => void handleRating('review')}
            disabled={applying}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:w-auto"
          >
            还需复习
          </button>
          <button
            type="button"
            onClick={() => void handleRating('mastered')}
            disabled={applying}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-green-500 dark:hover:bg-green-600 sm:w-auto"
          >
            {applying ? '处理中...' : '已掌握'}
          </button>
        </div>
      </div>
    </div>
  )
}
