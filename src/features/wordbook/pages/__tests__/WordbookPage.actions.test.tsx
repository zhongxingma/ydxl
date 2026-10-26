// WordbookPage 交互与编排单元测试
//
// 覆盖场景：
// 1. 全选 / 反选与单个选中切换
// 2. 编辑笔记：保存后刷新列表
// 3. 单个删除：确认取消不删除；确认后删除并清理选中、刷新列表与统计
// 4. 批量删除：空选中直接返回；取消不删除；确认后批量删除并清空选中
// 5. 长按操作菜单：立即复习跳转、菜单删除、取消关闭
// 6. 添加 / 批量导入 Modal：关闭后刷新列表与统计
// 7. 卡片收藏 / AI 补全后的刷新回调
//
// Mock 策略：列表服务 mock + 子组件轻量替身，聚焦页面编排逻辑
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Word } from '@/shared/types'
import { useWordbookStore } from '../../store'
import {
  getWordbook,
  getWordbookStats,
  removeFromWordbook,
  bulkRemove,
} from '../../services/wordbookService'
import WordbookPage from '../WordbookPage'

vi.mock('../../services/wordbookService', () => ({
  getWordbook: vi.fn(),
  getWordbookStats: vi.fn(),
  removeFromWordbook: vi.fn(),
  bulkRemove: vi.fn(),
  wordbookService: {
    bulkRemove: vi.fn(),
    removeFromWordbook: vi.fn(),
  },
}))

vi.mock('../../components/WordCard', () => ({
  default: ({
    word,
    selected,
    onSelect,
    onEditNote,
    onDelete,
    onLongPress,
    onRefresh,
  }: {
    word: Word
    selected: boolean
    onSelect: (id: string) => void
    onEditNote: (word: Word) => void
    onDelete: (word: Word) => void
    onLongPress: (word: Word) => void
    onRefresh?: () => void
  }) => (
    <div data-testid={`card-${word.id}`}>
      <span>{word.word}</span>
      <span>{selected ? '已选中' : '未选中'}</span>
      <button type="button" onClick={() => onSelect(word.id)}>
        选择
      </button>
      <button type="button" onClick={() => onEditNote(word)}>
        编辑笔记
      </button>
      <button type="button" onClick={() => onDelete(word)}>
        删除单词
      </button>
      <button type="button" onClick={() => onLongPress(word)}>
        长按菜单
      </button>
      <button type="button" onClick={() => onRefresh?.()}>
        卡片刷新
      </button>
    </div>
  ),
}))

vi.mock('../../components/BulkActionBar', () => ({
  default: ({
    visibleCount,
    selectedCount,
    onSelectAll,
    onInvertSelection,
    onDeleteSelected,
  }: {
    visibleCount: number
    selectedCount: number
    allSelected: boolean
    onSelectAll: () => void
    onInvertSelection: () => void
    onDeleteSelected: () => void
  }) => (
    <div>
      <span>{`共 ${visibleCount} 个 · 已选 ${selectedCount} 个`}</span>
      <button type="button" onClick={onSelectAll}>
        全选
      </button>
      <button type="button" onClick={onInvertSelection}>
        反选
      </button>
      <button type="button" onClick={onDeleteSelected}>
        删除选中
      </button>
    </div>
  ),
}))

vi.mock('../../components/WordbookToolbar', () => ({
  default: ({
    onAddClick,
    onImportClick,
  }: {
    onAddClick: () => void
    onImportClick: () => void
  }) => (
    <div>
      <button type="button" onClick={onAddClick}>
        添加单词
      </button>
      <button type="button" onClick={onImportClick}>
        批量导入
      </button>
    </div>
  ),
}))

vi.mock('../../components/NoteEditor', () => ({
  default: ({
    word,
    onClose,
    onSaved,
  }: {
    word: Word | null
    onClose: () => void
    onSaved?: () => void
  }) =>
    word ? (
      <div>
        <span>{`笔记编辑：${word.word}`}</span>
        <button
          type="button"
          onClick={() => {
            onSaved?.()
            onClose()
          }}
        >
          保存笔记
        </button>
        <button type="button" onClick={onClose}>
          关闭笔记
        </button>
      </div>
    ) : null,
}))

vi.mock('../../components/AddWordModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button type="button" onClick={onClose}>
        关闭添加
      </button>
    ) : null,
}))

vi.mock('../../components/ImportWordsModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button type="button" onClick={onClose}>
        关闭导入
      </button>
    ) : null,
}))

vi.mock('../../components/WordbookActionMenu', () => ({
  default: ({
    word,
    onReview,
    onDelete,
    onClose,
  }: {
    word: Word
    onReview: () => void
    onDelete: () => void
    onClose: () => void
  }) => (
    <div role="dialog" aria-label={`${word.word} 操作菜单`}>
      <button type="button" onClick={onReview}>
        立即复习
      </button>
      <button type="button" onClick={onDelete}>
        菜单删除
      </button>
      <button type="button" onClick={onClose}>
        菜单取消
      </button>
    </div>
  ),
}))

