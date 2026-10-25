// 仪表盘顶部数据卡片：连续打卡 / 今日阅读 / 今日复习
import {
  BookOpen,
  FlameIcon,
  RefreshCw,
} from '@/shared/components/icons'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { DashboardData } from '../hooks/useDashboardOverview'
import DashboardStatCard from './DashboardStatCard'

interface DashboardStatGridProps {
  data: DashboardData
  goalArticles: number
  goalWords: number
}

export default function DashboardStatGrid({
  data,
  goalArticles,
  goalWords,
}: DashboardStatGridProps) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <DashboardStatCard
        label={t('dashboard.continuous_days')}
        value={data.streak}
        unit={t('dashboard.unit.day')}
        icon={<FlameIcon className="h-6 w-6" />}
        accent="text-amber-600 dark:text-amber-400"
      />
      <DashboardStatCard
        label={t('dashboard.today_articles')}
        value={data.todayArticlesRead}
        unit={`/ ${goalArticles} ${t('dashboard.unit.articles')}`}
        icon={<BookOpen className="h-6 w-6" />}
        accent="text-indigo-600 dark:text-indigo-400"
        progress={goalArticles > 0 ? data.todayArticlesRead / goalArticles : 0}
      />
      <DashboardStatCard
        label={t('dashboard.today_words')}
        value={data.todayWordsReviewed}
        unit={`/ ${goalWords} ${t('dashboard.unit.words')}`}
        icon={<RefreshCw className="h-6 w-6" />}
        accent="text-emerald-600 dark:text-emerald-400"
        progress={goalWords > 0 ? data.todayWordsReviewed / goalWords : 0}
        hint={t('dashboard.pending_review', { count: data.pendingReview })}
        showRedDot={data.overdueCount > 0}
      />
    </div>
  )
}
