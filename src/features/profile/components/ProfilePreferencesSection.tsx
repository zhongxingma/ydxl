// 个人中心偏好设置区：学习目标 / 发音 / 学习提醒
import SettingsSection from './SettingsSection'
import { BellIcon, SpeakerIcon, TargetIcon } from '@/shared/components/icons'
import { isNotificationSupported } from '@/shared/services'
import type { PronunciationSource } from '@/shared/services'
import type { UseProfileSettingsResult } from '../hooks/useProfileSettings'
import type { TranslateFn } from '@/shared/i18n/useTranslation'

interface ProfilePreferencesSectionProps {
  profile: UseProfileSettingsResult
  t: TranslateFn
}

export default function ProfilePreferencesSection({
  profile,
  t,
}: ProfilePreferencesSectionProps) {
  const {
    settings,
    updateSettingsHandler,
    notificationEnabled,
    notificationPermission,
    toggleNotification,
  } = profile

  // 设置项输入框通用样式
  const inputCls =
    'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

  return (
    <>
      {/* 学习目标 */}
      <SettingsSection
        title={t('settings.learning_goal')}
        description={t('settings.learning_goal_desc')}
        icon={<TargetIcon className="h-5 w-5" />}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.daily_goal_articles')}
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.dailyGoalArticles}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) {
                  updateSettingsHandler({
                    dailyGoalArticles: Math.min(10, Math.max(1, Math.floor(v))),
                  })
                }
              }}
              className={inputCls}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('settings.range_articles')}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.daily_goal_words')}
            </span>
            <input
              type="number"
              min={5}
              max={100}
              value={settings.dailyGoalWords}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) {
                  updateSettingsHandler({
                    dailyGoalWords: Math.min(100, Math.max(5, Math.floor(v))),
                  })
                }
              }}
              className={inputCls}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('settings.range_words')}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.daily_review_limit')}
            </span>
            <input
              type="number"
              min={1}
              max={200}
              value={settings.dailyReviewLimit}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) {
                  updateSettingsHandler({
                    dailyReviewLimit: Math.min(200, Math.max(1, Math.floor(v))),
                  })
                }
              }}
              className={inputCls}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('settings.range_review_limit')}</span>
          </label>
        </div>
      </SettingsSection>

      {/* 发音 */}
      <SettingsSection
        title={t('settings.pronunciation')}
        description={t('settings.pronunciation_desc')}
        icon={<SpeakerIcon className="h-5 w-5" />}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.pronunciation_source')}</span>
          <select
            value={settings.pronunciationSource}
            onChange={(e) =>
              updateSettingsHandler({
                pronunciationSource: e.target.value as PronunciationSource,
              })
            }
            className={inputCls}
          >
            <option value="us">{t('settings.pronunciation_us')}</option>
            <option value="uk">{t('settings.pronunciation_uk')}</option>
          </select>
        </label>
      </SettingsSection>

      {/* 学习提醒 */}
      <SettingsSection
        title={t('settings.reminder')}
        description={t('settings.reminder_desc')}
        icon={<BellIcon className="h-5 w-5" />}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.reminder_time')}
            </span>
            <input
              type="time"
              value={settings.reminderTime}
              onChange={(e) =>
                updateSettingsHandler({ reminderTime: e.target.value })
              }
              className={inputCls}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.enable_notification')}
            </span>
            <div className="flex items-center gap-3 py-1">
              <button
                type="button"
                role="switch"
                aria-checked={notificationEnabled}
                onClick={() => toggleNotification(!notificationEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  notificationEnabled
                    ? 'bg-indigo-600 dark:bg-indigo-500'
                    : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    notificationEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {notificationEnabled ? t('settings.notification_enabled') : t('settings.notification_disabled')}
              </span>
            </div>
            {!isNotificationSupported() && (
              <span className="text-xs text-rose-600 dark:text-rose-400">
                {t('settings.notification_unsupported')}
              </span>
            )}
            {isNotificationSupported() && notificationPermission === 'denied' && (
              <span className="text-xs text-rose-600 dark:text-rose-400">
                {t('settings.notification_denied')}
              </span>
            )}
          </div>
        </div>
      </SettingsSection>
    </>
  )
}