const getWordbookMock = vi.mocked(getWordbook)
const getWordbookStatsMock = vi.mocked(getWordbookStats)
const removeMock = vi.mocked(removeFromWordbook)
const bulkRemoveMock = vi.mocked(bulkRemove)

function makeWord(id: string): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: `/ˈ${id}/`,
    pos: 'n.',
    definition: id,
    example: `${id} example`,
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/wordbook']}>
      <Routes>
        <Route path="/wordbook" element={<WordbookPage />} />
        <Route path="/review" element={<div>复习页占位</div>} />
      </Routes>
    </MemoryRouter>
  )
}

async function waitForList() {
  await screen.findByTestId('card-apple')
}

describe('WordbookPage 交互与编排', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    useWordbookStore.getState().clearSelection()
    getWordbookMock.mockResolvedValue({
      items: [makeWord('apple'), makeWord('pear')],
      total: 2,
      limit: 20,
      offset: 0,
    })
    getWordbookStatsMock.mockResolvedValue({ total: 2, mastered: 0, pendingReview: 2 })
    removeMock.mockResolvedValue()
    bulkRemoveMock.mockResolvedValue()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('全选 / 反选与单个选中切换同步到批量操作栏', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByText('共 2 个 · 已选 2 个')).toBeInTheDocument()
    expect(within(screen.getByTestId('card-apple')).getByText('已选中')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '反选' }))
    expect(screen.getByText('共 2 个 · 已选 0 个')).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '选择' }))
    expect(screen.getByText('共 2 个 · 已选 1 个')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '反选' }))
    expect(screen.getByText('共 2 个 · 已选 1 个')).toBeInTheDocument()
    expect(within(screen.getByTestId('card-apple')).getByText('未选中')).toBeInTheDocument()
    expect(within(screen.getByTestId('card-pear')).getByText('已选中')).toBeInTheDocument()
  })

  it('编辑笔记后保存会刷新列表并关闭编辑器', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '编辑笔记' }))
    expect(screen.getByText('笔记编辑：apple')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }))

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('笔记编辑：apple')).not.toBeInTheDocument()
  })

  it('单个删除确认取消时不调用删除服务', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '删除单词' }))

    expect(confirmSpy).toHaveBeenCalledWith('确定要删除「apple」吗？')
    expect(removeMock).not.toHaveBeenCalled()
    expect(getWordbookMock).toHaveBeenCalledTimes(2)
  })

  it('单个删除确认后删除、清理选中并刷新列表与统计', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '选择' }))
    expect(screen.getByText('共 2 个 · 已选 1 个')).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '删除单词' }))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('apple'))
    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('共 2 个 · 已选 0 个')).toBeInTheDocument()
  })

  it('未选中任何生词时点击批量删除直接返回', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(bulkRemoveMock).not.toHaveBeenCalled()
  })

  it('批量删除确认取消时不调用批量删除服务', async () => {
    confirmSpy.mockReturnValue(false)
    renderPage()
    await waitForList()

    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))

    expect(confirmSpy).toHaveBeenCalledWith('确定要删除选中的 2 个生词吗？此操作不可撤销。')
    expect(bulkRemoveMock).not.toHaveBeenCalled()
    expect(screen.getByText('共 2 个 · 已选 2 个')).toBeInTheDocument()
  })

  it('批量删除确认后清空选中并刷新列表与统计', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))

    await waitFor(() => expect(bulkRemoveMock).toHaveBeenCalledWith(['apple', 'pear']))
    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('共 2 个 · 已选 0 个')).toBeInTheDocument()
  })

  it('长按菜单「立即复习」跳转复习页', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '长按菜单' }))
    expect(screen.getByRole('dialog', { name: 'apple 操作菜单' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '立即复习' }))

    expect(await screen.findByText('复习页占位')).toBeInTheDocument()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('长按菜单删除会删除当前词、关闭菜单并刷新', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '长按菜单' }))
    fireEvent.click(screen.getByRole('button', { name: '菜单删除' }))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('apple'))
    expect(screen.queryByRole('dialog', { name: 'apple 操作菜单' })).not.toBeInTheDocument()
    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
  })

  it('长按菜单取消仅关闭菜单，不删除生词', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '长按菜单' }))
    fireEvent.click(screen.getByRole('button', { name: '菜单取消' }))

    expect(screen.queryByRole('dialog', { name: 'apple 操作菜单' })).not.toBeInTheDocument()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('添加单词 Modal 关闭后刷新列表与统计', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(screen.getByRole('button', { name: '添加单词' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭添加' }))

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: '关闭添加' })).not.toBeInTheDocument()
  })

  it('批量导入 Modal 关闭后刷新列表与统计', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭导入' }))

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: '关闭导入' })).not.toBeInTheDocument()
  })

  it('卡片刷新回调同时重载列表与统计', async () => {
    renderPage()
    await waitForList()

    fireEvent.click(within(screen.getByTestId('card-apple')).getByRole('button', { name: '卡片刷新' }))

    await waitFor(() => expect(getWordbookMock).toHaveBeenCalledTimes(3))
    expect(getWordbookStatsMock).toHaveBeenCalledTimes(2)
  })
})
