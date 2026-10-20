//
// 测试范围：
// 1. 初始化时从 localStorage 读取配置（aiApiKey / notificationEnabled / aiProviderType / aiModel）
// 2. changeApiKey(value) 写入并持久化（防抖 500ms，按当前供应商隔离存储）
// 3. changeAIProvider(v) 写入并持久化
// 4. updateSettingsHandler 持久化 settings
// 5. 配置变化时触发 localStorage.setItem
// 6. 旧版 ydxl-ext-ai-api-key 一次性迁移到 ydxl-ext-ai-api-key-deepseek
// 7. changeAIModel 立即持久化
// 8. 旧 nvidia 供应商值向后兼容回退到 deepseek
//
// Mock 策略：
// - 使用 vi.mock 替换 '@/shared/services' 与 '@/features/stats/services/achievementService'
//   中的数据加载方法，避免触发真实网络请求
// - localStorage 使用 jsdom 提供的真实实现，每个用例前后清理

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// vi.mock 必须在 import 之前声明（hoisted）
vi.mock('@/features/stats/services/achievementService', () => ({
  getUnlockedAchievements: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/shared/services', () => ({
  // 仓库方法：返回空数据，避免网络请求
  readingSessionRepository: {
    getAll: vi.fn().mockResolvedValue([]),
  },
  wordRepository: {
    count: vi.fn().mockResolvedValue(0),
    countWhereAbove: vi.fn().mockResolvedValue(0),
  },
  // Settings 服务：使用真实 localStorage 逻辑（便于断言 setItem）
  getSettings: vi.fn(() => ({
    dailyReviewLimit: 50,
    dailyGoalArticles: 2,
    dailyGoalWords: 15,
    pronunciationSource: 'us',
    reminderTime: '20:00',
  })),
  updateSettings: vi.fn((partial) => {
    const current = {
      dailyReviewLimit: 50,
      dailyGoalArticles: 2,
      dailyGoalWords: 15,
      pronunciationSource: 'us',
      reminderTime: '20:00',
    }
    const next = { ...current, ...partial }
    try {
      window.localStorage.setItem('ydxl-settings', JSON.stringify(next))
    } catch {
      // ignore
    }
    return next
  }),
  resetSettings: vi.fn(),
  DEFAULT_USER_SETTINGS: {
    dailyReviewLimit: 50,
    dailyGoalArticles: 2,
    dailyGoalWords: 15,
    pronunciationSource: 'us',
    reminderTime: '20:00',
  },
  // 通知相关：默认不支持，简化测试
  isNotificationSupported: vi.fn(() => false),
  getNotificationPermission: vi.fn(() => 'default'),
  requestNotificationPermission: vi.fn().mockResolvedValue('denied'),
  sendNotification: vi.fn(),
  setupDailyReminder: vi.fn(() => () => {}),
}))

// secureStorage 依赖 IndexedDB + Web Crypto 加密；全局 setupIndexedDB 注入的 fake-indexeddb
// 在 vi.useFakeTimers 下其 open 回调不触发，导致 loadOrCreateKey 的 Promise 悬挂。
// 本测试关注 hook 的持久化编排（防抖 / 按供应商隔离 / legacy 迁移），不验证 secureStorage
// 的加密实现，故 mock 为明文 localStorage 读写，保持 secureGetItem/secureSetItem 的异步语义。
vi.mock('@/shared/services/secureStorage', () => ({
  secureGetItem: vi.fn(async (key: string) => window.localStorage.getItem(key) ?? ''),
  secureSetItem: vi.fn(async (key: string, value: string) => {
    window.localStorage.setItem(key, value)
  }),
}))

import { useProfileSettings } from '../useProfileSettings'

// localStorage key 常量（与 hook 内部一致）
const LS_KEY_NOTIFICATION_ENABLED = 'ydxl-ext-notification-enabled'
const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'
const LS_KEY_AI_API_KEY_DEEPSEEK = 'ydxl-ext-ai-api-key-deepseek'
const LS_KEY_AI_API_KEY_LEGACY = 'ydxl-ext-ai-api-key'
const LS_KEY_AI_MODEL = 'ydxl-ext-ai-model'
const LS_KEY_SETTINGS = 'ydxl-settings'

