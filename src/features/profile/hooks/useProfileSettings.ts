// 个人中心设置 hook：管理通知 / AI 配置表单状态与实时持久化
//
// 拆分：
// - profileSettingsStorage：localStorage / secureStorage 读写与 legacy 迁移
// - useProfileStats：统计数据、成就与累计时长文案
// - 本 hook：设置表单状态、通知权限与 AI 配置变更编排
import { useEffect, useRef, useState } from 'react'
import {
  getSettings,
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendNotification,
  setupDailyReminder,
  updateSettings,
  type NotificationPermission,
  type PronunciationSource,
  type Settings,
} from '@/shared/services'
import type { AIProviderType } from './profileSettingsStorage'
import {
  readNotificationEnabled,
  readAIProviderType,
  readAIApiKey,
  readAIModel,
  readCustomEndpoint,
  readCustomModelId,
  writeNotificationEnabled,
  writeAIProviderType,
  writeAIApiKey,
  writeAIModel,
  writeCustomConfig,
} from './profileSettingsStorage'
import { useProfileStats } from './useProfileStats'
import { useTranslation } from '@/shared/i18n/useTranslation'

// 对外导出保持原有模块表面（ProfilePage / 其他调用方导入路径不变）
export type { AIProviderType } from './profileSettingsStorage'
export type { ProfileStats } from './useProfileStats'
export { formatDuration } from './useProfileStats'

export interface UseProfileSettingsResult {
  // 统计数据
  stats: ReturnType<typeof useProfileStats>['stats']
  achievements: ReturnType<typeof useProfileStats>['achievements']
  loading: boolean
  durationText: string
  // Settings（getSettings/updateSettings 持久化）
  settings: Settings
  updateSettingsHandler: (partial: Partial<Settings>) => void
  // 通知
  notificationEnabled: boolean
  notificationPermission: NotificationPermission
  toggleNotification: (enabled: boolean) => Promise<void>
  // AI 配置
  aiProviderType: AIProviderType
  changeAIProvider: (v: AIProviderType) => void
  aiApiKey: string
  // AI API Key 是否已从 secureStorage 异步加载完成（用于测试同步等待）
  apiKeyLoaded: boolean
  changeApiKey: (value: string) => void
  blurApiKey: () => void
  // 可选模型名覆盖（为空时使用 Provider 默认模型）
  aiModel: string
  changeAIModel: (value: string) => void
  // 自定义模型配置（OpenAI 兼容端点，仅 aiProviderType === 'custom' 时展示/使用）
  customEndpoint: string
  customModelId: string
  changeCustomConfig: (partial: { endpoint?: string; modelId?: string }) => void
}

