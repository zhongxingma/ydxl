// 底部批量操作栏：全选 / 反选 / 删除选中
// 仅在存在生词时由父组件渲染
import { useTranslation } from '@/shared/i18n/useTranslation'

interface BulkActionBarProps {
  // 当前过滤后可见的生词总数
  visibleCount: number
  // 选中数量
  selectedCount: number
  // 是否全部选中（可见列表）
  allSelected: boolean
  // 全选
  onSelectAll: () => void
  // 反选
  onInvertSelection: () => void
  // 删除选中（内部会触发确认）
  onDeleteSelected: () => void
}

export default function BulkActionBar({
  visibleCount,
  selectedCount,
  allSelected,
  onSelectAll,
  onInvertSelection,
  onDeleteSelected,
}: BulkActionBarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        {/* 全选 checkbox */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            disabled={visibleCount === 0}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700"
            aria-label={t('wordbook.bulk.select_all')}
          />
          {t('wordbook.bulk.select_all')}
        </label>

        <button
          type="button"
          onClick={onInvertSelection}
          disabled={visibleCount === 0}
          className="rounded px-2 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('wordbook.bulk.invert_selection')}
        </button>

        <span className="text-sm text-gray-500 dark:text-gray-400">
          {t('wordbook.bulk.summary', { visibleCount, selectedCount })}
        </span>
      </div>

      <button
        type="button"
        onClick={onDeleteSelected}
        disabled={selectedCount === 0}
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
      >
        {t('wordbook.bulk.delete_selected', { count: selectedCount })}
      </button>
    </div>
  )
}
