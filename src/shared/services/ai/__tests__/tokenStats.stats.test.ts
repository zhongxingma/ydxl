// tokenStats 聚合与兼容性
//
// deepseekCacheHitRate、旧字段与旧 entries 向后兼容、getStats 跨 scenario 聚合与默认字段完整性。
// 由 tokenStats.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import { recordUsage, getStats, resetStats, PRICING } from '../tokenStats'

describe('tokenStats 聚合与兼容性', () => {
  // 每个测试前重置内存与 localStorage 状态，避免跨用例污染
  beforeEach(() => {
    resetStats()
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ydxl-ai-token-stats')
    }
  })
  // ---------- Phase 2: deepseekCacheHitRate 计算 ----------

  it('deepseekCacheHitRate 计算正确（hitTokens=80, missTokens=20 → 0.8）', () => {
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      },
      false
    )

    const stats = getStats()
    expect(stats.byScenario['article'].deepseekCacheHitRate).toBeCloseTo(0.8, 10)
  })

  it('deepseekCacheHitRate 在 hitTokens=0 与 missTokens=0 时返回 0（分母为 0 边界）', () => {
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        // 不传 prompt_cache_* 字段
      },
      false
    )

    const stats = getStats()
    expect(stats.byScenario['article'].deepseekCacheHitTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheMissTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheHitRate).toBe(0)
  })

  it('deepseekCacheHitRate 在 hitTokens=0 与 missTokens>0 时返回 0', () => {
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 100,
      },
      false
    )

    const stats = getStats()
    expect(stats.byScenario['article'].deepseekCacheHitRate).toBe(0)
  })

  it('deepseekCacheHitRate 在 hitTokens>0 与 missTokens=0 时返回 1（100% 命中）', () => {
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 100,
        prompt_cache_miss_tokens: 0,
      },
      false
    )

    const stats = getStats()
    expect(stats.byScenario['article'].deepseekCacheHitRate).toBe(1)
  })

  // ---------- Phase 2: 旧 entries 向后兼容 ----------

  it('旧 entries（无 prompt_cache_* 字段）从 localStorage 加载为 0 不报错', async () => {
    // 模拟旧 localStorage entries：仅有 cached_tokens 字段，无 prompt_cache_* 字段
    const oldEntry = {
      scenario: 'article',
      model: 'deepseek-v4-pro',
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 30, // 旧字段
      cacheHit: false,
      timestamp: Date.now(),
      source: 'api' as const,
    }
    localStorage.setItem(
      'ydxl-ai-token-stats',
      JSON.stringify({ entries: [oldEntry], updatedAt: new Date().toISOString() })
    )

    // resetStats 会清空 localStorage 并设置 loadedFromStorage=true，阻止后续 ensureLoaded
    // 因此使用 vi.resetModules + 动态 import 获取全新模块实例（loadedFromStorage=false）
    vi.resetModules()
    const { getStats: freshGetStats } = await import('../tokenStats')

    // 触发 ensureLoaded 从 localStorage 加载旧 entry
    const stats = freshGetStats()
    // 旧 entry 的 article scenario 应被加载，新字段按 0 处理
    expect(stats.byScenario['article']).toBeDefined()
    expect(stats.byScenario['article'].deepseekCacheHitTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheMissTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheHitRate).toBe(0)
    // 旧字段 cached 仍累加（保留兼容）
    expect(stats.byScenario['article'].cached).toBe(30)
  })

  it('recordUsage 不传 prompt_cache_* 字段时 deepseekCacheHitTokens / MissTokens 为 0', () => {
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 50 }, false)

    const stats = getStats()
    expect(stats.byScenario['article'].deepseekCacheHitTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheMissTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheHitRate).toBe(0)
  })

  // ---------- Phase 2: getStats total 聚合 ----------

  it('getStats total 应跨 scenario 聚合 deepseekCacheHitTokens / MissTokens / HitRate', () => {
    // scenario A: hit=80, miss=20
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      },
      false
    )
    // scenario B: hit=120, miss=80
    recordUsage(
      'questions',
      'deepseek-v4-pro',
      {
        prompt_tokens: 200,
        completion_tokens: 100,
        prompt_cache_hit_tokens: 120,
        prompt_cache_miss_tokens: 80,
      },
      false
    )

    const stats = getStats()
    // total 聚合：hit=200, miss=100, rate=200/300≈0.6667
    expect(stats.total.deepseekCacheHitTokens).toBe(200)
    expect(stats.total.deepseekCacheMissTokens).toBe(100)
    expect(stats.total.deepseekCacheHitRate).toBeCloseTo(0.6667, 3)
  })

  it('getStats total 在无任何 DeepSeek 缓存数据时返回 0', () => {
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 50 }, false)

    const stats = getStats()
    expect(stats.total.deepseekCacheHitTokens).toBe(0)
    expect(stats.total.deepseekCacheMissTokens).toBe(0)
    expect(stats.total.deepseekCacheHitRate).toBe(0)
  })

  // ---------- 旧字段 cached_tokens 向后兼容 ----------

  it('recordUsage 仍可接收 cached_tokens 字段（向后兼容，新代码忽略）', () => {
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        cached_tokens: 30, // 旧字段
      },
      false
    )

    const stats = getStats()
    expect(stats.byScenario['article'].cached).toBe(30)
    // 新 DeepSeek 缓存字段为 0（因未传 prompt_cache_*）
    expect(stats.byScenario['article'].deepseekCacheHitTokens).toBe(0)
    expect(stats.byScenario['article'].deepseekCacheMissTokens).toBe(0)
  })

  it('getStats total.cached 仍保留旧字段聚合（向后兼容）', () => {
    recordUsage(
      'article',
      'deepseek-v4-pro',
      { prompt_tokens: 100, completion_tokens: 50, cached_tokens: 30 },
      false
    )
    recordUsage(
      'questions',
      'deepseek-v4-pro',
      { prompt_tokens: 200, completion_tokens: 100, cached_tokens: 70 },
      false
    )

    const stats = getStats()
    expect(stats.total.cached).toBe(100) // 30 + 70
  })

  // ---------- ScenarioStats 默认字段完整性 ----------

  it('ScenarioStats 应包含所有 Phase 2 新增字段', () => {
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 50 }, false)

    const stats = getStats()
    const articleStats = stats.byScenario['article']
    expect(articleStats).toHaveProperty('deepseekCacheHitTokens')
    expect(articleStats).toHaveProperty('deepseekCacheMissTokens')
    expect(articleStats).toHaveProperty('deepseekCacheHitRate')
    expect(articleStats).toHaveProperty('cached') // 旧字段保留
  })

  it('TokenStatsSnapshot.total 应包含所有 Phase 2 新增字段', () => {
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 50 }, false)

    const stats = getStats()
    expect(stats.total).toHaveProperty('deepseekCacheHitTokens')
    expect(stats.total).toHaveProperty('deepseekCacheMissTokens')
    expect(stats.total).toHaveProperty('deepseekCacheHitRate')
    expect(stats.total).toHaveProperty('cached') // 旧字段保留
  })


  it('PRICING 常量应包含 v4-pro 与 v4-flash 三档定价', () => {
    expect(PRICING['deepseek-v4-pro']).toEqual({
      inputCacheHit: 0.025,
      inputCacheMiss: 3,
      output: 6,
    })
    expect(PRICING['deepseek-v4-flash']).toEqual({
      inputCacheHit: 0.02,
      inputCacheMiss: 1,
      output: 2,
    })
  })

})
