// "我的"页面：学习统计 + 成就墙 + 设置项
// 状态与持久化逻辑下沉至：
//   - hooks/useProfileSettings：统计数据加载 + Settings/通知/AI 配置持久化
//   - hooks/useAIConnectionTest：AI 服务连通性测试
import AchievementWall from '../components/AchievementWall'
import SessionSection from '../components/SessionSection'
import SettingsSection from '../components/SettingsSection'
import StatCard from '../components/StatCard'
import TokenStatsPanel from '../components/TokenStatsPanel'
import {
  BadgeIcon,
  BellIcon,
  BookIcon,
  ChipIcon,
  ClockIcon,
  GlobeIcon,
  SpeakerIcon,
  TargetIcon,
  WordIcon,
} from '@/shared/components/icons'
import { isNotificationSupported } from '@/shared/services'
import type { PronunciationSource } from '@/shared/services'
import { useProfileSettings, type AIProviderType } from '../hooks/useProfileSettings'
import { useAIConnectionTest } from '../hooks/useAIConnectionTest'
import { useTranslation, type Language } from '@/shared/i18n/useTranslation'

export default function ProfilePage() {
  const {
    stats,
    achievements,
    loading,
    durationText,
    settings,
    updateSettingsHandler,
    notificationEnabled,
    notificationPermission,
    toggleNotification,
    aiProviderType,
    aiApiKey,
    changeApiKey,
    blurApiKey,
    aiModel,
    changeAIModel,
    changeAIProvider,
    customEndpoint,
    customModelId,
    changeCustomConfig,
  } = useProfileSettings()

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
        {loading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700/50"
              />
            ))}
          </div>
        ) : (
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
        )}
      </section>

      {/* 成就墙 */}
      <AchievementWall unlockedAchievements={achievements} loading={loading} />

      {/* AI 用量与成本（DeepSeek KV Cache + 估算成本） */}
      <TokenStatsPanel />

      {/* 设置项 */}
      <div className="space-y-4">
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
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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

        {/* AI 模型配置 */}
        <SettingsSection
          title={t('settings.ai_config')}
          description={t('settings.ai_config_desc')}
          icon={<ChipIcon className="h-5 w-5" />}
        >
          <div className="grid grid-cols-1 gap-4">
            {/* AI 供应商选择 */}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('settings.ai_provider')}
              </span>
              <select
                value={aiProviderType}
                onChange={(e) => changeAIProvider(e.target.value as AIProviderType)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="qwen">通义千问</option>
                <option value="custom">{t('settings.ai_custom_model')}</option>
              </select>
            </label>

            {/* 自定义模型配置（仅 custom 时展示）：请求地址 + 模型 ID */}
            {aiProviderType === 'custom' && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('settings.ai_custom_endpoint')}
                  </span>
                  <input
                    type="text"
                    value={customEndpoint}
                    onChange={(e) => changeCustomConfig({ endpoint: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {t('settings.ai_custom_endpoint_hint')}
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('settings.ai_custom_model_id')}
                  </span>
                  <input
                    type="text"
                    value={customModelId}
                    onChange={(e) => changeCustomConfig({ modelId: e.target.value })}
                    placeholder="gpt-4o / qwen-max / llama3 ..."
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </label>
              </>
            )}

            {/* API Key 输入 */}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('settings.api_key')}
              </span>
              <input
                type="password"
                value={aiApiKey}
                onChange={(e) => changeApiKey(e.target.value)}
                onBlur={blurApiKey}
                placeholder="sk-..."
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </label>

            {/* 模型名（可选，留空使用供应商默认模型） */}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('settings.ai_model')} <span className="text-gray-400">({t('common.optional')})</span>
              </span>
              <input
                type="text"
                value={aiModel}
                onChange={(e) => changeAIModel(e.target.value)}
                placeholder="deepseek-v4-pro"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection || !aiApiKey}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {testingConnection ? t('button.testing') : t('settings.test_connection')}
            </button>
            {testMessage && (
              <span
                className={
                  testMessage.type === 'success'
                    ? 'text-sm text-emerald-600 dark:text-emerald-400'
                    : 'text-sm text-rose-600 dark:text-rose-400'
                }
              >
                {testMessage.text}
              </span>
            )}
          </div>
        </SettingsSection>

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

        {/* 登录设备管理（多用户 P3） */}
        <SessionSection />
      </div>
    </div>
  )
}
