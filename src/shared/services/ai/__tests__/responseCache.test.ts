// responseCache 单元测试
//
// 测试覆盖：
// - computeCacheKey：同输入同输出、不同 model/scenario 不同 key
// - 内存 LRU：写入、读取、LRU 淘汰（超 100 条）
// - IndexedDB 持久化与读取（内存 LRU 淘汰后从 IndexedDB 回读）
// - TTL 过期返回 null / Infinity 永不过期
// - IndexedDB 损坏容错（非 JSON value）
// - clearCache 按 scenario 精确清理
// - cleanupExpired 仅清理过期项
// - enforceScenarioLimit 按 updatedAt 升序 LRU 淘汰
//
// 说明：responseCache 已由 localStorage 迁移到 IndexedDB（aiCache 表），
// 故本文件先注入 fake-indexeddb，使 Dexie 在 jsdom 环境下可用。

import { indexedDB as fakeIndexedDB, IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb'
import { db } from '../../db'
import {
  computeCacheKey,
  getCached,
  setCached,
  clearCache,
  cleanupExpired,
  enforceScenarioLimit,
} from '../responseCache'

// 注入 fake IndexedDB（jsdom 无原生实现；fake-indexeddb 为内存实现）
// 需同时注入 indexDB 与 IDBKeyRange（Dexie 范围查询如 .where('scenario').equals 依赖 IDBKeyRange）
if (!('indexedDB' in globalThis)) {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
}
if (!('IDBKeyRange' in globalThis)) {
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: fakeIDBKeyRange,
    configurable: true,
    writable: true,
  })
}

// 测试前/后清空缓存，避免相互污染
beforeEach(async () => {
  await clearCache()
})

afterEach(async () => {
  await clearCache()
})

describe('computeCacheKey', () => {
  it('同输入应返回相同 key', async () => {
    const key1 = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'user')
    const key2 = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'user')
    expect(key1).toBe(key2)
  })

  it('不同 model 应返回不同 key', async () => {
    const key1 = await computeCacheKey('wordBreakdown', 'deepseek-v4-pro', 'sys', 'user')
    const key2 = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'user')
    expect(key1).not.toBe(key2)
  })

  it('不同 scenario 应返回不同 key', async () => {
    const key1 = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'user')
    const key2 = await computeCacheKey('emojiHint', 'deepseek-v4-flash', 'sys', 'user')
    expect(key1).not.toBe(key2)
  })

  it('不同输入应返回不同 key', async () => {
    const key1 = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'apple')
    const key2 = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'banana')
    expect(key1).not.toBe(key2)
  })

  it('key 应包含 scenario 和 model 前缀', async () => {
    const key = await computeCacheKey('wordBreakdown', 'deepseek-v4-flash', 'sys', 'user')
    expect(key.startsWith('wordBreakdown|deepseek-v4-flash|')).toBe(true)
  })
})

describe('内存缓存 LRU', () => {
  it('写入后应能从内存读取', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'user')
    await setCached(key, { value: 'hello' }, 60_000, 'test')
    const result = await getCached<{ value: string }>(key)
    expect(result).not.toBeNull()
    expect(result!.value.value).toBe('hello')
    expect(result!.isMemory).toBe(true)
  })

  it('未写入的 key 应返回 null', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'user')
    expect(await getCached(key)).toBeNull()
  })

  it('LRU 超 100 条时应淘汰最旧条目（可经 IndexedDB 回读）', async () => {
    for (let i = 0; i < 101; i++) {
      const key = await computeCacheKey('test', 'm', 'sys', `user-${i}`)
      await setCached(key, i, 60_000, 'test')
    }
    // 第 0 条应已从内存淘汰；若命中则来自 IndexedDB（isMemory=false）
    const key0 = await computeCacheKey('test', 'm', 'sys', 'user-0')
    const result0 = await getCached<number>(key0)
    if (result0) {
      expect(result0.isMemory).toBe(false)
    }
    // 第 100 条应仍在内存
    const key100 = await computeCacheKey('test', 'm', 'sys', 'user-100')
    const result100 = await getCached<number>(key100)
    expect(result100).not.toBeNull()
    expect(result100!.value).toBe(100)
    expect(result100!.isMemory).toBe(true)
  })

  it('LRU 命中时应移到末尾（不被淘汰）', async () => {
    for (let i = 0; i < 100; i++) {
      const key = await computeCacheKey('test', 'm', 'sys', `user-${i}`)
      await setCached(key, i, 60_000, 'test')
    }
    // 读取第 0 条（移到末尾）
    const key0 = await computeCacheKey('test', 'm', 'sys', 'user-0')
    const result0 = await getCached<number>(key0)
    expect(result0).not.toBeNull()
    expect(result0!.isMemory).toBe(true)
    // 写入第 100 条（触发淘汰，应淘汰第 1 条而非第 0 条）
    const key100 = await computeCacheKey('test', 'm', 'sys', 'user-100')
    await setCached(key100, 100, 60_000, 'test')
    // 第 0 条应仍在内存（被读取过，移到末尾）
    const result0Again = await getCached<number>(key0)
    expect(result0Again).not.toBeNull()
    expect(result0Again!.isMemory).toBe(true)
  })
})

