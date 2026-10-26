// 学习统计页
//
// 覆盖加载态、KPI 概览、周/月折线图数据补零、本周柱状图、阅读能力曲线、
// 模式切换重载、缓存失效事件重载与各数据源失败降级。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { Stats } from '@/shared/types'
import type { ReadingAbilityTrendPoint, StatsMode, StatsOverview } from '../../types'
import { statsService } from '../../services/statsService'
import { cacheEvents } from '@/shared/services/cacheEvents'
import StatsPage from '../StatsPage'

vi.mock('../../services/statsService', () => ({
  statsService: {
    getStatsOverview: vi.fn(),
    getStatsByDateRange: vi.fn(),
    getReadingAbilityTrend: vi.fn(),
  },
}))

// 图表组件仅捕获 props，避免在 jsdom 中渲染 recharts
const chartProps = vi.hoisted(() => ({
  line: [] as Array<{ data: Stats[]; mode: StatsMode }>,
  bar: [] as Array<{ data: Stats[] }>,
  growth: [] as Array<{ data: ReadingAbilityTrendPoint[] }>,
}))

vi.mock('../../components/StatsChart', () => ({
  default: (props: { data: Stats[]; mode: StatsMode }) => {
    chartProps.line.push(props)
    return null
  },
}))

vi.mock('../../components/StatsBarChart', () => ({
  default: (props: { data: Stats[] }) => {
    chartProps.bar.push(props)
    return null
  },
}))

vi.mock('../../components/ReadingGrowthChart', () => ({
  default: (props: { data: ReadingAbilityTrendPoint[] }) => {
    chartProps.growth.push(props)
    return null
  },
}))

const overviewMock = vi.mocked(statsService.getStatsOverview)
const rangeMock = vi.mocked(statsService.getStatsByDateRange)
const trendMock = vi.mocked(statsService.getReadingAbilityTrend)

// 本地日期 YYYY-MM-DD（与 getDateRange 一致）
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatDate(d)
}

const today = daysAgo(0)

const overview: StatsOverview = {
  totalArticles: 12,
  totalWordsMastered: 120,
  currentStreak: 5,
  todayArticlesRead: 2,
  todayWordsLearned: 4,
  todayWordsReviewed: 6,
}

const todayStats: Stats = {
  id: today,
  articlesRead: 1,
  wordsLearned: 2,
  wordsReviewed: 3,
  wordsMastered: 4,
  streak: 5,
  updated_at: 0,
}

const trendPoint: ReadingAbilityTrendPoint = {
  date: today,
  score: 0.8,
  wordCount: 300,
  durationSec: 600,
  count: 2,
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1]
}

describe('StatsPage 学习统计页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chartProps.line.length = 0
    chartProps.bar.length = 0
    chartProps.growth.length = 0
    overviewMock.mockResolvedValue(overview)
    rangeMock.mockResolvedValue([todayStats])
    trendMock.mockResolvedValue([trendPoint])
  })

  afterEach(() => {
    cacheEvents.clear()
  })

  it('加载中展示占位，完成后渲染 KPI 概览与图表区块', async () => {
    let resolveOverview!: (value: StatsOverview) => void
    overviewMock.mockReturnValue(
      new Promise<StatsOverview>((resolve) => {
        resolveOverview = resolve
      }),
    )
    render(<StatsPage />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()

    resolveOverview(overview)
    expect(await screen.findByText('学习统计')).toBeInTheDocument()
    expect(screen.getByText('连续打卡天数')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('今日阅读篇数')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('已掌握单词总数')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('今日新增生词数')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('学习趋势')).toBeInTheDocument()
    expect(screen.getByText('本周每日掌握单词数')).toBeInTheDocument()
    expect(screen.getByText('阅读能力增长曲线')).toBeInTheDocument()
  })

  it('日期补零：折线图与柱状图均补齐 7 天，缺失日期为 0', async () => {
    render(<StatsPage />)
    await screen.findByText('学习统计')

    await waitFor(() => expect(chartProps.line.length).toBeGreaterThan(0))
    const line = last(chartProps.line)
    expect(line.mode).toBe('week')
    expect(line.data).toHaveLength(7)
    expect(line.data[6].id).toBe(today)
    expect(line.data[6].articlesRead).toBe(1)
    expect(line.data.slice(0, 6).every((d) => d.articlesRead === 0)).toBe(true)

    await waitFor(() => expect(chartProps.bar.length).toBeGreaterThan(0))
    expect(last(chartProps.bar).data).toHaveLength(7)

    await waitFor(() => expect(chartProps.growth.length).toBeGreaterThan(0))
    expect(last(chartProps.growth).data).toEqual([trendPoint])
  })

  it('切换本月：折线图按 30 天窗口重新加载', async () => {
    render(<StatsPage />)
    await screen.findByText('学习统计')

    fireEvent.click(screen.getByRole('button', { name: '本月' }))

    await waitFor(() => expect(last(chartProps.line).mode).toBe('month'))
    expect(last(chartProps.line).data).toHaveLength(30)
    // 初始两次 week 查询（折线图 + 柱状图）+ 切换后一次 month 查询
    expect(rangeMock).toHaveBeenCalledTimes(3)
    expect(rangeMock).toHaveBeenLastCalledWith(daysAgo(29), today)
  })

  it('概览加载失败：告警并结束加载态，KPI 显示 0', async () => {
    overviewMock.mockRejectedValue(new Error('overview down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<StatsPage />)

    expect(await screen.findByText('学习统计')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith(
      '[StatsPage] 加载统计概览失败',
      expect.any(Error),
    )
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('图表数据加载失败：分别告警且页面仍正常渲染', async () => {
    rangeMock.mockRejectedValue(new Error('range down'))
    trendMock.mockRejectedValue(new Error('trend down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<StatsPage />)

    await screen.findByText('学习统计')
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[StatsPage] 加载折线图数据失败',
        expect.any(Error),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[StatsPage] 加载柱状图数据失败',
        expect.any(Error),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[StatsPage] 加载阅读能力曲线数据失败',
        expect.any(Error),
      )
    })
    expect(screen.getByText('学习趋势')).toBeInTheDocument()
  })

  it('stats 缓存失效：重新加载全部统计数据', async () => {
    render(<StatsPage />)
    await screen.findByText('学习统计')
    await waitFor(() => expect(overviewMock).toHaveBeenCalledTimes(1))

    act(() => {
      cacheEvents.emit('stats')
    })

    await waitFor(() => expect(overviewMock).toHaveBeenCalledTimes(2))
    expect(rangeMock).toHaveBeenCalledTimes(4)
    expect(trendMock).toHaveBeenCalledTimes(2)
  })

  it('卸载后取消缓存订阅，不再触发重载', async () => {
    const { unmount } = render(<StatsPage />)
    await screen.findByText('学习统计')

    unmount()
    cacheEvents.emit('stats')

    expect(overviewMock).toHaveBeenCalledTimes(1)
  })
})
