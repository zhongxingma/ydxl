// 生词本页面：卡片化网格布局 + 无限滚动分页 + 搜索/排序/批量删除/笔记编辑
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Word } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { useWordbookStore } from '../store'
import type { WordbookSortBy, WordbookStats } from '../types'
import { getWordbook, getWordbookStats, removeFromWordbook, bulkRemove } from '../services/wordbookService'
import WordbookToolbar from '../components/WordbookToolbar'
import BulkActionBar from '../components/BulkActionBar'
import WordCard from '../components/WordCard'
import EmptyState from '../components/EmptyState'
import NoteEditor from '../components/NoteEditor'
import AddWordModal from '../components/AddWordModal'
import ImportWordsModal from '../components/ImportWordsModal'

const PAGE_SIZE = 20
// 搜索防抖延迟（毫秒）
const SEARCH_DEBOUNCE_MS = 300

export default function WordbookPage() {
  const navigate = useNavigate()

  // 从 store 获取选中相关状态与 actions（保留 store 用于跨组件选中态共享）
  const selectedIds = useWordbookStore((s) => s.selectedIds)
  const toggleSelect = useWordbookStore((s) => s.toggleSelect)
  const clearSelection = useWordbookStore((s) => s.clearSelection)

  const [items, setItems] = useState<Word[]>([])
  // 过滤后（未掌握 + keyword + onlyFavorite）的总数
  const [total, setTotal] = useState(0)
  // 是否还有更多页可加载
  const [hasMore, setHasMore] = useState(false)
  // 首次加载中
  const [loading, setLoading] = useState(true)
  // 加载更多中
  const [loadingMore, setLoadingMore] = useState(false)
  // 统计数据（基于全部生词，含已掌握）
  const [stats, setStats] = useState<WordbookStats>({ total: 0, mastered: 0, pendingReview: 0 })

  // searchInput 为受控 input 值，keyword 为防抖后实际查询值
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState<WordbookSortBy>('createdAt-desc')
  // 「仅看收藏」筛选状态（本地状态）
  const [onlyFavorite, setOnlyFavorite] = useState(false)

  // 编辑笔记的目标生词
  const [editingWord, setEditingWord] = useState<Word | null>(null)
  // 长按操作菜单的目标生词（为 null 时不显示菜单）
  const [actionMenuWord, setActionMenuWord] = useState<Word | null>(null)
  // 添加单词 Modal 开关
  const [addModalOpen, setAddModalOpen] = useState(false)
  // 批量导入 Modal 开关
  const [importModalOpen, setImportModalOpen] = useState(false)

  // 防抖定时器引用
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 底部哨兵元素引用（IntersectionObserver 监听目标）
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // 当前已加载的 offset（避免闭包陈旧值）
  const offsetRef = useRef(0)
  // 当前查询参数引用（用于 loadMore 读取最新值，避免闭包陈旧）
  const queryRef = useRef({ keyword, sortBy, onlyFavorite })
  // 是否已完成初次挂载加载（避免 mount effect 与 keyword effect 双重触发 loadFirstPage）
  const initializedRef = useRef(false)
  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  // 刷新统计数据（基于全部生词，含已掌握）
  const refreshStats = useCallback(async () => {
    try {
      const s = await getWordbookStats()
      setStats(s)
    } catch (err) {
      console.warn('[WordbookPage] 加载统计数据失败', err)
    }
  }, [])

  // 加载第一页（重置列表）
  const loadFirstPage = useCallback(async () => {
    const query = queryRef.current
    setLoading(true)
    try {
      const res = await getWordbook({
        limit: PAGE_SIZE,
        offset: 0,
        keyword: query.keyword,
        sortBy: query.sortBy,
        onlyFavorite: query.onlyFavorite,
      })
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      setItems(res.items)
      setTotal(res.total)
      offsetRef.current = res.items.length
      setHasMore(res.items.length < res.total)
    } catch (err) {
      console.warn('[WordbookPage] 加载生词列表失败', err)
      // 组件已卸载则放弃更新
      if (!mountedRef.current) return
      setItems([])
      setTotal(0)
      setHasMore(false)
    } finally {
      // 组件已卸载则放弃更新
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // 加载下一页（无限滚动触发）
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const query = queryRef.current
    setLoadingMore(true)
    try {
      const res = await getWordbook({
        limit: PAGE_SIZE,
        offset: offsetRef.current,
        keyword: query.keyword,
        sortBy: query.sortBy,
        onlyFavorite: query.onlyFavorite,
      })
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      // 追加到已加载列表（按 id 去重，避免边界重复）
      setItems((prev) => {
        const existingIds = new Set(prev.map((w) => w.id))
        const merged = [...prev, ...res.items.filter((w) => !existingIds.has(w.id))]
        return merged
      })
      offsetRef.current += res.items.length
      setHasMore(offsetRef.current < res.total)
    } catch (err) {
      console.warn('[WordbookPage] 加载更多失败', err)
    } finally {
      // 组件已卸载则放弃更新
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [loadingMore, hasMore])

  // 初次挂载：加载第一页 + 加载统计（仅执行一次）
  // SWR 模式：wordbookService.getWordbook 内部使用 getAllLocalFirst，
  //          本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本页面重载
  useEffect(() => {
    // 组件挂载时重置标志，供 loadFirstPage/loadMore 在异步完成后做守卫
    mountedRef.current = true
    let cancelled = false
    const init = async () => {
      if (cancelled) return
      // 同步最新查询参数后加载第一页与统计
      queryRef.current = { keyword, sortBy, onlyFavorite }
      initializedRef.current = true
      await Promise.all([loadFirstPage(), refreshStats()])
    }
    void init()
    return () => {
      // 组件卸载时翻转挂载标志，避免异步任务对已卸载组件写入 state
      mountedRef.current = false
      cancelled = true
    }
    // 仅在挂载时执行一次：keyword/sortBy/onlyFavorite 取初始值
    // 后续变化由下方 keyword effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 订阅 words 缓存事件：wordRepository 后台刷新完成后重载第一页与统计
  // SWR 模式下后台刷新可能更新本地缓存（如跨终端同步），需重读以刷新 UI
  useCacheInvalidated('words', () => {
    void loadFirstPage()
    void refreshStats()
  })

  // 搜索防抖：searchInput 变化后 300ms 更新 keyword（触发 loadFirstPage）
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setKeyword(searchInput)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchInput])

  // keyword / sortBy / onlyFavorite 变化时重置列表并加载第一页
  useEffect(() => {
    // 初次挂载由 mount effect 处理（需等待 mount effect 设置 initializedRef 后再加载）
    if (!initializedRef.current) return
    queryRef.current = { keyword, sortBy, onlyFavorite }
    void loadFirstPage()
  }, [keyword, sortBy, onlyFavorite, loadFirstPage])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    // 不支持 IntersectionObserver 时降级为不自动加载（保留手动能力）
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadMore()
          }
        }
      },
      // 距离视口 200px 时预加载，提升体验
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    // cleanup：卸载时断开观察，避免内存泄漏与对已卸载组件 setState
    return () => {
      observer.disconnect()
    }
  }, [loadMore])

  // 操作菜单打开时监听 Escape 关闭 + 锁定背景滚动
  useEscapeKey(() => setActionMenuWord(null), !!actionMenuWord)
  useEffect(() => {
    if (!actionMenuWord) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [actionMenuWord])

  // 选中数量
  const selectedCount = selectedIds.size
  // 是否全选（当前已加载列表全部被选中）
  const allSelected =
    items.length > 0 && items.every((w) => selectedIds.has(w.id))

  // 全选当前已加载列表
  const handleSelectAll = useCallback(() => {
    // 复用 store 的 toggleSelect，逐个选中未选中的项
    for (const w of items) {
      if (!selectedIds.has(w.id)) {
        toggleSelect(w.id)
      }
    }
  }, [items, selectedIds, toggleSelect])

  // 反选当前已加载列表
  const handleInvertSelection = useCallback(() => {
    for (const w of items) {
      toggleSelect(w.id)
    }
  }, [items, toggleSelect])

  // 编辑笔记
  const handleEditNote = useCallback((word: Word) => {
    setEditingWord(word)
  }, [])

  // 单个删除（带确认）
  const handleDelete = useCallback(
    async (word: Word) => {
      const confirmed = window.confirm(`确定要删除「${word.word}」吗？`)
      if (!confirmed) return
      await removeFromWordbook(word.id)
      // 删除后从选中集合移除并刷新列表与统计
      if (selectedIds.has(word.id)) toggleSelect(word.id)
      await Promise.all([loadFirstPage(), refreshStats()])
    },
    [loadFirstPage, refreshStats, selectedIds, toggleSelect],
  )

  // 批量删除（带确认）
  const handleDeleteSelected = useCallback(async () => {
    if (selectedCount === 0) return
    const confirmed = window.confirm(`确定要删除选中的 ${selectedCount} 个生词吗？此操作不可撤销。`)
    if (!confirmed) return
    const ids = Array.from(selectedIds)
    await bulkRemove(ids)
    clearSelection()
    await Promise.all([loadFirstPage(), refreshStats()])
  }, [clearSelection, loadFirstPage, refreshStats, selectedCount, selectedIds])

  // 笔记保存后刷新列表（仅刷新当前页，不影响分页位置）
  const handleNoteSaved = useCallback(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  // 长按触发：打开操作菜单
  const handleLongPress = useCallback((word: Word) => {
    setActionMenuWord(word)
  }, [])

  // 操作菜单：立即复习（跳转复习页）
  const handleMenuReview = useCallback(() => {
    setActionMenuWord(null)
    navigate('/review')
  }, [navigate])

  // 操作菜单：删除当前词
  const handleMenuDelete = useCallback(async () => {
    const word = actionMenuWord
    if (!word) return
    setActionMenuWord(null)
    await removeFromWordbook(word.id)
    if (selectedIds.has(word.id)) toggleSelect(word.id)
    await Promise.all([loadFirstPage(), refreshStats()])
  }, [actionMenuWord, loadFirstPage, refreshStats, selectedIds, toggleSelect])

  // 操作菜单：取消
  const handleMenuClose = useCallback(() => {
    setActionMenuWord(null)
  }, [])

  // WordCard 收藏/AI 补全后的刷新回调
  const handleCardRefresh = useCallback(() => {
    void loadFirstPage()
    void refreshStats()
  }, [loadFirstPage, refreshStats])

  // 当过滤后总数为 0 但统计的总数 > 0 时，说明所有单词已掌握
  const isAllMastered = total === 0 && stats.total > 0

  // 加载中骨架（首次加载）
  const showInitialLoading = loading && items.length === 0

  return (
    <div className="space-y-4 pb-8">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">生词本</h1>
      </div>

      {/* 顶部工具栏：搜索 + 仅看收藏 + 排序 + 统计 */}
      <WordbookToolbar
        search={searchInput}
        sortBy={sortBy}
        stats={stats}
        onlyFavorite={onlyFavorite}
        onSearchChange={setSearchInput}
        onSortByChange={setSortBy}
        onOnlyFavoriteChange={setOnlyFavorite}
        onAddClick={() => setAddModalOpen(true)}
        onImportClick={() => setImportModalOpen(true)}
      />

      {/* 首次加载中 */}
      {showInitialLoading ? (
        <div className="py-16 text-center text-gray-500 dark:text-gray-400">加载中…</div>
      ) : total === 0 ? (
        isAllMastered ? (
          // 所有单词已掌握
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-green-300 bg-green-50/50 py-16 px-4 text-center dark:border-green-700 dark:bg-green-900/10">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl dark:bg-green-900/40">
              🎉
            </div>
            <p className="text-base font-medium text-green-700 dark:text-green-300">
              生词本已清空，所有单词已掌握 🎉
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              继续阅读文章以发现新的生词
            </p>
          </div>
        ) : (
          // 真正的空状态：还没有任何生词
          <EmptyState />
        )
      ) : (
        <>
          {/* 底部批量操作栏 */}
          <BulkActionBar
            visibleCount={items.length}
            selectedCount={selectedCount}
            allSelected={allSelected}
            onSelectAll={handleSelectAll}
            onInvertSelection={handleInvertSelection}
            onDeleteSelected={handleDeleteSelected}
          />

          {/* 生词卡片网格：响应式 1/2/3 列 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((word) => (
              <WordCard
                key={word.id}
                word={word}
                selected={selectedIds.has(word.id)}
                onSelect={toggleSelect}
                onEditNote={handleEditNote}
                onDelete={handleDelete}
                onLongPress={handleLongPress}
                onRefresh={handleCardRefresh}
              />
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

      {/* 编辑笔记 Modal */}
      <NoteEditor
        word={editingWord}
        onClose={() => setEditingWord(null)}
        onSaved={handleNoteSaved}
      />

      {/* 长按操作菜单 Modal */}
      {actionMenuWord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={handleMenuClose}
          role="dialog"
          aria-modal="true"
          aria-label={`${actionMenuWord.word} 操作菜单`}
        >
          <div
            className="w-full max-w-xs overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题 */}
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">操作</div>
              <div className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100">
                {actionMenuWord.word}
              </div>
            </div>

            {/* 立即复习 */}
            <button
              type="button"
              onClick={handleMenuReview}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <span aria-hidden="true">📚</span>
              立即复习
            </button>

            {/* 删除 */}
            <button
              type="button"
              onClick={handleMenuDelete}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <span aria-hidden="true">🗑️</span>
              删除
            </button>

            {/* 取消 */}
            <button
              type="button"
              onClick={handleMenuClose}
              className="flex w-full items-center gap-3 border-t border-gray-200 px-4 py-3 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <span aria-hidden="true">✕</span>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 添加单词 Modal：保存成功后刷新列表与统计 */}
      <AddWordModal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false)
          void loadFirstPage()
          void refreshStats()
        }}
      />

      {/* 批量导入 Modal：导入完成后刷新列表与统计 */}
      <ImportWordsModal
        open={importModalOpen}
        onClose={() => {
          setImportModalOpen(false)
          void loadFirstPage()
          void refreshStats()
        }}
      />
    </div>
  )
}
