// 生词长按操作菜单：立即复习 / 删除 / 取消
import { useEffect } from 'react'
import type { Word } from '@/shared/types'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'

interface WordbookActionMenuProps {
  word: Word
  onReview: () => void
  onDelete: () => void
  onClose: () => void
}

export default function WordbookActionMenu({
  word,
  onReview,
  onDelete,
  onClose,
}: WordbookActionMenuProps) {
  // Escape 关闭菜单
  useEscapeKey(onClose, true)

  // 菜单打开时锁定背景滚动
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${word.word} 操作菜单`}
    >
      <div
        className="w-full max-w-xs overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">操作</div>
          <div className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100">
            {word.word}
          </div>
        </div>

        {/* 立即复习 */}
        <button
          type="button"
          onClick={onReview}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <span aria-hidden="true">📚</span>
          立即复习
        </button>

        {/* 删除 */}
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <span aria-hidden="true">🗑️</span>
          删除
        </button>

        {/* 取消 */}
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center gap-3 border-t border-gray-200 px-4 py-3 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <span aria-hidden="true">✕</span>
          取消
        </button>
      </div>
    </div>
  )
}
