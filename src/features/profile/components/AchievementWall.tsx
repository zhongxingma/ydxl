// 成就墙组件：展示全部成就规则，已解锁高亮、未解锁灰色锁定
import { ACHIEVEMENT_RULES } from '@/features/stats/services/achievementService'
import type { Achievement } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'

interface AchievementWallProps {
  // 已解锁成就列表
  unlockedAchievements: Achievement[]
  // 加载中标志
  loading?: boolean
}

// 锁定图标
function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 12.75v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  )
}

// 将时间戳格式化为 "YYYY-MM-DD" 简短日期
function formatUnlockedDate(timestamp: number): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 成就名/描述文案 key：与 achievementService 解锁处保持一致（id 中 - 换成 _）
function achievementTextKey(ruleId: string, suffix: 'name' | 'desc'): string {
  return `stats.achievement.${ruleId.replace(/-/g, '_')}.${suffix}`
}

export default function AchievementWall({
  unlockedAchievements,
  loading,
}: AchievementWallProps) {
  const { t } = useTranslation()
  // 构造已解锁 map：id -> unlockedAt
  const unlockedMap = new Map<string, Achievement>()
  for (const a of unlockedAchievements) {
    unlockedMap.set(a.id, a)
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('profile.achievement_wall.title')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {ACHIEVEMENT_RULES.map((rule) => (
            <div
              key={rule.id}
              className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700/50"
            />
          ))}
        </div>
      </section>
    )
  }

  const unlockedCount = unlockedAchievements.length
  const totalCount = ACHIEVEMENT_RULES.length

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('profile.achievement_wall.title')}</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('profile.achievement_wall.unlocked_count', {
            unlocked: unlockedCount,
            total: totalCount,
          })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {ACHIEVEMENT_RULES.map((rule) => {
          const unlocked = unlockedMap.get(rule.id)
          const isUnlocked = !!unlocked
          return (
            <div
              key={rule.id}
              className={
                isUnlocked
                  ? 'flex flex-col items-center rounded-lg border border-amber-200 bg-amber-50 p-3 text-center transition-colors dark:border-amber-700 dark:bg-amber-900/20'
                  : 'flex flex-col items-center rounded-lg border border-gray-200 bg-gray-50 p-3 text-center opacity-70 dark:border-gray-700 dark:bg-gray-700/30'
              }
              title={t(achievementTextKey(rule.id, 'desc'))}
            >
              <span
                className={
                  isUnlocked
                    ? 'text-4xl'
                    : 'text-4xl grayscale dark:opacity-40'
                }
                aria-hidden
              >
                {isUnlocked ? rule.icon : '🔒'}
              </span>
              <p
                className={
                  isUnlocked
                    ? 'mt-2 text-sm font-medium text-gray-900 dark:text-gray-100'
                    : 'mt-2 text-sm font-medium text-gray-500 dark:text-gray-400'
                }
              >
                {t(achievementTextKey(rule.id, 'name'))}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t(achievementTextKey(rule.id, 'desc'))}
              </p>
              {isUnlocked && unlocked?.unlockedAt ? (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {formatUnlockedDate(unlocked.unlockedAt)}
                </p>
              ) : (
                <p className="mt-2 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <LockIcon className="h-3 w-3" />
                  <span>{t('profile.achievement_wall.locked')}</span>
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
