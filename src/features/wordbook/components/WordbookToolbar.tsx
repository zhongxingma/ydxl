// 生词本顶部工具栏：搜索框 + 排序选择 + 统计概览
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'
import type { WordbookSortBy, WordbookStats } from '../types'

interface WordbookToolbarProps {
  // 搜索关键字
  search: string
  sortBy: WordbookSortBy
  // 统计数据
  stats: WordbookStats
  // 仅看收藏开关状态
  onlyFavorite: boolean
  // 修改搜索关键字
  onSearchChange: (value: string) => void
  // 修改排序方式
  onSortByChange: (sortBy: WordbookSortBy) => void
  // 修改「仅看收藏」筛选状态
  onOnlyFavoriteChange: (value: boolean) => void
  // 点击「添加单词」按钮
  onAddClick: () => void
  // 点击「导入」按钮
  onImportClick: () => void
}

const SORT_BY_OPTIONS: { value: WordbookSortBy; labelKey: string }[] = [
  { value: 'createdAt-desc', labelKey: 'wordbook.toolbar.sort_created_at' },
  { value: 'nextReview-asc', labelKey: 'wordbook.toolbar.sort_next_review' },
  { value: 'alphabet', labelKey: 'wordbook.toolbar.sort_alphabet' },
]

export default function WordbookToolbar({
  search,
  sortBy,
  stats,
  onlyFavorite,
  onSearchChange,
  onSortByChange,
  onOnlyFavoriteChange,
  onAddClick,
  onImportClick,
}: WordbookToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {/* 搜索框 + 仅看收藏开关 + 排序 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* 搜索框 */}
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
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
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          </span>
          <input
            type="text"
            aria-label={t('wordbook.toolbar.search_label')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('wordbook.search_placeholder')}
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        {/* 仅看收藏 toggle 按钮 */}
        <button
          type="button"
          onClick={() => onOnlyFavoriteChange(!onlyFavorite)}
          className={cn(
            'flex h-[38px] items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
            onlyFavorite
              ? 'border-yellow-300 bg-yellow-100 text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
          )}
          aria-pressed={onlyFavorite}
          aria-label={onlyFavorite ? t('wordbook.toolbar.only_favorite_on') : t('wordbook.toolbar.only_favorite_off')}
        >
          {/* 星星图标：开启时填充，关闭时描边 */}
          {onlyFavorite ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          )}
          <span>{t('wordbook.toolbar.only_favorite')}</span>
        </button>

        {/* 排序选择：按字母 / 添加时间 / 下次复习时间 */}
        <select
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as WordbookSortBy)}
          className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          aria-label={t('wordbook.toolbar.sort_label')}
        >
          {SORT_BY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>

        {/* 添加单词 / 导入 操作按钮 */}
        <div className="flex items-center gap-2">
          {/* 添加单词 */}
          <button
            type="button"
            onClick={onAddClick}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('wordbook.toolbar.add')}
          </button>

          {/* 批量导入 */}
          <button
            type="button"
            onClick={onImportClick}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {t('wordbook.toolbar.import')}
          </button>
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label={t('wordbook.toolbar.stat_total')} value={stats.total} tone="indigo" />
        <StatCard label={t('wordbook.toolbar.stat_mastered')} value={stats.mastered} tone="green" />
        <StatCard label={t('wordbook.toolbar.stat_pending_review')} value={stats.pendingReview} tone="amber" />
      </div>
    </div>
  )
}

// 统计卡片
interface StatCardProps {
  label: string
  value: number
  tone: 'indigo' | 'green' | 'amber'
}

function StatCard({ label, value, tone }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        tone === 'indigo' && 'border-indigo-100 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-900/20',
        tone === 'green' && 'border-green-100 bg-green-50 dark:border-green-900/40 dark:bg-green-900/20',
        tone === 'amber' && 'border-amber-100 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20',
      )}
    >
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-xl font-semibold',
          tone === 'indigo' && 'text-indigo-700 dark:text-indigo-300',
          tone === 'green' && 'text-green-700 dark:text-green-300',
          tone === 'amber' && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {value}
      </div>
    </div>
  )
}
