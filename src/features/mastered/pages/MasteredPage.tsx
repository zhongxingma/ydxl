// 已掌握单词/短语页面：卡片化网格布局 + 无限滚动分页 + 搜索/排序
// 列表状态与副作用下沉至 hooks/useMasteredWords，卡片视图拆分至 components/MasteredWordCard
// 样式参考 wordbook 模块的 TailwindCSS 风格
import MasteredWordCard from '../components/MasteredWordCard'
import { useMasteredWords } from '../hooks/useMasteredWords'
import type { MasteredSortBy } from '../types'

// 排序方式选项：字母顺序 / 最近掌握时间 / 添加时间
const SORT_BY_OPTIONS: { value: MasteredSortBy; label: string }[] = [
  { value: 'masteredAt-desc', label: '最近掌握时间' },
  { value: 'createdAt-desc', label: '添加时间' },
  { value: 'alphabet', label: '字母顺序' },
]

export default function MasteredPage() {
  const {
    items,
    total,
    hasMore,
    loading,
    loadingMore,
    searchInput,
    setSearchInput,
    sortBy,
    setSortBy,
    sentinelRef,
  } = useMasteredWords()

  // 首次加载中骨架
  const showInitialLoading = loading && items.length === 0

  return (
    <div className="space-y-4 pb-8">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">已掌握</h1>
        {/* 总数概览 */}
        {!showInitialLoading && total > 0 && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            共 {total} 个
          </span>
        )}
      </div>

      {/* 顶部工具栏：搜索 + 排序 */}
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
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索单词…"
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
            aria-label="搜索单词"
          />
        </div>

        {/* 排序选择 */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as MasteredSortBy)}
          className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          aria-label="排序方式"
        >
          {SORT_BY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 首次加载中 */}
      {showInitialLoading ? (
        <div className="py-16 text-center text-gray-500 dark:text-gray-400">加载中…</div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 py-16 px-4 text-center dark:border-indigo-700 dark:bg-indigo-900/10">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-3xl dark:bg-indigo-900/40">
            💪
          </div>
          <p className="text-base font-medium text-indigo-700 dark:text-indigo-300">
            还没有已掌握的单词，继续加油 💪
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            通过复习让单词达到掌握即可在此查看
          </p>
        </div>
      ) : (
        <>
          {/* 已掌握单词卡片网格：响应式 1/2/3 列 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((word) => (
              <MasteredWordCard key={word.id} word={word} />
            ))}
          </div>

          {/* 无限滚动底部哨兵 + 加载状态 */}
          <div
            ref={sentinelRef}
            className="flex h-12 items-center justify-center text-sm text-gray-400 dark:text-gray-500"
            aria-hidden={loadingMore ? undefined : true}
          >
            {loadingMore
              ? '加载更多…'
              : hasMore
                ? '滚动加载更多'
                : '没有更多了'}
          </div>
        </>
      )}
    </div>
  )
}
