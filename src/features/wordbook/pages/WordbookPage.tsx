// 生词本页面：卡片化网格布局 + 无限滚动分页 + 搜索/排序/批量删除/笔记编辑
//
// 列表数据与分页下沉至 hooks/useWordbookList；长按操作菜单拆为 WordbookActionMenu。
// 页面仅保留选中态、删除操作与各 Modal 编排。
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Word } from '@/shared/types'
import { useWordbookStore } from '../store'
import { removeFromWordbook, bulkRemove } from '../services/wordbookService'
import WordbookToolbar from '../components/WordbookToolbar'
import BulkActionBar from '../components/BulkActionBar'
import WordCard from '../components/WordCard'
import EmptyState from '../components/EmptyState'
import NoteEditor from '../components/NoteEditor'
import AddWordModal from '../components/AddWordModal'
import ImportWordsModal from '../components/ImportWordsModal'
import WordbookActionMenu from '../components/WordbookActionMenu'
import { useWordbookList } from '../hooks/useWordbookList'

export default function WordbookPage() {
  const navigate = useNavigate()

  // 从 store 获取选中相关状态与 actions（保留 store 用于跨组件选中态共享）
  const selectedIds = useWordbookStore((s) => s.selectedIds)
  const toggleSelect = useWordbookStore((s) => s.toggleSelect)
  const clearSelection = useWordbookStore((s) => s.clearSelection)

  // 列表数据、分页、统计与搜索/排序状态
  const {
    items,
    total,
    stats,
    hasMore,
    loadingMore,
    searchInput,
    setSearchInput,
    sortBy,
    setSortBy,
    onlyFavorite,
    setOnlyFavorite,
    sentinelRef,
    loadFirstPage,
    refreshStats,
    isAllMastered,
    showInitialLoading,
  } = useWordbookList()

  // 编辑笔记的目标生词
  const [editingWord, setEditingWord] = useState<Word | null>(null)
  // 长按操作菜单的目标生词（为 null 时不显示菜单）
  const [actionMenuWord, setActionMenuWord] = useState<Word | null>(null)
  // 添加单词 Modal 开关
  const [addModalOpen, setAddModalOpen] = useState(false)
  // 批量导入 Modal 开关
  const [importModalOpen, setImportModalOpen] = useState(false)

  // 选中数量
  const selectedCount = selectedIds.size
  // 是否全选（当前已加载列表全部被选中）
  const allSelected = items.length > 0 && items.every((w) => selectedIds.has(w.id))

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

  // WordCard 收藏/AI 补全后的刷新回调
  const handleCardRefresh = useCallback(() => {
    void loadFirstPage()
    void refreshStats()
  }, [loadFirstPage, refreshStats])

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
        <WordbookActionMenu
          word={actionMenuWord}
          onReview={handleMenuReview}
          onDelete={() => void handleMenuDelete()}
          onClose={() => setActionMenuWord(null)}
        />
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
