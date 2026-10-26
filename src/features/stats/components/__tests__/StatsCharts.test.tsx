// StatsChart / StatsBarChart 学习统计图表单元测试
//
// 覆盖场景：
// 1. 折线图数据映射与三条折线配置
// 2. 周 / 月模式的 X 轴刻度间隔
// 3. 折线图亮色 / 暗色主题配色
// 4. 柱状图数据映射与柱子配置
// 5. 柱状图暗色主题与 Y 轴整数刻度
//
// Mock 策略：用轻量替身替换 recharts 原子组件并捕获 props，避免 jsdom 布局限制；
// useDarkMode 使用可控开关模拟主题切换。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Stats } from '@/shared/types'
import type { StatsMode } from '../../types'
import StatsChart from '../StatsChart'
import StatsBarChart from '../StatsBarChart'

interface AxisProps {
  dataKey?: string
  stroke?: string
  interval?: number
  allowDecimals?: boolean
  fontSize?: number
  tickLine?: boolean
}

interface TooltipProps {
  contentStyle?: Record<string, string>
  itemStyle?: Record<string, string>
}

interface LineProps {
  dataKey?: string
  name?: string
  stroke?: string
}

interface BarProps {
  dataKey?: string
  name?: string
  fill?: string
  radius?: number[]
}

interface LegendProps {
  wrapperStyle?: Record<string, unknown>
}

const captured = vi.hoisted(() => ({
  dark: { value: false },
  lineChart: [] as Array<{ data: Array<Record<string, unknown>> }>,
  barChart: [] as Array<{ data: Array<Record<string, unknown>> }>,
  grid: [] as Array<{ stroke?: string }>,
  xAxis: [] as AxisProps[],
  yAxis: [] as AxisProps[],
  tooltip: [] as TooltipProps[],
  legend: [] as LegendProps[],
  lines: [] as LineProps[],
  bars: [] as BarProps[],
}))

vi.mock('@/shared/hooks/useDarkMode', () => ({
  useDarkMode: () => ({
    isDark: captured.dark.value,
    toggle: () => {},
    enable: () => {},
    disable: () => {},
  }),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({
    children,
    data,
  }: {
    children: ReactNode
    data: Array<Record<string, unknown>>
  }) => {
    captured.lineChart.push({ data })
    return <div>{children}</div>
  },
  BarChart: ({
    children,
    data,
  }: {
    children: ReactNode
    data: Array<Record<string, unknown>>
  }) => {
    captured.barChart.push({ data })
    return <div>{children}</div>
  },
  CartesianGrid: (props: { stroke?: string }) => {
    captured.grid.push(props)
    return null
  },
  XAxis: (props: AxisProps) => {
    captured.xAxis.push(props)
    return null
  },
  YAxis: (props: AxisProps) => {
    captured.yAxis.push(props)
    return null
  },
  Tooltip: (props: TooltipProps) => {
    captured.tooltip.push(props)
    return null
  },
  Legend: (props: LegendProps) => {
    captured.legend.push(props)
    return null
  },
  Line: (props: LineProps) => {
    captured.lines.push(props)
    return null
  },
  Bar: (props: BarProps) => {
    captured.bars.push(props)
    return null
  },
}))

function makeStats(id: string, overrides: Partial<Stats> = {}): Stats {
  return {
    id,
    updated_at: Date.now(),
    articlesRead: 1,
    wordsLearned: 2,
    wordsReviewed: 3,
    wordsMastered: 4,
    streak: 5,
    ...overrides,
  }
}

function reset() {
  captured.dark.value = false
  captured.lineChart.length = 0
  captured.barChart.length = 0
  captured.grid.length = 0
  captured.xAxis.length = 0
  captured.yAxis.length = 0
  captured.tooltip.length = 0
  captured.legend.length = 0
  captured.lines.length = 0
  captured.bars.length = 0
}

describe('StatsChart 学习统计折线图', () => {
  beforeEach(reset)

  it('映射日期与三项指标并配置三条折线', () => {
    render(
      <StatsChart
        data={[makeStats('2026-10-20', { articlesRead: 2, wordsReviewed: 5, wordsLearned: 3 })]}
        mode="week"
      />
    )

    expect(captured.lineChart[0].data).toEqual([
      { date: '10-20', articlesRead: 2, wordsReviewed: 5, wordsLearned: 3 },
    ])
    expect(captured.lines).toEqual([
      expect.objectContaining({ dataKey: 'articlesRead', name: '阅读篇数', stroke: '#6366f1' }),
      expect.objectContaining({ dataKey: 'wordsReviewed', name: '复习单词数', stroke: '#10b981' }),
      expect.objectContaining({ dataKey: 'wordsLearned', name: '新增生词数', stroke: '#f59e0b' }),
    ])
  })

  it('周模式刻度间隔为 0，月模式为 4', () => {
    const data = [makeStats('2026-10-20')]
    const { rerender } = render(<StatsChart data={data} mode="week" />)

    expect(captured.xAxis[0].interval).toBe(0)

    rerender(<StatsChart data={data} mode={'month' as StatsMode} />)
    expect(captured.xAxis[1].interval).toBe(4)
  })

  it('亮色模式使用浅色网格与文字', () => {
    render(<StatsChart data={[makeStats('2026-10-20')]} mode="week" />)

    expect(captured.grid[0].stroke).toBe('#e5e7eb')
    expect(captured.xAxis[0].stroke).toBe('#6b7280')
    expect(captured.tooltip[0].contentStyle?.backgroundColor).toBe('#ffffff')
    expect(captured.tooltip[0].itemStyle?.color).toBe('#111827')
    expect(captured.legend[0].wrapperStyle).toMatchObject({
      color: '#6b7280',
      fontSize: 12,
    })
  })

  it('暗色模式切换网格、文字、Tooltip 与图例配色', () => {
    captured.dark.value = true
    render(<StatsChart data={[makeStats('2026-10-20')]} mode="week" />)

    expect(captured.grid[0].stroke).toBe('#374151')
    expect(captured.xAxis[0].stroke).toBe('#9ca3af')
    expect(captured.tooltip[0].contentStyle?.backgroundColor).toBe('#1f2937')
    expect(captured.tooltip[0].itemStyle?.color).toBe('#e5e7eb')
    expect(captured.legend[0].wrapperStyle).toMatchObject({ color: '#9ca3af' })
  })
})

describe('StatsBarChart 本周掌握单词柱状图', () => {
  beforeEach(reset)

  it('映射日期与掌握单词数并配置柱子', () => {
    render(
      <StatsBarChart
        data={[makeStats('2026-10-20', { wordsMastered: 7 }), makeStats('2026-10-21', { wordsMastered: 9 })]}
      />
    )

    expect(captured.barChart[0].data).toEqual([
      { date: '10-20', wordsMastered: 7 },
      { date: '10-21', wordsMastered: 9 },
    ])
    expect(captured.bars[0]).toMatchObject({
      dataKey: 'wordsMastered',
      name: '掌握单词数',
      fill: '#6366f1',
      radius: [4, 4, 0, 0],
    })
    expect(captured.yAxis[0].allowDecimals).toBe(false)
  })

  it('暗色模式使用浅紫色柱子与深色网格', () => {
    captured.dark.value = true
    render(<StatsBarChart data={[makeStats('2026-10-20')]} />)

    expect(captured.bars[0].fill).toBe('#818cf8')
    expect(captured.grid[0].stroke).toBe('#374151')
    expect(captured.tooltip[0].contentStyle?.backgroundColor).toBe('#1f2937')
  })
})
