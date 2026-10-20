// 复习完成总结页
// - 显示本次复习数量
// - 提供"返回"按钮回到生词本/首页，"再次复习"刷新页面
import { Link } from 'react-router-dom'

interface ReviewCompleteProps {
  // 本次复习的单词数
  reviewedCount: number
  // 本次复习总用时（秒）
  totalTimeSpent?: number
  // 再次复习回调
  onRestart?: () => void
}

export default function ReviewComplete({
  reviewedCount,
  totalTimeSpent,
  onRestart,
}: ReviewCompleteProps) {
  const minutes = totalTimeSpent ? Math.floor(totalTimeSpent / 60) : 0
  const seconds = totalTimeSpent ? totalTimeSpent % 60 : 0

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16 px-4 text-center dark:border-gray-600">
      {/* 庆祝图标 */}
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-500 dark:bg-green-900/30 dark:text-green-300">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-10 w-10"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        🎉 复习完成！
      </h2>
      <p className="mt-2 text-base text-gray-700 dark:text-gray-300">
        本次复习 <span className="font-semibold text-green-600 dark:text-green-400">{reviewedCount}</span> 个单词
      </p>
      {totalTimeSpent !== undefined && totalTimeSpent > 0 && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          用时 {minutes > 0 ? `${minutes} 分 ` : ''}{seconds} 秒
        </p>
      )}

      <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
        坚持每日复习，单词记忆更牢固
      </p>

      {/* 操作按钮 */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
            再次复习
          </button>
        )}
        <Link
          to="/wordbook"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          查看生词本
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          返回首页
        </Link>
      </div>
    </div>
  )
}
