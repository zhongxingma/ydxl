// 复习列表与完成评价视图单元测试
//
// 覆盖场景：
// 1. ReviewListView：加载 / 失败 / 三种空状态 / 就绪列表
// 2. 就绪列表：统计与上限徽章、顽固与逾期标记、稳固度、相对时间、点击进入复习
// 3. ReviewCompleteView：无单词兜底、词条信息、两种评价回调、处理中禁用与防重复
//
// 环境依赖：真实 OverdueBadge / StabilityBar 组件；相对时间按当前时间构造。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Word } from '@/shared/types'
import type { TodayReviewQueueInfo } from '../../services/reviewService'
import ReviewListView from '../ReviewListView'
import ReviewCompleteView from '../ReviewCompleteView'

const DAY_MS = 24 * 60 * 60 * 1000

function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    updated_at: now,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    ...overrides,
  }
}

function makeQueue(
  words: Word[],
  overrides: Partial<TodayReviewQueueInfo> = {}
): TodayReviewQueueInfo {
  return {
    words,
    total: words.length,
    limit: 10,
    reachedLimit: false,
    ...overrides,
  }
}

function renderList(props: {
  queueInfo: TodayReviewQueueInfo | null
  status: 'loading' | 'ready' | 'empty' | 'error'
  errorMsg?: string | null
  sessionReviewedCount?: number
  onWordClick?: (word: Word) => void
  onReload?: () => void
}) {
  const onWordClick = props.onWordClick ?? vi.fn()
  const onReload = props.onReload ?? vi.fn()
  const view = render(
    <MemoryRouter>
      <ReviewListView
        queueInfo={props.queueInfo}
        status={props.status}
        errorMsg={props.errorMsg ?? null}
        sessionReviewedCount={props.sessionReviewedCount ?? 0}
        onWordClick={onWordClick}
        onReload={onReload}
      />
    </MemoryRouter>
  )
  return { ...view, onWordClick, onReload }
}

