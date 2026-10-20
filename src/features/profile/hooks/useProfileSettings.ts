// 个人中心设置 hook：管理统计数据加载与本地扩展设置（通知/AI 配置）
// - 多个 useState：stats / achievements / loading / settings / notificationEnabled
//   / notificationPermission / aiProviderType / aiApiKey / apiKeyLoaded / aiModel / aiEndpoint
// - 持久化读写：notificationEnabled / aiProviderType / aiApiKey（按供应商隔离，secureStorage 加密）
//   / aiModel / aiEndpoint（localStorage 明文）/ settings / notificationPermission
import { useEffect, useMemo, useRef, useState } from 'react'
import { getUnlockedAchievements } from '@/features/stats/services/achievementService'
import { readingSessionRepository, wordRepository } from '@/shared/services'
import { secureGetItem, secureSetItem } from '@/shared/services/secureStorage'
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
import {
  getCustomModelConfig,
  getCurrentAIProviderName,
  type AIProviderName,
} from '@/shared/services/ai'
import type { Achievement } from '@/shared/types'

// ====== 本地扩展设置（不属于 Settings 接口，独立存储） ======
// localStorage keys
const LS_KEY_NOTIFICATION_ENABLED = 'ydxl-ext-notification-enabled'
const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'
const LS_KEY_AI_API_KEY_LEGACY = 'ydxl-ext-ai-api-key'
// 新版按供应商隔离的 API Key 存储
const LS_KEY_AI_API_KEY_DEEPSEEK = 'ydxl-ext-ai-api-key-deepseek'
const LS_KEY_AI_API_KEY_OPENAI = 'ydxl-ext-ai-api-key-openai'
const LS_KEY_AI_API_KEY_QWEN = 'ydxl-ext-ai-api-key-qwen'
const LS_KEY_AI_API_KEY_CUSTOM = 'ydxl-ext-ai-api-key-custom'
// 可选模型名覆盖（内置供应商）
const LS_KEY_AI_MODEL = 'ydxl-ext-ai-model'
// 自定义模型配置：请求地址与模型 ID（localStorage 明文，非敏感信息）
const LS_KEY_CUSTOM_ENDPOINT = 'ydxl-ext-ai-custom-endpoint'
const LS_KEY_CUSTOM_MODEL = 'ydxl-ext-ai-custom-model'

// AI 供应商类型（与 ai/types.ts 的 AIProviderName 统一，沿用 AIProviderType 别名以减少改动）
export type AIProviderType = AIProviderName

// ====== 统计数据聚合结构 ======
export interface ProfileStats {
  // 总阅读篇数（readingSessions 表总数）
  totalReadCount: number
  // 总学习词数（words 表总数）
  totalWords: number
  // 累计学习时长（秒）
  totalDurationSec: number
  // 总掌握单词数（mastery >= 5）
  totalMasteredWords: number
}

