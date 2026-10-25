// "我的"页面：学习统计 + 成就墙 + 设置项
// 状态与持久化逻辑下沉至：
//   - hooks/useProfileSettings：统计数据加载 + Settings/通知/AI 配置持久化
//   - hooks/useAIConnectionTest：AI 服务连通性测试
// 视图区块拆分至 components/ProfileStatsGrid、ProfilePreferencesSection、ProfileAISettingsSection
import AchievementWall from '../components/AchievementWall'
import ProfileAISettingsSection from '../components/ProfileAISettingsSection'
import ProfilePreferencesSection from '../components/ProfilePreferencesSection'
import ProfileStatsGrid from '../components/ProfileStatsGrid'
import SessionSection from '../components/SessionSection'
import SettingsSection from '../components/SettingsSection'
import TokenStatsPanel from '../components/TokenStatsPanel'
import { GlobeIcon } from '@/shared/components/icons'
import { useProfileSettings } from '../hooks/useProfileSettings'
import { useAIConnectionTest } from '../hooks/useAIConnectionTest'
import { useTranslation, type Language } from '@/shared/i18n/useTranslation'

export default function ProfilePage() {
  const profile = useProfileSettings()
  const {
    stats,
    achievements,
    loading,
    durationText,
    aiProviderType,
    aiApiKey,
    aiModel,
    customEndpoint,
    customModelId,
  } = profile

  const { testingConnection, testMessage, handleTestConnection } = useAIConnectionTest(
    aiProviderType,
    aiApiKey,
    // 自定义模型使用其模型 ID 作为请求体 model 字段；内置供应商使用可选覆盖值
    aiProviderType === 'custom' ? customModelId : aiModel,
    customEndpoint,
  )

  const { t, language, setLanguage } = useTranslation()

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('profile.title')}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('profile.subtitle')}</p>
      </div>

      {/* 学习统计区 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('profile.learning_stats')}
        </h2>
        <ProfileStatsGrid stats={stats} loading={loading} durationText={durationText} t={t} />
      </section>

      {/* 成就墙 */}
      <AchievementWall unlockedAchievements={achievements} loading={loading} />

      {/* AI 用量与成本（DeepSeek KV Cache + 估算成本） */}
      <TokenStatsPanel />

      {/* 设置项 */}
      <div className="space-y-4">
        {/* 学习目标 / 发音 / 学习提醒 */}
        <ProfilePreferencesSection profile={profile} t={t} />

        {/* AI 模型配置 */}
        <ProfileAISettingsSection
          profile={profile}
          t={t}
          testingConnection={testingConnection}
          testMessage={testMessage}
          onTestConnection={handleTestConnection}
        />

        {/* 语言切换 */}
        <SettingsSection
          title={t('settings.language')}
          description={t('settings.language_desc')}
          icon={<GlobeIcon className="h-5 w-5" />}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.language')}
            </span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="zh-CN">{t('settings.language_zh_cn')}</option>
              <option value="en-US">{t('settings.language_en_us')}</option>
            </select>
          </label>
        </SettingsSection>

        {/* 登录设备管理 */}
        <SessionSection />
      </div>
    </div>
  )
}
