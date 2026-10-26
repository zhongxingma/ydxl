// ReadingGrowthChart 阅读能力增长曲线单元测试
//
// 覆盖场景：
// 1. 空数据态文案，不渲染图表
// 2. 数据映射（日期裁剪、完整日期、正确率、字数）与线条配置
// 3. X 轴刻度间隔随数据点数量变化
// 4. 双 Y 轴刻度格式化（百分比 / k 缩写）
// 5. Tooltip 标签与数值格式化分支
// 6. 亮色 / 暗色主题配色
// 7. React.memo：data 引用不变时跳过重渲染
//
// Mock 策略：用轻量替身替换 recharts 原子组件并捕获 props，避免 jsdom 布局限制；
// useDarkMode 使用可控开关模拟主题切换。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ReadingAbilityTrendPoint } from '../../types'
import ReadingGrowthChart from '../ReadingGrowthChart'

interface AxisProps {
  yAxisId?: string
  orientation?: string
  stroke?: string
  interval?: number
  tickFormatter?: (value: number) => string
}

interface TooltipProps {
  contentStyle?: Record<string, string>
  itemStyle?: Record<string, string>
  labelFormatter?: (label: unknown, payload: ReadonlyArray<unknown>) => string
  formatter?: (value: unknown, name: string) => [string, string]
}

interface LineProps {
  yAxisId?: string
  dataKey?: string
  name?: string
  stroke?: string
}

const captured = vi.hoisted(() => ({
  dark: { value: false },
  chart: [] as Array<{ data: unknown }>,
  chartRenders: 0,
  grid: [] as Array<{ stroke?: string }>,
  xAxis: [] as AxisProps[],
  yAxis: [] as AxisProps[],
  tooltip: [] as TooltipProps[],
  legend: [] as Array<{ wrapperStyle?: Record<string, unknown> }>,
  lines: [] as LineProps[],
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
  LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => {
    captured.chartRenders += 1
    captured.chart.push({ data })
    return <div data-testid="line-chart">{children}</div>
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
  Legend: (props: { wrapperStyle?: Record<string, unknown> }) => {
    captured.legend.push(props)
    return null
  },
  Line: (props: LineProps) => {
    captured.lines.push(props)
    return null
  },
}))

function point(
  date: string,
  score: number,
  wordCount: number
): ReadingAbilityTrendPoint {
  return { date, score, wordCount, durationSec: 0, count: 1 }
}

describe('ReadingGrowthChart 阅读能力增长曲线', () => {
  beforeEach(() => {
    captured.dark.value = false
    captured.chart.length = 0
    captured.chartRenders = 0
    captured.grid.length = 0
    captured.xAxis.length = 0
    captured.yAxis.length = 0
    captured.tooltip.length = 0
    captured.legend.length = 0
    captured.lines.length = 0
  })

  it('无数据时展示空状态且不渲染图表', () => {
    render(<ReadingGrowthChart data={[]} />)

    expect(screen.getByText('暂无阅读会话记录')).toBeInTheDocument()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(captured.chartRenders).toBe(0)
  })

  it('将趋势点映射为图表数据并配置两条折线', () => {
    render(
      <ReadingGrowthChart
        data={[point('2026-10-20', 0.8, 1200), point('2026-10-21', 1, 800)]}
      />
    )

    expect(captured.chart[0].data).toEqual([
      { date: '10-20', fullDate: '2026-10-20', score: 0.8, wordCount: 1200 },
      { date: '10-21', fullDate: '2026-10-21', score: 1, wordCount: 800 },
    ])

    expect(captured.lines).toEqual([
      expect.objectContaining({
        yAxisId: 'left',
        dataKey: 'score',
        name: '正确率',
      }),
      expect.objectContaining({
        yAxisId: 'right',
        dataKey: 'wordCount',
        name: '阅读字数',
      }),
    ])
    expect(captured.xAxis[0]).toMatchObject({ dataKey: 'date', stroke: '#6b7280' })
    expect(captured.grid[0].stroke).toBe('#e5e7eb')
  })

  it('X 轴刻度间隔按数据点数量计算', () => {
    const { rerender } = render(
      <ReadingGrowthChart data={[point('2026-10-01', 0.5, 200)]} />
    )

    expect(captured.xAxis[0].interval).toBe(0)

    captured.xAxis.length = 0
    const many = Array.from({ length: 20 }, (_, i) =>
      point(`2026-10-${String(i + 1).padStart(2, '0')}`, 0.5, 200)
    )
    rerender(<ReadingGrowthChart data={many} />)

    expect(captured.xAxis[0].interval).toBe(2)
  })

  it('双 Y 轴刻度分别格式化为百分比与 k 缩写', () => {
    render(<ReadingGrowthChart data={[point('2026-10-20', 0.856, 1500)]} />)

    const left = captured.yAxis.find((a) => a.yAxisId === 'left')
    const right = captured.yAxis.find((a) => a.yAxisId === 'right')

    expect(left?.tickFormatter?.(0.856)).toBe('86%')
    expect(left?.tickFormatter?.(0)).toBe('0%')
    expect(right?.tickFormatter?.(1500)).toBe('1.5k')
    expect(right?.tickFormatter?.(999)).toBe('999')
  })

  it('Tooltip 展示完整日期并格式化正确率与字数', () => {
    render(<ReadingGrowthChart data={[point('2026-10-20', 0.856, 1500)]} />)

    const tooltip = captured.tooltip[0]
    expect(
      tooltip.labelFormatter?.('10-20', [{ payload: { fullDate: '2026-10-20' } }])
    ).toBe('2026-10-20')
    expect(tooltip.labelFormatter?.('10-20', [])).toBe('')
    expect(tooltip.labelFormatter?.('10-20', undefined as never)).toBe('')

    expect(tooltip.formatter?.(0.856, '正确率')).toEqual(['86%', '正确率'])
    expect(tooltip.formatter?.(1500, '阅读字数')).toEqual(['1500', '阅读字数'])
    expect(tooltip.formatter?.(7, '其他')).toEqual(['7', '其他'])
  })

  it('暗色模式下切换网格、坐标轴文字与 Tooltip 配色', () => {
    captured.dark.value = true
    render(<ReadingGrowthChart data={[point('2026-10-20', 0.8, 1200)]} />)

    expect(captured.grid[0].stroke).toBe('#374151')
    expect(captured.xAxis[0].stroke).toBe('#9ca3af')
    expect(captured.tooltip[0].contentStyle?.backgroundColor).toBe('#1f2937')
    expect(captured.tooltip[0].itemStyle?.color).toBe('#e5e7eb')
    expect(captured.legend[0].wrapperStyle).toMatchObject({
      color: '#9ca3af',
      fontSize: 12,
    })
  })

  it('data 引用不变时跳过重渲染，引用变化时更新', () => {
    const data = [point('2026-10-20', 0.8, 1200)]
    const { rerender } = render(<ReadingGrowthChart data={data} />)

    expect(captured.chartRenders).toBe(1)

    rerender(<ReadingGrowthChart data={data} />)
    expect(captured.chartRenders).toBe(1)

    rerender(<ReadingGrowthChart data={[...data]} />)
    expect(captured.chartRenders).toBe(2)
  })
})