describe('ReviewListView 复习列表', () => {
  it('加载状态展示提示文案', () => {
    renderList({ queueInfo: null, status: 'loading' })

    expect(screen.getByText('正在加载复习内容...')).toBeInTheDocument()
  })

  it('失败状态展示错误信息并可重新加载', () => {
    const onReload = vi.fn()
    renderList({
      queueInfo: null,
      status: 'error',
      errorMsg: '网络异常',
      onReload,
    })

    expect(screen.getByText('加载失败')).toBeInTheDocument()
    expect(screen.getByText('网络异常')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('会话内已复习完时展示完成空状态', () => {
    renderList({
      queueInfo: makeQueue([], { total: 5 }),
      status: 'empty',
      sessionReviewedCount: 5,
    })

    expect(screen.getByText('今日复习已完成 🎉')).toBeInTheDocument()
    expect(screen.getByText('你已经完成今日所有复习，太棒了！')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去阅读' })).toHaveAttribute(
      'href',
      '/reading'
    )
    expect(screen.getByRole('link', { name: '查看生词本' })).toHaveAttribute(
      'href',
      '/wordbook'
    )
  })

  it('达到每日上限时展示上限空状态', () => {
    renderList({
      queueInfo: makeQueue([], { total: 120, limit: 50, reachedLimit: true }),
      status: 'empty',
    })

    expect(screen.getByText('已达每日复习上限')).toBeInTheDocument()
    expect(
      screen.getByText('超出上限的单词将延后到明天复习。')
    ).toBeInTheDocument()
  })

  it('无待复习单词时展示普通空状态并可刷新', () => {
    const onReload = vi.fn()
    renderList({ queueInfo: null, status: 'empty', onReload })

    expect(screen.getByText('今天没有待复习的单词')).toBeInTheDocument()
    expect(
      screen.getByText('继续保持！去阅读文章积累新单词吧。')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('就绪状态展示统计、上限徽章与单词明细', () => {
    const now = Date.now()
    const apple = makeWord('apple', {
      phonetic: '/ˈæpl/',
      pos: 'n.',
      definition: '苹果',
      stubbornCount: 3,
      stabilityScore: 60,
      nextReview: now - 2 * DAY_MS,
    })
    const banana = makeWord('banana', {
      stabilityScore: 20,
      nextReview: now + 3 * DAY_MS,
    })
    const onWordClick = vi.fn()

    renderList({
      queueInfo: makeQueue([apple, banana], {
        total: 12,
        limit: 10,
        reachedLimit: true,
      }),
      status: 'ready',
      onWordClick,
    })

    expect(screen.getByText('单词复习')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('已达每日复习上限')).toBeInTheDocument()

    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()
    expect(screen.getByText(/苹果/)).toBeInTheDocument()
    expect(screen.getByText('顽固')).toBeInTheDocument()
    expect(screen.getByText('逾期')).toBeInTheDocument()
    expect(screen.getByText(/已逾期 2 天/)).toBeInTheDocument()
    expect(screen.getByText(/3 天后/)).toBeInTheDocument()

    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(2)
    expect(bars[0]).toHaveAttribute('aria-valuenow', '60')
    expect(bars[1]).toHaveAttribute('aria-valuenow', '20')

    fireEvent.click(screen.getByRole('button', { name: /apple/ }))
    expect(onWordClick).toHaveBeenCalledWith(apple)
  })

  it('缺少释义与音标时不渲染对应行', () => {
    renderList({
      queueInfo: makeQueue([makeWord('plain')], { total: 1, limit: 10 }),
      status: 'ready',
    })

    expect(screen.getByText('plain')).toBeInTheDocument()
    expect(screen.queryByText('顽固')).not.toBeInTheDocument()
    expect(screen.queryByText('逾期')).not.toBeInTheDocument()
  })
})

describe('ReviewCompleteView 复习评价', () => {
  it('无当前词时展示异常兜底并可返回列表', () => {
    const onBackToList = vi.fn()
    render(
      <ReviewCompleteView
        word={null}
        onRating={vi.fn()}
        onBackToList={onBackToList}
      />
    )

    expect(screen.getByText('状态异常，请返回列表。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }))
    expect(onBackToList).toHaveBeenCalledTimes(1)
  })

  it('展示当前词信息与评价选项', () => {
    render(
      <ReviewCompleteView
        word={makeWord('apple', {
          phonetic: '/ˈæpl/',
          pos: 'n.',
          definition: '苹果',
        })}
        onRating={vi.fn()}
        onBackToList={vi.fn()}
      />
    )

    expect(screen.getByText('复习评价')).toBeInTheDocument()
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()
    expect(screen.getByText(/苹果/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '还需复习' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已掌握' })).toBeInTheDocument()
  })

  it('点击评价后进入处理中并禁用按钮，完成后恢复', async () => {
    let resolveRating: (() => void) | undefined
    const onRating = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRating = resolve
        })
    )

    render(
      <ReviewCompleteView
        word={makeWord('apple')}
        onRating={onRating}
        onBackToList={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '已掌握' }))

    expect(onRating).toHaveBeenCalledWith('mastered')
    const applyingButton = screen.getByRole('button', { name: '处理中...' })
    expect(applyingButton).toBeDisabled()
    expect(screen.getByRole('button', { name: '还需复习' })).toBeDisabled()

    // 处理中再次点击不会重复提交
    fireEvent.click(screen.getByRole('button', { name: '还需复习' }))
    expect(onRating).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRating?.()
    })

    expect(screen.getByRole('button', { name: '已掌握' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '还需复习' })).toBeEnabled()
  })

  it('选择还需复习时回传 review 评价', async () => {
    const onRating = vi.fn().mockResolvedValue(undefined)
    render(
      <ReviewCompleteView
        word={makeWord('apple')}
        onRating={onRating}
        onBackToList={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '还需复习' }))

    expect(onRating).toHaveBeenCalledWith('review')

    // 等待 finally 中的状态恢复，避免 act 警告
    await act(async () => {})
    expect(screen.getByRole('button', { name: '还需复习' })).toBeEnabled()
  })
})