// 读取本地扩展设置
function readNotificationEnabled(): boolean {
  try {
    return window.localStorage.getItem(LS_KEY_NOTIFICATION_ENABLED) === '1'
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 读取通知开关失败', err)
    return false
  }
}
// 读取 AI 供应商选择：委托给运行时工厂 getCurrentAIProviderName（localStorage > env 自动检测 > deepseek），
// 确保表单初始值与业务实际生效的供应商完全一致——修复「界面显示 deepseek、实际走 custom」的不一致（根因 2）
function readAIProviderType(): AIProviderType {
  try {
    return getCurrentAIProviderName()
  } catch {
    // 模块初始化极端异常时回退默认供应商
    return 'deepseek'
  }
}
// 根据供应商返回对应的 secureStorage key（按供应商隔离，避免切换时互相覆盖）
function apiKeyStorageKey(provider: AIProviderType): string {
  switch (provider) {
    case 'openai':
      return LS_KEY_AI_API_KEY_OPENAI
    case 'qwen':
      return LS_KEY_AI_API_KEY_QWEN
    case 'custom':
      return LS_KEY_AI_API_KEY_CUSTOM
    case 'deepseek':
    default:
      return LS_KEY_AI_API_KEY_DEEPSEEK
  }
}
// 异步读取 AI API Key（使用 secureStorage 解密）
// - secureStorage 在不支持 IndexedDB 的环境（如 jsdom 测试）降级为明文读取
// - DeepSeek 供应商首次读取时若新 key 不存在，尝试从旧版 legacy key 迁移
async function readAIApiKey(provider: AIProviderType): Promise<string> {
  try {
    const key = apiKeyStorageKey(provider)
    const stored = await secureGetItem(key)
    if (stored) return stored
    // 一次性迁移：旧版 DeepSeek 用户在 ydxl-ext-ai-api-key 中存有 Key
    // 仅当供应商为 deepseek 且 legacy key 存在时迁移
    if (provider === 'deepseek') {
      const legacy = await secureGetItem(LS_KEY_AI_API_KEY_LEGACY)
      if (legacy) {
        // 写入新隔离 key 后立即清除 legacy（幂等：迁移完成再次进入时 legacy 已为空）
        await secureSetItem(LS_KEY_AI_API_KEY_DEEPSEEK, legacy)
        try {
          window.localStorage.removeItem(LS_KEY_AI_API_KEY_LEGACY)
        } catch {
          // localStorage 不可用时忽略
        }
        return legacy
      }
    }
    return ''
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 读取 AI API Key 失败', err)
    return ''
  }
}
// 同步读取可选模型名覆盖（localStorage 明文，未配置返回空串）
function readAIModel(): string {
  try {
    return window.localStorage.getItem(LS_KEY_AI_MODEL) ?? ''
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 读取 AI 模型名失败', err)
    return ''
  }
}
// 同步读取自定义模型请求地址（localStorage > env 默认值，与运行时配置一致）
// 复用 getCustomModelConfig 保证表单初始值与工厂实际生效值完全一致：
// 部署者在 .env 预填的端点会直接显示在输入框中，用户修改后以 localStorage 为准
function readCustomEndpoint(): string {
  return getCustomModelConfig().endpoint
}
// 同步读取自定义模型 ID（localStorage > env 默认值，与运行时配置一致）
function readCustomModelId(): string {
  return getCustomModelConfig().model
}
function writeNotificationEnabled(v: boolean) {
  try {
    window.localStorage.setItem(LS_KEY_NOTIFICATION_ENABLED, v ? '1' : '0')
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 写入通知开关失败', err)
  }
}
function writeAIProviderType(v: AIProviderType) {
  try {
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, v)
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 写入 AI 供应商失败', err)
  }
}
// 异步写入 AI API Key（使用 secureStorage 加密后持久化）
// - secureStorage 在不支持 IndexedDB 的环境降级为明文存储
// - 按供应商隔离，避免切换时互相覆盖
async function writeAIApiKey(provider: AIProviderType, v: string): Promise<void> {
  try {
    await secureSetItem(apiKeyStorageKey(provider), v)
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 写入 AI API Key 失败', err)
  }
}
function writeAIModel(v: string) {
  try {
    window.localStorage.setItem(LS_KEY_AI_MODEL, v)
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 写入 AI 模型名失败', err)
  }
}
// 写入自定义模型请求地址与模型 ID（localStorage 明文）
function writeCustomConfig(endpoint: string, modelId: string) {
  try {
    window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, endpoint)
    window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, modelId)
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[ProfilePage] 写入自定义模型配置失败', err)
  }
}

// 将秒数格式化为 "X 小时 Y 分钟" / "Y 分钟" / "X 秒"
export function formatDuration(sec: number): string {
  if (sec <= 0) return '0 分钟'
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  const seconds = sec % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  if (minutes > 0) {
    return `${minutes} 分钟`
  }
  return `${seconds} 秒`
}

export interface UseProfileSettingsResult {
  // 统计数据
  stats: ProfileStats | null
  achievements: Achievement[]
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
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)

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

  // API Key 防抖定时器
  const apiKeyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载统计数据
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // 通过 CachedRemoteRepository 获取数据（服务器为主，Dexie 离线缓存）
        // 使用 Dexie 索引 count/where 查询替代 getAll().filter()，避免全表扫描
        const [sessions, totalWords, totalMasteredWords, unlocked] = await Promise.all([
          readingSessionRepository.getAll(),
          wordRepository.count(),
          // mastery 是索引字段，mastery > 4 即 mastery >= 5
          wordRepository.countWhereAbove('mastery', 4),
          getUnlockedAchievements(),
        ])
        if (!cancelled) {
          setStats({
            totalReadCount: sessions.length,
            totalWords,
            totalDurationSec: sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0),
            totalMasteredWords,
          })
          setAchievements(unlocked)
          setLoading(false)
        }
      } catch (err) {
        console.warn('[ProfilePage] 加载统计数据失败', err)
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

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
      sendNotification('学习提醒', {
        body: '到点啦，坚持每日学习英语，点滴积累成就进步！',
        icon: undefined,
      })
    })
    return () => {
      if (cancelReminderRef.current) {
        cancelReminderRef.current()
        cancelReminderRef.current = null
      }
    }
  }, [notificationEnabled, settings.reminderTime])

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

  // 累计时长文案
  const durationText = useMemo(
    () => (stats ? formatDuration(stats.totalDurationSec) : '--'),
    [stats],
  )

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