export function useProfileSettings(): UseProfileSettingsResult {
  // ====== 统计数据 ======
  const { stats, achievements, loading, durationText } = useProfileStats()

  // ====== 设置表单状态（实时持久化） ======
  const [settings, setSettings] = useState<Settings>(() => getSettings())
  // 通知开关
  const [notificationEnabled, setNotificationEnabled] = useState<boolean>(() =>
    readNotificationEnabled(),
  )
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    getNotificationPermission(),
  )
  // AI 模型配置
  const [aiProviderType, setAIProviderType] = useState<AIProviderType>(() => readAIProviderType())
  // AI API Key 初始为空，通过 useEffect 异步从 secureStorage 加载
  // （secureStorage 使用 Web Crypto API 加密，所有操作均为异步）
  const [aiApiKey, setAIApiKey] = useState<string>('')
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  // 可选模型名覆盖（同步从 localStorage 读取，明文存储）
  const [aiModel, setAIModel] = useState<string>(() => readAIModel())
  // 自定义模型配置：请求地址 + 模型 ID（仅 provider === 'custom' 时展示与使用）
  const [customEndpoint, setCustomEndpoint] = useState<string>(() => readCustomEndpoint())
  const [customModelId, setCustomModelId] = useState<string>(() => readCustomModelId())

  // 异步加载 AI API Key（首次挂载 + 供应商切换时触发）
  // 切换供应商时清空当前 apiKey 状态，加载新供应商的 Key（按供应商隔离存储）
  useEffect(() => {
    let cancelled = false
    setApiKeyLoaded(false)
    const loadKey = async () => {
      const stored = await readAIApiKey(aiProviderType)
      if (!cancelled) {
        setAIApiKey(stored)
        setApiKeyLoaded(true)
      }
    }
    loadKey()
    return () => {
      cancelled = true
    }
  }, [aiProviderType])

  // 持有每日提醒的取消函数，便于重新设置
  const cancelReminderRef = useRef<(() => void) | null>(null)

  // 提醒通知文案国际化
  const { t } = useTranslation()

  // API Key 防抖定时器
  const apiKeyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 启用通知时设置每日提醒（仅前台有效）
  useEffect(() => {
    // 取消上一次的定时器
    if (cancelReminderRef.current) {
      cancelReminderRef.current()
      cancelReminderRef.current = null
    }
    if (!notificationEnabled) return
    if (getNotificationPermission() !== 'granted') return
    cancelReminderRef.current = setupDailyReminder(settings.reminderTime, () => {
      sendNotification(t('settings.reminder'), {
        body: t('profile.reminder_body'),
        icon: undefined,
      })
    })
    return () => {
      if (cancelReminderRef.current) {
        cancelReminderRef.current()
        cancelReminderRef.current = null
      }
    }
  }, [notificationEnabled, settings.reminderTime, t])

  // 组件卸载时清理 API Key 防抖定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (apiKeyTimerRef.current) {
        clearTimeout(apiKeyTimerRef.current)
      }
    }
  }, [])

  // 通用设置项变更：更新 state 与 localStorage
  const updateSettingsHandler = (partial: Partial<Settings>) => {
    const next = updateSettings(partial)
    setSettings(next)
  }

  // 切换通知开关
  const toggleNotification = async (enabled: boolean) => {
    if (enabled) {
      // 启用时先请求权限
      const permission = isNotificationSupported()
        ? await requestNotificationPermission()
        : 'denied'
      setNotificationPermission(permission)
      if (permission !== 'granted') {
        // 权限被拒绝，不启用
        setNotificationEnabled(false)
        writeNotificationEnabled(false)
        return
      }
    }
    setNotificationEnabled(enabled)
    writeNotificationEnabled(enabled)
  }

  // AI 供应商变更：仅持久化选择，API Key 通过 useEffect 自动加载对应供应商的存储值
  const changeAIProvider = (v: AIProviderType) => {
    setAIProviderType(v)
    writeAIProviderType(v)
  }

  // API Key 变更（防抖 500ms 持久化）
  // 写入使用 secureStorage 异步加密后持久化，按当前供应商隔离存储
  const changeApiKey = (value: string) => {
    setAIApiKey(value)
    // 清除上一次防抖定时器
    if (apiKeyTimerRef.current) {
      clearTimeout(apiKeyTimerRef.current)
    }
    // 500ms 后持久化（异步加密写入，错误仅 dev 日志）
    apiKeyTimerRef.current = setTimeout(() => {
      void writeAIApiKey(aiProviderType, value)
    }, 500)
  }

  // 失焦时清空定时器，避免失焦后再次触发保存
  const blurApiKey = () => {
    if (apiKeyTimerRef.current) {
      clearTimeout(apiKeyTimerRef.current)
      apiKeyTimerRef.current = null
    }
    void writeAIApiKey(aiProviderType, aiApiKey)
  }

  // 可选模型名覆盖变更（立即持久化，明文存储）
  const changeAIModel = (value: string) => {
    setAIModel(value)
    writeAIModel(value)
  }

  // 自定义模型配置变更（立即持久化，明文存储）
  const changeCustomConfig = (partial: { endpoint?: string; modelId?: string }) => {
    const nextEndpoint = partial.endpoint ?? customEndpoint
    const nextModelId = partial.modelId ?? customModelId
    setCustomEndpoint(nextEndpoint)
    setCustomModelId(nextModelId)
    writeCustomConfig(nextEndpoint, nextModelId)
  }

  return {
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
    changeAIProvider,
    aiApiKey,
    apiKeyLoaded,
    changeApiKey,
    blurApiKey,
    aiModel,
    changeAIModel,
    customEndpoint,
    customModelId,
    changeCustomConfig,
  }
}

// 导出类型供其他模块复用
export type { PronunciationSource }
