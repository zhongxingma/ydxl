// PhrasesPage 重点短语汇总页单元测试
//
// 覆盖场景：
// 1. 首次加载展示骨架，完成后渲染统计条、日期分组与短语卡片
// 2. 空状态与「去阅读」跳转
// 3. 加载失败记录警告并展示空状态
// 4. 组件卸载后丢弃异步结果
// 5. articles 缓存失效事件触发重新加载
//
// Mock 策略：mock 短语服务与翻转卡片，使用 MemoryRouter 提供路由上下文
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { PhraseGroup } from '../../types'
import { phraseService } from '../../services/phraseService'
import { cacheEvents } from '@/shared/services/cacheEvents'
import PhrasesPage from '../PhrasesPage'

vi.mock('../../services/phraseService', () => ({
  phraseService: { getPhrasesGroupedByDate: vi.fn() },
}))

vi.mock('../../components/PhraseFlipCard', () => ({
  default: ({ phrase }: { phrase: { phrase: string } }) => (
    <div data-testid="phrase-card">{phrase.phrase}</div>
  ),
}))

const getPhrasesMock = vi.mocked(phraseService.getPhrasesGroupedByDate)

function makePhrase(phrase: string, articleId = 'a1') {
  return {
    phrase,
    meaning: `${phrase} 释义`,
    articleId,
    articleTitle: 'Article',
    readAt: Date.now(),
  }
}

function makeGroup(date: string, dateLabel: string, phrases: string[]): PhraseGroup {
  return {
    date,
    dateLabel,
    phrases: phrases.map((p) => makePhrase(p, date)),
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/phrases']}>
      <Routes>
        <Route path="/phrases" element={<PhrasesPage />} />
        <Route path="/reading" element={<div>阅读页占位</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PhrasesPage 重点短语', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getPhrasesMock.mockResolvedValue([])
  })

  it('首次加载展示骨架，完成后渲染统计条、分组与短语卡片', async () => {
    let resolveGroups: (groups: PhraseGroup[]) => void = () => {}
    getPhrasesMock.mockReturnValue(
      new Promise<PhraseGroup[]>((resolve) => {
        resolveGroups = resolve
      })
    )

    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: '重点短语' })).toBeInTheDocument()
    expect(
      screen.getByText('按阅读时间整理的重点短语，点击卡片翻转查看释义')
    ).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    await act(async () => {
      resolveGroups([
        makeGroup('2026-10-26', '今天', ['take care of', 'look up']),
        makeGroup('2026-10-25', '昨天', ['in the end']),
      ])
    })

    expect(await screen.findByText('共 3 个短语')).toBeInTheDocument()
    expect(screen.getByText('来自 2 天的阅读')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('2 个短语')).toBeInTheDocument()
    expect(screen.getByText('1 个短语')).toBeInTheDocument()
    expect(screen.getAllByTestId('phrase-card')).toHaveLength(3)
    expect(screen.getByText('take care of')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('无短语时展示空状态，「去阅读」跳转阅读页', async () => {
    renderPage()

    expect(await screen.findByText('暂无重点短语')).toBeInTheDocument()
    expect(
      screen.getByText('完成阅读后，文章中的重点短语会自动收集到这里')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '去阅读' }))

    expect(await screen.findByText('阅读页占位')).toBeInTheDocument()
  })

  it('加载失败记录警告并展示空状态', async () => {
    getPhrasesMock.mockRejectedValue(new Error('db down'))

    renderPage()

    expect(await screen.findByText('暂无重点短语')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith('[PhrasesPage] 加载短语失败', expect.any(Error))
    expect(screen.queryByText(/共 \d+ 个短语/)).not.toBeInTheDocument()
  })

  it('组件卸载后丢弃异步加载结果', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveGroups: (groups: PhraseGroup[]) => void = () => {}
    getPhrasesMock.mockReturnValue(
      new Promise<PhraseGroup[]>((resolve) => {
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
    getPhrasesMock.mockResolvedValueOnce([makeGroup('2026-10-26', '今天', ['first'])])
    renderPage()
    expect(await screen.findByText('first')).toBeInTheDocument()
    expect(getPhrasesMock).toHaveBeenCalledTimes(1)

    getPhrasesMock.mockResolvedValueOnce([
      makeGroup('2026-10-26', '今天', ['first', 'second']),
    ])
    act(() => {
      cacheEvents.emit('articles')
    })

    await waitFor(() => expect(getPhrasesMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('second')).toBeInTheDocument()
    expect(screen.getByText('共 2 个短语')).toBeInTheDocument()
  })
})
