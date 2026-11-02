// AI 响应缓存模块
//
// 设计目标：对确定性 AI 调用结果做二级缓存（内存 LRU + IndexedDB），避免重复请求。
//
// 2026-08-30 迁移说明：
// - 持久化层由 localStorage（约 5MB 上限）迁移到 Dexie/IndexedDB（aiCache 表），
//   容量大幅提升，使「全部功能永久缓存」成为可能；所有确定性场景统一 ttlMs = Infinity。
// - 淘汰机制从「TTL 过期」改为「LRU（按 updatedAt 最久未写入优先淘汰）」，
//   避免永久缓存导致 IndexedDB 无限制增长。
//
// 缓存 key：${scenario}[${variant}]|${model}|${sha256(system+user)}
//   - scenario 防止不同场景结果混淆
//   - model 防止跨模型污染（v4-pro 与 v4-flash 结果可能不同）
//   - sha256(system+user) 确保同输入同 key
//
// 内存 LRU：基于 Map 的插入顺序，max 100 条，命中时 delete+set 移到末尾
// IndexedDB：表 aiCache，主键 id = 缓存 key；updatedAt 用于 LRU 淘汰排序
//
// 容错：IndexedDB 不可用 / 损坏 / 配额满均按未命中处理，降级为内存缓存，不抛错

import { logger } from '../../utils/logger'
import { db, type AiCacheEntry } from '../db'

// 内存 LRU 最大条目数
const MEMORY_LRU_MAX = 100

// 永久缓存的 expiresAt 哨兵值
// 注：JSON.stringify(Infinity) 会变成 "null"，导致反序列化后无法区分永久与损坏数据
// 使用 Number.MAX_SAFE_INTEGER（约 285428年）作为永久缓存的哨兵
const PERMANENT_EXPIRES_AT = Number.MAX_SAFE_INTEGER

// 内存 LRU Map（key -> value）
// 利用 Map 的插入顺序实现 LRU：命中时 delete + set 移到末尾，超限时删除最早的（first key）
const memoryCache = new Map<string, { value: string; expiresAt: number; scenario: string }>()

/**
 * 计算 SHA-256 哈希（使用 Web Crypto API）
 * 在不支持的环境（如非安全上下文 / 旧浏览器）回退到简单字符串哈希
 * @param input 待哈希的字符串
 * @returns 十六进制哈希字符串
 */
async function sha256(input: string): Promise<string> {
  // 优先使用 Web Crypto API（需安全上下文：https 或 localhost）
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(input)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // fallthrough to simple hash
    }
  }
  // 回退：简单 FNV-1a 哈希（非加密用途，仅保证同输入同输出）
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 计算缓存 key
 * @param scenario 调用场景标识
 * @param model 模型 ID
 * @param system system 消息内容
 * @param user user 消息内容
 * @param variant 请求形态变体（可选）：数组类场景跳过 json_object 后响应形态不同，
 *                传 'array' 与旧缓存 key 隔离，避免命中 json_object 时代的坏响应
 * @returns 缓存 key：`${scenario}${variant ? ':' + variant : ''}|${model}|${hash}`
 */
export async function computeCacheKey(
  scenario: string,
  model: string,
  system: string,
  user: string,
  variant?: string
): Promise<string> {
  const hash = await sha256(system + user)
  return `${scenario}${variant ? `:${variant}` : ''}|${model}|${hash}`
}

/**
 * 从内存缓存读取
 * 命中时 delete + set 移到末尾（LRU 语义），过期则删除返回 null
 */
function getFromMemory(key: string): { value: string; isMemory: true } | null {
  const entry = memoryCache.get(key)
  if (!entry) return null
  // 过期检查（PERMANENT_EXPIRES_AT 哨兵表示永不过期）
  if (entry.expiresAt !== PERMANENT_EXPIRES_AT && Date.now() > entry.expiresAt) {
    memoryCache.delete(key)
    return null
  }
  // LRU 移到末尾
  memoryCache.delete(key)
  memoryCache.set(key, entry)
  return { value: entry.value, isMemory: true }
}

/**
 * 写入内存缓存（LRU）
 * 超过 MEMORY_LRU_MAX 时删除最早的（first key）
 */
function setInMemory(key: string, value: string, expiresAt: number, scenario: string): void {
  // 已存在则先删除（保证移到末尾）
  if (memoryCache.has(key)) {
    memoryCache.delete(key)
  } else if (memoryCache.size >= MEMORY_LRU_MAX) {
    // 淘汰最早的（Map 的 first key）
    const firstKey = memoryCache.keys().next().value
    if (firstKey !== undefined) {
      memoryCache.delete(firstKey)
    }
  }
  memoryCache.set(key, { value, expiresAt, scenario })
}

// ---------- IndexedDB 持久化（best-effort，失败降级为内存缓存，不抛错） ----------

/**
 * 从 IndexedDB 读取缓存条目。失败返回 null（按未命中处理）。
 */
async function readFromIndexedDB(key: string): Promise<AiCacheEntry | null> {
  try {
    return (await db.aiCache.get(key)) ?? null
  } catch (err) {
    if (import.meta.env.DEV) logger.warn('[responseCache] IndexedDB 读取失败', err)
    return null
  }
}

/**
 * 写入 IndexedDB 缓存条目。失败仅告警不抛错（写入失败不影响本次 AI 调用返回）。
 */
async function writeToIndexedDB(entry: AiCacheEntry): Promise<void> {
  try {
    await db.aiCache.put(entry)
  } catch (err) {
    if (import.meta.env.DEV) logger.warn('[responseCache] IndexedDB 写入失败', err)
  }
}

