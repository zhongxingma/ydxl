// 个人中心学习统计区：四张统计卡（阅读篇数 / 生词 / 时长 / 已掌握）
import StatCard from './StatCard'
import { BadgeIcon, BookIcon, ClockIcon, WordIcon } from '@/shared/components/icons'
import type { ProfileStats } from '../hooks/useProfileSettings'
import type { TranslateFn } from '@/shared/i18n/useTranslation'

interface ProfileStatsGridProps {
  stats: ProfileStats | null
  loading: boolean
  durationText: string
  t: TranslateFn
}

export default function ProfileStatsGrid({
  stats,
  loading,
  durationText,
  t,
}: ProfileStatsGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700/50"
          />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label={t('profile.total_read_count')}
        value={stats?.totalReadCount ?? 0}
        unit={t('dashboard.unit.articles')}
        icon={<BookIcon className="h-6 w-6" />}
        color="text-indigo-600 dark:text-indigo-400"
      />
      <StatCard
        label={t('profile.total_words')}
        value={stats?.totalWords ?? 0}
        unit={t('dashboard.unit.words')}
        icon={<WordIcon className="h-6 w-6" />}
        color="text-rose-600 dark:text-rose-400"
      />
      <StatCard
        label={t('profile.total_duration')}
        value={durationText}
        icon={<ClockIcon className="h-6 w-6" />}
        color="text-amber-600 dark:text-amber-400"
      />
      <StatCard
        label={t('profile.mastered_words')}
        value={stats?.totalMasteredWords ?? 0}
        unit={t('dashboard.unit.words')}
        icon={<BadgeIcon className="h-6 w-6" />}
        color="text-emerald-600 dark:text-emerald-400"
      />
    </div>
  )
}
