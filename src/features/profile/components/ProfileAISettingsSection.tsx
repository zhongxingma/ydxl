// 个人中心 AI 模型配置区：供应商 / 自定义端点与模型 ID / API Key / 模型名 / 连接测试
import SettingsSection from './SettingsSection'
import { ChipIcon } from '@/shared/components/icons'
import type { UseProfileSettingsResult, AIProviderType } from '../hooks/useProfileSettings'
import type { TestMessage } from '../hooks/useAIConnectionTest'
import type { TranslateFn } from '@/shared/i18n/useTranslation'

interface ProfileAISettingsSectionProps {
  profile: UseProfileSettingsResult
  t: TranslateFn
  testingConnection: boolean
  testMessage: TestMessage | null
  onTestConnection: () => void
}

export default function ProfileAISettingsSection({
  profile,
  t,
  testingConnection,
  testMessage,
  onTestConnection,
}: ProfileAISettingsSectionProps) {
  const {
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
  } = profile

  // 输入框通用样式
  const inputCls =
    'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

  return (
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
            className={inputCls}
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
                className={inputCls}
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
                className={inputCls}
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
            className={inputCls}
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
            className={inputCls}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTestConnection}
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
  )
}
