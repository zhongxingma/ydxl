// 周/月切换 Tab 组件
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'
import type { StatsMode } from '../types'

interface StatsTabsProps {
  mode: StatsMode
  onChange: (mode: StatsMode) => void
}

// label 为字典 key，展示时翻译
const MODES: { key: StatsMode; label: string }[] = [
  { key: 'week', label: 'stats.tab_week' },
  { key: 'month', label: 'stats.tab_month' },
]

export default function StatsTabs({ mode, onChange }: StatsTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800">
      {MODES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            mode === key
              ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
          )}
        >
          {t(label)}
        </button>
      ))}
    </div>
  )
}
