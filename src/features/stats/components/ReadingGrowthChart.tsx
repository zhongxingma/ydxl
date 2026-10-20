// 阅读能力增长曲线：基于最近 N 天的 ReadingAbilityTrendPoint 数据点
// - X 轴：日期（YYYY-MM-DD）
// - Y 轴：正确率（0-1，对应 trend point 的 score 字段）
// 同时展示每日阅读字数（次坐标轴）便于综合查看
// 聚合逻辑由 statsService.getReadingAbilityTrend 完成（已修复时间窗口/字段兜底/NaN 防御）
// 组件层仅负责展示，使用 React.memo + useMemo：父组件 state 变化时若 data 引用未变则跳过重渲染
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { memo, useMemo } from 'react'
import { useDarkMode } from '@/shared/hooks/useDarkMode'
import type { ReadingAbilityTrendPoint } from '../types'
import { formatShortDate } from '../utils/date'

interface ReadingGrowthChartProps {
  data: ReadingAbilityTrendPoint[]
}

function ReadingGrowthChart({ data }: ReadingGrowthChartProps) {
  const { isDark } = useDarkMode()
  // 暗色模式适配
  const gridStroke = isDark ? '#374151' : '#e5e7eb'
  const textFill = isDark ? '#9ca3af' : '#6b7280'
  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }
    : { backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }
  const tooltipItemStyle = isDark ? { color: '#e5e7eb' } : { color: '#111827' }
  const legendStyle = { color: isDark ? '#9ca3af' : '#6b7280', fontSize: 12 }

  // 服务层已按日期升序聚合完成，这里仅做格式转换：
  // - date 裁剪为 MM-DD 用于 X 轴展示
  // - 保留 fullDate 用于 tooltip 完整日期展示
  // useMemo 缓存：data 引用未变时跳过 map 转换
  const chartData = useMemo(
    () =>
      data.map((p) => ({
        date: formatShortDate(p.date),
        fullDate: p.date,
        // score 已在服务层规范化为 0-1
        score: p.score,
        wordCount: p.wordCount,
      })),
    [data],
  )

  // 空数据态
  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        暂无阅读会话记录
      </div>
    )
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis
            dataKey="date"
            stroke={textFill}
            fontSize={12}
            tickLine={false}
            // 数据点较多时间隔显示
            interval={Math.max(0, Math.floor(chartData.length / 8))}
          />
          {/* 主 Y 轴（左）：正确率 0-1 */}
          <YAxis
            yAxisId="left"
            stroke="#10b981"
            fontSize={12}
            domain={[0, 1]}
            tickLine={false}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          />
          {/* 次 Y 轴（右）：阅读字数，自动计算 domain */}
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#f59e0b"
            fontSize={12}
            tickLine={false}
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            // tooltip 显示完整日期与百分比 + 字数
            labelFormatter={(_label: unknown, payload: ReadonlyArray<unknown>) => {
              const item = payload?.[0] as { payload?: { fullDate?: string } } | undefined
              return item?.payload?.fullDate ?? ''
            }}
            formatter={(value: unknown, name: string) => {
              if (name === '正确率') {
                const n = Number(value)
                return [`${Math.round(n * 100)}%`, name]
              }
              if (name === '阅读字数') {
                return [String(value), name]
              }
              return [String(value), name]
            }}
          />
          <Legend wrapperStyle={legendStyle} />
          {/* 正确率折线（左轴，0-1） */}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="score"
            name="正确率"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          {/* 每日阅读字数折线（右轴，独立尺度） */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="wordCount"
            name="阅读字数"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// React.memo：sessions 引用未变时跳过整个图表的重渲染（含 recharts 内部渲染）
export default memo(ReadingGrowthChart)
