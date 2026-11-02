// 用户设置服务：localStorage 持久化的全局偏好配置
// 包含每日复习上限、每日目标、发音源、提醒时间等设置项
// 存储 key：ydxl-settings

// 发音源类型：美音 / 英音
import { logger } from '../utils/logger'
export type PronunciationSource = 'us' | 'uk'

// 设置项结构
export interface Settings {
  // 每日复习上限（默认 50）
  dailyReviewLimit: number
  // 每日目标阅读篇数（默认 2）
  dailyGoalArticles: number
  // 每日目标学习单词数（默认 15）
  dailyGoalWords: number
  // 发音源：美音 / 英音
  pronunciationSource: PronunciationSource
  // 每日提醒时间（HH:mm 格式，默认 20:00）
  reminderTime: string
}

// localStorage 存储 key
const STORAGE_KEY = 'ydxl-settings'

// 默认设置
const DEFAULT_SETTINGS: Settings = {
  dailyReviewLimit: 50,
  dailyGoalArticles: 2,
  dailyGoalWords: 15,
  pronunciationSource: 'us',
  reminderTime: '20:00',
}

// 判断当前运行环境是否支持 localStorage
function isLocalStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    const testKey = '__ydxl_settings_test__'
    window.localStorage.setItem(testKey, '1')
    window.localStorage.removeItem(testKey)
    return true
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[settings] localStorage 不可用（可能是隐私模式）', err)
    return false
  }
}

/**
 * 获取当前设置
 * - 若 localStorage 可用且存在已保存设置，合并默认值后返回
 * - 否则返回默认设置
 */
export function getSettings(): Settings {
  if (!isLocalStorageAvailable()) return { ...DEFAULT_SETTINGS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    // 与默认值合并，确保新增字段有默认值
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch (err) {
    // JSON 解析失败（缓存损坏）时回退到默认设置
    if (import.meta.env.DEV)
      logger.warn('[settings] 设置 JSON 解析失败，回退到默认值', err)
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * 更新设置（部分更新）
 * - 合并到现有设置并持久化
 * - 返回更新后的完整设置
 */
export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings()
  const next: Settings = { ...current, ...partial }
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (err) {
      // 持久化失败时仅返回内存值，不抛错
      if (import.meta.env.DEV)
        logger.warn('[settings] 设置持久化失败，仅保留内存值', err)
    }
  }
  return next
}

/**
 * 重置设置为默认值
 * - 清除 localStorage 中的设置项
 * - 返回默认设置
 */
export function resetSettings(): Settings {
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
      if (import.meta.env.DEV)
        logger.warn('[settings] 清除设置失败', err)
    }
  }
  return { ...DEFAULT_SETTINGS }
}

// 默认设置导出（便于外部读取默认值）
export const DEFAULT_USER_SETTINGS: Settings = { ...DEFAULT_SETTINGS }
