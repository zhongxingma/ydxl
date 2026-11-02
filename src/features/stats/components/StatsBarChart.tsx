// 学习统计柱状图：展示本周每日掌握单词数
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useDarkMode } from '@/shared/hooks/useDarkMode'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Stats } from '@/shared/types'
import { formatShortDate } from '../utils/date'

interface StatsBarChartProps {
  data: Stats[]
}

export default function StatsBarChart({ data }: StatsBarChartProps) {
  const { t } = useTranslation()
  const { isDark } = useDarkMode()
  // 暗色模式适配
  const gridStroke = isDark ? '#374151' : '#e5e7eb'
  const textFill = isDark ? '#9ca3af' : '#6b7280'
  const barFill = isDark ? '#818cf8' : '#6366f1'
  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }
    : { backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }
  const tooltipItemStyle = isDark ? { color: '#e5e7eb' } : { color: '#111827' }

  const chartData = data.map((s) => ({
    date: formatShortDate(s.id),
    wordsMastered: s.wordsMastered,
  }))

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="date" stroke={textFill} fontSize={12} tickLine={false} />
          <YAxis stroke={textFill} fontSize={12} allowDecimals={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
          <Bar dataKey="wordsMastered" name={t('stats.chart.words_mastered')} fill={barFill} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