describe('useProfileSettings', () => {
  // 保存原始 localStorage 以便恢复
  const originalLocalStorage = { ...window.localStorage }

  beforeEach(() => {
    // 清理 localStorage，确保每个用例从干净状态开始
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    window.localStorage.clear()
    // 恢复 localStorage 方法（虽然 jsdom 的 clear 不会移除方法）
    vi.restoreAllMocks()
    // 还原原始 localStorage 方法引用
    Object.assign(window.localStorage, originalLocalStorage)
    // 安全网：任何用例若未在 finally 中还原 real timers，此处兜底
    vi.useRealTimers()
  })

  // 1. 初始化时从 localStorage 读取配置
  // 注意：aiApiKey 通过 secureStorage 异步加载，需通过 waitFor 等待 apiKeyLoaded
  it('初始化时从 localStorage 读取 aiApiKey 与 notificationEnabled', async () => {
    // 预置 localStorage 数据（jsdom 无 IndexedDB，secureStorage 降级为明文读取）
    window.localStorage.setItem(LS_KEY_AI_API_KEY_DEEPSEEK, 'sk-pre-configured-key')
    window.localStorage.setItem(LS_KEY_NOTIFICATION_ENABLED, '1')

    const { result } = renderHook(() => useProfileSettings())

    // notificationEnabled 同步读取
    expect(result.current.notificationEnabled).toBe(true)
    // aiApiKey 异步加载，等待 apiKeyLoaded 标志
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.aiApiKey).toBe('sk-pre-configured-key')
  })

  // 2. 初始化时 localStorage 无配置 → 返回默认值
  it('初始化时 localStorage 无配置 → 返回默认值', async () => {
    const { result } = renderHook(() => useProfileSettings())

    // 无配置时 aiApiKey 初始为空
    expect(result.current.aiApiKey).toBe('')
    // notificationEnabled 为 false
    expect(result.current.notificationEnabled).toBe(false)
    // aiProviderType 默认 deepseek（localStorage 无值时回退）
    expect(result.current.aiProviderType).toBe('deepseek')
    // 等待异步加载完成（无数据时仍为空）
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.aiApiKey).toBe('')
  })

  // 3. changeApiKey(value) 写入并持久化（防抖 500ms）
  // 注意：secureSetItem 在 jsdom 无 IndexedDB 时降级为同步 localStorage.setItem，
  // 但仍需 await flush microtasks。使用 vi.advanceTimersByTimeAsync 同时推进 timer 与微任务。
  it('changeApiKey 调用后 500ms 防抖写入 localStorage（按当前供应商隔离）', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useProfileSettings())

      // 调用 changeApiKey
      act(() => {
        result.current.changeApiKey('sk-new-key-123')
      })

      // 验证 state 已立即更新
      expect(result.current.aiApiKey).toBe('sk-new-key-123')

      // 防抖未到期时 localStorage 尚未写入
      expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_DEEPSEEK)).toBeNull()

      // 推进 500ms 触发防抖写入（同时 flush 微任务以完成 secureSetItem）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      // 验证 localStorage 已持久化到 deepseek 隔离 key（jsdom 降级为明文）
      expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_DEEPSEEK)).toBe('sk-new-key-123')
    } finally {
      vi.useRealTimers()
    }
  })

  // 4. changeApiKey 连续调用 → 防抖仅持久化最后一次
  it('changeApiKey 连续调用 → 防抖仅持久化最后一次值', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useProfileSettings())

      act(() => {
        result.current.changeApiKey('first-key')
      })
      act(() => {
        result.current.changeApiKey('second-key')
      })
      act(() => {
        result.current.changeApiKey('final-key')
      })

      // 推进 500ms 并 flush 微任务
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      // 仅持久化最后一次
      expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_DEEPSEEK)).toBe('final-key')
    } finally {
      vi.useRealTimers()
    }
  })

  // 5. blurApiKey 立即持久化当前值（异步 secureSetItem）
  it('blurApiKey 立即持久化当前 aiApiKey', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useProfileSettings())

      act(() => {
        result.current.changeApiKey('sk-blur-key')
      })

      // 防抖未到期前调用 blurApiKey
      act(() => {
        result.current.blurApiKey()
      })

      // blurApiKey 触发 secureSetItem（异步），等待微任务完成
      await act(async () => {
        // 触发微任务队列刷新，使 secureSetItem 的 await 链完成
        await Promise.resolve()
      })

      // 验证立即持久化（无需等待 500ms）
      expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_DEEPSEEK)).toBe('sk-blur-key')
    } finally {
      vi.useRealTimers()
    }
  })

  // 6. changeAIProvider(v) 写入并持久化
  it('changeAIProvider 调用后立即写入 localStorage', () => {
    const { result } = renderHook(() => useProfileSettings())

    act(() => {
      result.current.changeAIProvider('deepseek')
    })

    // 验证 state 已更新
    expect(result.current.aiProviderType).toBe('deepseek')
    // 验证 localStorage 已持久化
    expect(window.localStorage.getItem(LS_KEY_AI_PROVIDER)).toBe('deepseek')
  })

  // 7. updateSettingsHandler 持久化 settings
  it('updateSettingsHandler 调用后持久化 settings 到 localStorage', () => {
    const { result } = renderHook(() => useProfileSettings())

    act(() => {
      result.current.updateSettingsHandler({ dailyGoalWords: 30 })
    })

    // 验证 state 已更新
    expect(result.current.settings.dailyGoalWords).toBe(30)
    // 验证 localStorage 已写入 settings
    const stored = window.localStorage.getItem(LS_KEY_SETTINGS)
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as { dailyGoalWords: number }
    expect(parsed.dailyGoalWords).toBe(30)
  })

  // 8. 配置变化时触发 localStorage.setItem（通过读取 localStorage 值验证持久化）
  it('配置变化时触发 localStorage.setItem', async () => {
    const { result } = renderHook(() => useProfileSettings())

    // changeAIProvider 应触发 setItem → localStorage 中可读取到值
    act(() => {
      result.current.changeAIProvider('deepseek')
    })
    expect(window.localStorage.getItem(LS_KEY_AI_PROVIDER)).toBe('deepseek')

    // updateSettingsHandler 应触发 setItem → localStorage 中可读取到 settings
    act(() => {
      result.current.updateSettingsHandler({ reminderTime: '21:00' })
    })
    const storedSettings = JSON.parse(
      window.localStorage.getItem(LS_KEY_SETTINGS)!,
    ) as { reminderTime: string }
    expect(storedSettings.reminderTime).toBe('21:00')

    // 验证 changeApiKey 防抖后也会写入 localStorage
    act(() => {
      result.current.changeApiKey('sk-persist-test')
    })
    act(() => {
      // 同步触发防抖（使用 blurApiKey 立即持久化）
      result.current.blurApiKey()
    })
    // blurApiKey 走 secureSetItem 异步链，等待微任务完成
    await act(async () => {
      await Promise.resolve()
    })
    expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_DEEPSEEK)).toBe('sk-persist-test')
  })

  // 9. toggleNotification 启用时写入 notificationEnabled
  it('toggleNotification(false) 写入 localStorage 为 0', async () => {
    // 预置为启用
    window.localStorage.setItem(LS_KEY_NOTIFICATION_ENABLED, '1')

    const { result } = renderHook(() => useProfileSettings())

    // 关闭通知
    await act(async () => {
      await result.current.toggleNotification(false)
    })

    // 验证 state 已更新
    expect(result.current.notificationEnabled).toBe(false)
    // 验证 localStorage 已写入 '0'
    expect(window.localStorage.getItem(LS_KEY_NOTIFICATION_ENABLED)).toBe('0')
  })

  // 10. aiProviderType 从 localStorage 读取（默认 deepseek，旧 nvidia 值向后兼容回退到 deepseek）
  it('aiProviderType 从 localStorage 读取（旧 nvidia 值回退到 deepseek）', () => {
    window.localStorage.setItem(LS_KEY_AI_PROVIDER, 'nvidia')
    const { result } = renderHook(() => useProfileSettings())
    // 移除 NVIDIA 供应商后，存储了 'nvidia' 的旧用户应回退到 'deepseek'（向后兼容）
    expect(result.current.aiProviderType).toBe('deepseek')
  })

  // 11. aiModel 从 localStorage 同步读取
  it('aiModel 从 localStorage 同步读取', () => {
    window.localStorage.setItem(LS_KEY_AI_MODEL, 'z-ai/glm-5.2')
    const { result } = renderHook(() => useProfileSettings())
    expect(result.current.aiModel).toBe('z-ai/glm-5.2')
  })

  // 12. changeAIModel 立即持久化
  it('changeAIModel 立即写入 localStorage', () => {
    const { result } = renderHook(() => useProfileSettings())

    act(() => {
      result.current.changeAIModel('deepseek-v4-pro')
    })
    expect(window.localStorage.getItem(LS_KEY_AI_MODEL)).toBe('deepseek-v4-pro')
  })

  // 13. 旧版 ydxl-ext-ai-api-key 一次性迁移到 ydxl-ext-ai-api-key-deepseek
  it('旧版 legacy key 自动迁移到 deepseek 隔离 key', async () => {
    // 仅预置 legacy key，不预置新隔离 key
    window.localStorage.setItem(LS_KEY_AI_API_KEY_LEGACY, 'sk-legacy')

    const { result } = renderHook(() => useProfileSettings())

    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    // 迁移后 aiApiKey 应为 legacy 值
    expect(result.current.aiApiKey).toBe('sk-legacy')
    // 新隔离 key 已写入
    expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_DEEPSEEK)).toBe('sk-legacy')
    // legacy key 已被清除（幂等：下次进入不再触发迁移）
    expect(window.localStorage.getItem(LS_KEY_AI_API_KEY_LEGACY)).toBeNull()
  })
})
