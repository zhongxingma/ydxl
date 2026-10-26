// VocabularyPage 重点词汇汇总页单元测试
//
// 覆盖场景：
// 1. 首次加载展示骨架，完成后渲染统计条、日期分组与词汇卡片
// 2. 空状态与「去阅读」跳转
// 3. 加载失败记录警告并展示空状态
// 4. 组件卸载后丢弃异步结果
// 5. articles 缓存失效事件触发重新加载
//
// Mock 策略：mock 词汇汇总服务与翻转卡片，使用 MemoryRouter 提供路由上下文
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { VocabularyGroup } from '../../types'
import { vocabularySummaryService } from '../../services/vocabularySummaryService'
import { cacheEvents } from '@/shared/services/cacheEvents'
import VocabularyPage from '../VocabularyPage'

vi.mock('../../services/vocabularySummaryService', () => ({
  vocabularySummaryService: { getVocabulariesGroupedByDate: vi.fn() },
}))

vi.mock('../../components/VocabularyFlipCard', () => ({
  default: ({ vocabulary }: { vocabulary: { word: string } }) => (
    <div data-testid="vocabulary-card">{vocabulary.word}</div>
  ),
}))

const getVocabulariesMock = vi.mocked(
  vocabularySummaryService.getVocabulariesGroupedByDate
)

function makeVocabulary(word: string, articleId = 'a1') {
  return {
    word,
    phonetic: `/ˈ${word}/`,
    pos: 'n.',
    definition: `${word} 释义`,
    example: `${word} example`,
    importance: 'high' as const,
    articleId,
    articleTitle: 'Article',
    readAt: Date.now(),
  }
}

function makeGroup(
  date: string,
  dateLabel: string,
  words: string[]
): VocabularyGroup {
  return {
    date,
    dateLabel,
    vocabularies: words.map((w) => makeVocabulary(w, date)),
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/vocabulary']}>
      <Routes>
        <Route path="/vocabulary" element={<VocabularyPage />} />
        <Route path="/reading" element={<div>阅读页占位</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('VocabularyPage 重点词汇', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getVocabulariesMock.mockResolvedValue([])
  })

  it('首次加载展示骨架，完成后渲染统计条、分组与词汇卡片', async () => {
    let resolveGroups: (groups: VocabularyGroup[]) => void = () => {}
    getVocabulariesMock.mockReturnValue(
      new Promise<VocabularyGroup[]>((resolve) => {
        resolveGroups = resolve
      })
    )

    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: '重点词汇' })).toBeInTheDocument()
    expect(
      screen.getByText('按阅读时间整理的重点词汇，点击卡片翻转查看释义与例句')
    ).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    await act(async () => {
      resolveGroups([
        makeGroup('2026-10-26', '今天', ['brave', 'curious']),
        makeGroup('2026-10-25', '昨天', ['resilient']),
      ])
    })

    expect(await screen.findByText('共 3 个词汇')).toBeInTheDocument()
    expect(screen.getByText('来自 2 天的阅读')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('2 个词汇')).toBeInTheDocument()
    expect(screen.getByText('1 个词汇')).toBeInTheDocument()
    expect(screen.getAllByTestId('vocabulary-card')).toHaveLength(3)
    expect(screen.getByText('brave')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('无词汇时展示空状态，「去阅读」跳转阅读页', async () => {
    renderPage()

    expect(await screen.findByText('暂无重点词汇')).toBeInTheDocument()
    expect(
      screen.getByText('完成阅读后，文章中的重点词汇会自动收集到这里')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '去阅读' }))

    expect(await screen.findByText('阅读页占位')).toBeInTheDocument()
  })

  it('加载失败记录警告并展示空状态', async () => {
    getVocabulariesMock.mockRejectedValue(new Error('db down'))

    renderPage()

    expect(await screen.findByText('暂无重点词汇')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith('[VocabularyPage] 加载词汇失败', expect.any(Error))
    expect(screen.queryByText(/共 \d+ 个词汇/)).not.toBeInTheDocument()
  })

  it('组件卸载后丢弃异步加载结果', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveGroups: (groups: VocabularyGroup[]) => void = () => {}
    getVocabulariesMock.mockReturnValue(
      new Promise<VocabularyGroup[]>((resolve) => {
        resolveGroups = resolve
      })
    )

    const { unmount } = renderPage()
    unmount()

    await act(async () => {
      resolveGroups([makeGroup('2026-10-26', '今天', ['late'])])
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('articles 缓存失效事件触发重新加载', async () => {
    getVocabulariesMock.mockResolvedValueOnce([
      makeGroup('2026-10-26', '今天', ['first']),
    ])
    renderPage()
    expect(await screen.findByText('first')).toBeInTheDocument()
    expect(getVocabulariesMock).toHaveBeenCalledTimes(1)

    getVocabulariesMock.mockResolvedValueOnce([
      makeGroup('2026-10-26', '今天', ['first', 'second']),
    ])
    act(() => {
      cacheEvents.emit('articles')
    })

    await waitFor(() => expect(getVocabulariesMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('second')).toBeInTheDocument()
    expect(screen.getByText('共 2 个词汇')).toBeInTheDocument()
  })
})
