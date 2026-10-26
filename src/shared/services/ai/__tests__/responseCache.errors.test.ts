// responseCache 容错分支单元测试
//
// 覆盖场景：
// 1. SHA-256 不可用 / 摘要失败时回退到 FNV-1a，缓存 key 仍稳定
// 2. 内存 LRU 过期淘汰
// 3. IndexedDB 读 / 写 / 删失败时降级为内存缓存或未命中，且不抛错
// 4. clearCache 全量与按 scenario 清理（含失败兜底）
// 5. cleanupExpired 过期清理与失败兜底
// 6. enforceScenarioLimit 参数边界、LRU 淘汰与失败兜底
//
// Mock 策略：直接 spy 真实 Dexie 表的 aiCache 方法（responseCache 在 setupFiles 阶段
// 已持有真实 db 实例，模块级 vi.mock('../../db') 不会生效）；逐用例注入成功 / 失败结果。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiCacheEntry } from '../../db'
import { db } from '../../db'

import {
  computeCacheKey,
  getCached,
  setCached,
  clearCache,
  cleanupExpired,
  enforceScenarioLimit,
} from '../responseCache'

const PERMANENT = Number.MAX_SAFE_INTEGER

function makeEntry(overrides: Partial<AiCacheEntry> = {}): AiCacheEntry {
  return {
    id: 'k1',
    value: '"v1"',
    scenario: 's1',
    expiresAt: PERMANENT,
    updatedAt: 1,
    ...overrides,
  }
}

function fakeCollection(entries: AiCacheEntry[]): unknown {
  return {
    equals: () => ({
      toArray: async () => entries,
      primaryKeys: async () => entries.map((e) => e.id),
    }),
  }
}