describe('IndexedDB 持久化', () => {
  it('内存 LRU 淘汰后仍能从 IndexedDB 回读（isMemory=false）', async () => {
    const key0 = await computeCacheKey('persist', 'm', 'sys', 'user-0')
    await setCached(key0, 'v0', Infinity, 'persist')
    // 再写入 119 条，触发内存 LRU（100 条上限）淘汰 key0
    for (let i = 1; i < 120; i++) {
      const key = await computeCacheKey('persist', 'm', 'sys', `user-${i}`)
      await setCached(key, `v${i}`, Infinity, 'persist')
    }
    const result = await getCached<string>(key0)
    expect(result).not.toBeNull()
    expect(result!.value).toBe('v0')
    // key0 已从内存淘汰，命中的是 IndexedDB
    expect(result!.isMemory).toBe(false)
  })

  it('IndexedDB 损坏数据（非 JSON value）返回 null 并清理', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'corrupt')
    await db.aiCache.put({
      id: key,
      value: 'not-a-json',
      scenario: 'test',
      expiresAt: Number.MAX_SAFE_INTEGER,
      updatedAt: Date.now(),
    })
    expect(await getCached<string>(key)).toBeNull()
    // 损坏数据应被清理
    expect(await db.aiCache.get(key)).toBeUndefined()
  })
})

describe('TTL 过期', () => {
  it('未过期的缓存应返回值', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'user')
    await setCached(key, 'fresh', 60_000, 'test')
    const result = await getCached<string>(key)
    expect(result).not.toBeNull()
    expect(result!.value).toBe('fresh')
  })

  it('过期的缓存应返回 null 并清理', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'expired')
    await db.aiCache.put({
      id: key,
      value: JSON.stringify('expired'),
      scenario: 'test',
      expiresAt: Date.now() - 1000, // 已过期
      updatedAt: Date.now(),
    })
    expect(await getCached<string>(key)).toBeNull()
    expect(await db.aiCache.get(key)).toBeUndefined()
  })

  it('Infinity TTL 应永不过期', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'permanent')
    await setCached(key, 'permanent', Infinity, 'test')
    const result = await getCached<string>(key)
    expect(result).not.toBeNull()
    expect(result!.value).toBe('permanent')
    expect(result!.isMemory).toBe(true)
  })
})

describe('clearCache', () => {
  it('未指定 scenario 时清空全部', async () => {
    const key1 = await computeCacheKey('test1', 'm', 'sys', 'user')
    const key2 = await computeCacheKey('test2', 'm', 'sys', 'user')
    await setCached(key1, 'v1', 60_000, 'test1')
    await setCached(key2, 'v2', 60_000, 'test2')
    await clearCache()
    expect(await getCached(key1)).toBeNull()
    expect(await getCached(key2)).toBeNull()
  })

  it('指定 scenario 时仅清理该场景', async () => {
    const key1 = await computeCacheKey('test1', 'm', 'sys', 'user')
    const key2 = await computeCacheKey('test2', 'm', 'sys', 'user')
    await setCached(key1, 'v1', 60_000, 'test1')
    await setCached(key2, 'v2', 60_000, 'test2')
    await clearCache('test1')
    expect(await getCached(key1)).toBeNull()
    expect(await getCached(key2)).not.toBeNull()
  })
})

describe('cleanupExpired', () => {
  it('仅清理过期项，保留未过期项', async () => {
    const key1 = await computeCacheKey('test1', 'm', 'sys', 'user1')
    const key2 = await computeCacheKey('test2', 'm', 'sys', 'user2')
    await setCached(key1, 'v1', -1, 'test1') // 立即过期
    await setCached(key2, 'v2', Infinity, 'test2') // 永久
    const cleaned = await cleanupExpired()
    expect(cleaned).toBeGreaterThanOrEqual(1)
    expect(await getCached(key1)).toBeNull()
    expect((await getCached(key2))?.value).toBe('v2')
  })

  it('无过期项时返回 0', async () => {
    const key = await computeCacheKey('test', 'm', 'sys', 'user')
    await setCached(key, 'v', Infinity, 'test')
    expect(await cleanupExpired()).toBe(0)
  })
})

describe('enforceScenarioLimit（LRU 淘汰）', () => {
  it('超过上限时按 updatedAt 升序淘汰最久未写入的条目', async () => {
    const scenario = 'limitTest'
    const keys: string[] = []
    // 写入 5 条并显式设置递增的 updatedAt，保证淘汰顺序确定
    for (let i = 0; i < 5; i++) {
      const key = await computeCacheKey(scenario, 'm', 'sys', `user-${i}`)
      keys.push(key)
      await setCached(key, i, Infinity, scenario)
      await db.aiCache.update(key, { updatedAt: 1000 + i })
    }
    const removed = await enforceScenarioLimit(scenario, 3)
    expect(removed).toBe(2)
    // 剩余 3 条为 updatedAt 最大的 user-2 / user-3 / user-4
    const remaining = (
      await db.aiCache.where('scenario').equals(scenario).primaryKeys()
    ).sort()
    expect(remaining).toEqual([keys[2], keys[3], keys[4]].sort())
  })
})