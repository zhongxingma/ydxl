// 学习统计折线图：展示每日阅读篇数、复习单词数、新增生词数
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
import { useDarkMode } from '@/shared/hooks/useDarkMode'
import type { Stats } from '@/shared/types'
import { formatShortDate } from '../utils/date'
import type { StatsMode } from '../types'

interface StatsChartProps {
  data: Stats[]
  mode: StatsMode
}

export default function StatsChart({ data, mode }: StatsChartProps) {
  const { isDark } = useDarkMode()
  // 暗色模式适配：网格线、文字颜色、Tooltip 背景
  const gridStroke = isDark ? '#374151' : '#e5e7eb'
  const textFill = isDark ? '#9ca3af' : '#6b7280'
  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }
    : { backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }
  const tooltipItemStyle = isDark ? { color: '#e5e7eb' } : { color: '#111827' }
  const legendStyle = { color: isDark ? '#9ca3af' : '#6b7280', fontSize: 12 }

  const chartData = data.map((s) => ({
    date: formatShortDate(s.id),
    articlesRead: s.articlesRead,
    wordsReviewed: s.wordsReviewed,
    wordsLearned: s.wordsLearned,
  }))

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          {/* 月模式数据点较多，间隔显示刻度避免拥挤 */}
          <XAxis
            dataKey="date"
            stroke={textFill}
            fontSize={12}
            tickLine={false}
            interval={mode === 'month' ? 4 : 0}
          />
          <YAxis stroke={textFill} fontSize={12} allowDecimals={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
          <Legend wrapperStyle={legendStyle} />
          <Line
            type="monotone"
            dataKey="articlesRead"
            name="阅读篇数"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="wordsReviewed"
            name="复习单词数"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="wordsLearned"
            name="新增生词数"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
