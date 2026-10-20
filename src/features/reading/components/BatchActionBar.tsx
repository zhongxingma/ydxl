// 批量加入生词本浮层内容
// 在用户划选多个单词时显示，提供"批量加入生词本"按钮与结果反馈
import clsx from 'clsx'

interface BatchActionBarProps {
  words: string[]
  processing: boolean
  result: { added: number; failed: number } | null
  onAdd: () => void
}

export default function BatchActionBar({ words, processing, result, onAdd }: BatchActionBarProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
        批量加入生词本
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        选中包含 {words.length} 个词：
      </p>
      <div className="flex flex-wrap gap-1">
        {words.slice(0, 8).map((w, i) => (
          <span
            key={i}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
          >
            {w}
          </span>
        ))}
        {words.length > 8 && (
          <span className="text-xs text-gray-400">+{words.length - 8}</span>
        )}
      </div>
      {result ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          ✓ 添加完成：成功 {result.added} 个，失败 {result.failed} 个
        </p>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={processing}
          className={clsx(
            'w-full rounded px-3 py-1.5 text-xs font-medium transition-colors',
            processing
              ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
          )}
        >
          {processing ? '添加中...' : `批量加入生词本（${words.length} 个词）`}
        </button>
      )}
    </div>
  )
}