/**
 * 删除 IndexedDB 单条缓存。失败仅告警不抛错。
 */
async function removeFromIndexedDB(key: string): Promise<void> {
  try {
    await db.aiCache.delete(key)
  } catch (err) {
    if (import.meta.env.DEV) logger.warn('[responseCache] IndexedDB 删除失败', err)
  }
}

/**
 * 获取缓存的值
 * 先查内存 LRU，再查 IndexedDB
 * @param key 缓存 key（由 computeCacheKey 生成）
 * @returns 命中时返回 { value, isMemory }；未命中返回 null
 */
export async function getCached<T>(
  key: string
): Promise<{ value: T; isMemory: boolean } | null> {
  // 1. 查内存
  const memHit = getFromMemory(key)
  if (memHit) {
    try {
      return { value: JSON.parse(memHit.value) as T, isMemory: true }
    } catch {
      // 内存数据损坏（理论上不应发生），删除后继续查 IndexedDB
      memoryCache.delete(key)
    }
  }
  // 2. 查 IndexedDB
  const entry = await readFromIndexedDB(key)
  if (entry) {
    // 过期检查（全永久场景下几乎不触发）
    if (entry.expiresAt !== PERMANENT_EXPIRES_AT && Date.now() > entry.expiresAt) {
      await removeFromIndexedDB(key)
      return null
    }
    try {
      const value = JSON.parse(entry.value) as T
      // 回填内存缓存（提升后续访问速度）
      setInMemory(key, entry.value, entry.expiresAt, entry.scenario)
      return { value, isMemory: false }
    } catch {
      // value 损坏，清理
      await removeFromIndexedDB(key)
    }
  }
  return null
}

/**
 * 写入缓存（同时写内存与 IndexedDB）
 * @param key 缓存 key
 * @param value 待缓存的值（会被 JSON.stringify）
 * @param ttlMs 存活时间（毫秒），Infinity 表示永久缓存
 * @param scenario 调用场景标识（用于按 scenario 清理）
 */
export async function setCached<T>(
  key: string,
  value: T,
  ttlMs: number,
  scenario: string
): Promise<void> {
  // 注：JSON.stringify(Infinity) 会变成 "null"，使用 PERMANENT_EXPIRES_AT 哨兵规避
  const expiresAt = ttlMs === Infinity ? PERMANENT_EXPIRES_AT : Date.now() + ttlMs
  const serialized = JSON.stringify(value)
  setInMemory(key, serialized, expiresAt, scenario)
  await writeToIndexedDB({
    id: key,
    value: serialized,
    scenario,
    expiresAt,
    updatedAt: Date.now(),
  })
}

/**
 * 清理缓存
 * @param scenario 指定 scenario 时仅清理该场景；未指定时清空全部
 */
export async function clearCache(scenario?: string): Promise<void> {
  // 清理内存
  if (scenario === undefined) {
    memoryCache.clear()
  } else {
    for (const [key, entry] of memoryCache.entries()) {
      if (entry.scenario === scenario) {
        memoryCache.delete(key)
      }
    }
  }
  // 清理 IndexedDB
  try {
    if (scenario === undefined) {
      await db.aiCache.clear()
    } else {
      const keys = await db.aiCache.where('scenario').equals(scenario).primaryKeys()
      if (keys.length > 0) {
        await db.aiCache.bulkDelete(keys)
      }
    }
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[responseCache] IndexedDB 清理失败', err)
  }
}

/**
 * 清理所有过期条目（内存 + IndexedDB）
 * 全永久缓存下几乎无过期项；保留此函数用于兼容显式非 Infinity ttl 的调用。
 * @returns 清理的条目数量
 */
export async function cleanupExpired(): Promise<number> {
  const now = Date.now()
  let cleaned = 0
  try {
    const all = await db.aiCache.toArray()
    const expired = all.filter(
      (e) => e.expiresAt !== PERMANENT_EXPIRES_AT && e.expiresAt < now
    )
    if (expired.length > 0) {
      await db.aiCache.bulkDelete(expired.map((e) => e.id))
      cleaned = expired.length
    }
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[responseCache] cleanupExpired 失败', err)
  }
  // 同步清理内存中的过期项（内存缓存在读取时自动清理，这里兜底）
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt !== PERMANENT_EXPIRES_AT && now > entry.expiresAt) {
      memoryCache.delete(key)
    }
  }
  return cleaned
}

/**
 * 强制指定 scenario 的 IndexedDB 条目数量上限（LRU 淘汰）
 *
 * 当某 scenario 的条目数超过 maxEntries 时，按 updatedAt 升序删除最久未写入的条目。
 * 全永久缓存下线后不再有「TTL 过期」淘汰，故此处改为 LRU 淘汰（最久未写入 = 价值最低）。
 *
 * @param scenario 待限制的 scenario 标识
 * @param maxEntries 最大条目数，超出时按 updatedAt 升序淘汰
 * @returns 实际清理的条目数量
 */
export async function enforceScenarioLimit(
  scenario: string,
  maxEntries: number
): Promise<number> {
  if (maxEntries <= 0) return 0
  try {
    const entries = await db.aiCache.where('scenario').equals(scenario).toArray()
    if (entries.length <= maxEntries) return 0
    // 按 updatedAt 升序排序（最久未写入的排前面，优先淘汰）
    entries.sort((a, b) => a.updatedAt - b.updatedAt)
    const overflow = entries.slice(0, entries.length - maxEntries).map((e) => e.id)
    await db.aiCache.bulkDelete(overflow)
    return overflow.length
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[responseCache] enforceScenarioLimit 失败', err)
    return 0
  }
}