describe('responseCache 容错分支', () => {
  let getSpy: ReturnType<typeof vi.spyOn>
  let putSpy: ReturnType<typeof vi.spyOn>
  let deleteSpy: ReturnType<typeof vi.spyOn>
  let clearSpy: ReturnType<typeof vi.spyOn>
  let whereSpy: ReturnType<typeof vi.spyOn>
  let toArraySpy: ReturnType<typeof vi.spyOn>
  let bulkDeleteSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    // 先用真实实现清理上一用例残留的内存 LRU 与 IndexedDB 数据
    await clearCache()
    getSpy = vi.spyOn(db.aiCache, 'get').mockResolvedValue(undefined)
    putSpy = vi.spyOn(db.aiCache, 'put').mockResolvedValue('k1')
    deleteSpy = vi.spyOn(db.aiCache, 'delete').mockResolvedValue(undefined)
    clearSpy = vi.spyOn(db.aiCache, 'clear').mockResolvedValue(undefined)
    whereSpy = vi.spyOn(db.aiCache, 'where').mockReturnValue(
      fakeCollection([]) as ReturnType<typeof db.aiCache.where>,
    )
    toArraySpy = vi.spyOn(db.aiCache, 'toArray').mockResolvedValue([])
    bulkDeleteSpy = vi.spyOn(db.aiCache, 'bulkDelete').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('computeCacheKey', () => {
    it('crypto 不可用时回退 8 位 hash，同输入稳定且含 variant', async () => {
      vi.stubGlobal('crypto', undefined)

      const a = await computeCacheKey('article', 'deepseek-v4-pro', 'sys', 'user')
      const b = await computeCacheKey('article', 'deepseek-v4-pro', 'sys', 'user')
      const variant = await computeCacheKey('questions', 'm', 'sys', 'user', 'array')

      expect(a).toBe(b)
      expect(a).toMatch(/^article\|deepseek-v4-pro\|[0-9a-f]{8}$/)
      expect(variant).toMatch(/^questions:array\|m\|[0-9a-f]{8}$/)
    })

    it('crypto.subtle 摘要失败时回退同步 hash', async () => {
      vi.stubGlobal('crypto', {
        subtle: { digest: vi.fn(async () => Promise.reject(new Error('digest failed'))) },
      })

      const key = await computeCacheKey('article', 'm', 'sys', 'user')

      expect(key).toMatch(/^article\|m\|[0-9a-f]{8}$/)
    })
  })

  describe('getCached / setCached', () => {
    it('内存条目过期后删除并回落到 IndexedDB 未命中', async () => {
      const now = new Date('2026-10-26T12:00:00').getTime()
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
      await setCached('expire-key', { v: 1 }, 10, 's1')

      nowSpy.mockReturnValue(now + 20)

      expect(await getCached('expire-key')).toBeNull()
      expect(getSpy).toHaveBeenCalledWith('expire-key')
    })

    it('IndexedDB 读取失败时按未命中处理', async () => {
      getSpy.mockRejectedValueOnce(new Error('db down'))

      expect(await getCached('k1')).toBeNull()
    })

    it('IndexedDB 写入失败不影响内存缓存命中', async () => {
      putSpy.mockRejectedValueOnce(new Error('quota'))
      await setCached('mem-key', { ok: true }, Infinity, 's1')

      const hit = await getCached<{ ok: boolean }>('mem-key')

      expect(hit).toEqual({ value: { ok: true }, isMemory: true })
    })

    it('IndexedDB 过期条目删除失败仍返回未命中', async () => {
      getSpy.mockResolvedValueOnce(makeEntry({ expiresAt: 1 }))
      deleteSpy.mockRejectedValueOnce(new Error('delete failed'))

      expect(await getCached('k1')).toBeNull()
    })
  })

  describe('clearCache', () => {
    it('全量清理 IndexedDB 失败时仅告警', async () => {
      clearSpy.mockRejectedValueOnce(new Error('clear failed'))

      await expect(clearCache()).resolves.toBeUndefined()
    })

    it('按 scenario 清理 IndexedDB 命中键', async () => {
      whereSpy.mockReturnValueOnce(
        fakeCollection([
          makeEntry({ id: 'k1' }),
          makeEntry({ id: 'k2' }),
        ]) as ReturnType<typeof db.aiCache.where>,
      )

      await clearCache('s1')

      expect(bulkDeleteSpy).toHaveBeenCalledWith(['k1', 'k2'])
    })
  })

  describe('cleanupExpired', () => {
    it('查询失败时返回 0', async () => {
      toArraySpy.mockRejectedValueOnce(new Error('toArray failed'))

      expect(await cleanupExpired()).toBe(0)
    })

    it('清理过期条目并返回数量', async () => {
      toArraySpy.mockResolvedValueOnce([
        makeEntry({ id: 'expired', expiresAt: 1 }),
        makeEntry({ id: 'permanent', expiresAt: PERMANENT }),
      ])

      expect(await cleanupExpired()).toBe(1)
      expect(bulkDeleteSpy).toHaveBeenCalledWith(['expired'])
    })
  })

  describe('enforceScenarioLimit', () => {
    it('maxEntries <= 0 时直接返回 0 且不查询', async () => {
      expect(await enforceScenarioLimit('s1', 0)).toBe(0)
      expect(whereSpy).not.toHaveBeenCalled()
    })

    it('查询失败时返回 0', async () => {
      whereSpy.mockImplementationOnce(() => {
        throw new Error('where failed')
      })

      expect(await enforceScenarioLimit('s1', 2)).toBe(0)
    })

    it('超出上限时按 updatedAt 淘汰最旧条目', async () => {
      whereSpy.mockReturnValueOnce(
        fakeCollection([
          makeEntry({ id: 'old', updatedAt: 1 }),
          makeEntry({ id: 'mid', updatedAt: 2 }),
          makeEntry({ id: 'new', updatedAt: 3 }),
        ]) as ReturnType<typeof db.aiCache.where>,
      )

      expect(await enforceScenarioLimit('s1', 2)).toBe(1)
      expect(bulkDeleteSpy).toHaveBeenCalledWith(['old'])
    })
  })
})
