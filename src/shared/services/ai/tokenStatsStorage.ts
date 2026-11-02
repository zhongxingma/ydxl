// AI Token 统计持久化：localStorage 读写与条目校验
//
// 存储结构 { entries: StatsEntry[]; updatedAt: string }，最多保留最近 1000 条（FIFO 淘汰）。
// 容错：localStorage 损坏（非 JSON / 缺字段）按空统计处理，不抛错。
import { logger } from '../../utils/logger'
import type { StatsEntry } from './tokenStatsTypes'

export const STORAGE_KEY = 'ydxl-ai-token-stats'
export const MAX_ENTRIES = 1000

/**
 * 从 localStorage 加载历史 entries
 * 失败时返回空数组，不抛错
 */
export function loadEntriesFromStorage(): StatsEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { entries?: unknown }
    if (!parsed || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter(isValidEntry) as StatsEntry[]
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[tokenStats] localStorage 加载失败，按空统计处理', err)
    return []
  }
}

/**
 * 校验 entry 是否有效
 */
function isValidEntry(entry: unknown): entry is StatsEntry {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.scenario === 'string' &&
    typeof e.model === 'string' &&
    typeof e.prompt_tokens === 'number' &&
    typeof e.completion_tokens === 'number' &&
    typeof e.cacheHit === 'boolean' &&
    typeof e.timestamp === 'number'
  )
}

/**
 * 持久化 entries 到 localStorage
 * 失败时 console.warn，不抛错
 */
export function persistEntries(entries: StatsEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload = JSON.stringify({
      entries: entries.slice(-MAX_ENTRIES),
      updatedAt: new Date().toISOString(),
    })
    localStorage.setItem(STORAGE_KEY, payload)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[tokenStats] localStorage 写入失败', err)
  }
}
