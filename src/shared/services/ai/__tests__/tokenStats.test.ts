// Token 统计模块单元测试
//
// 测试覆盖：
// - recordUsage：基础记录、prompt/completion 累加
// - Phase 2 新增：DeepSeek 上下文硬盘缓存字段（prompt_cache_hit_tokens / prompt_cache_miss_tokens）累加
// - 旧 entries 向后兼容：无 prompt_cache_* 字段时按 0 处理不报错
// - deepseekCacheHitRate 计算正确性（含分母为 0 的边界场景）
// - getStats 跨 scenario 聚合 total.deepseekCacheHitTokens / deepseekCacheMissTokens / deepseekCacheHitRate
// - 旧字段 cached_tokens 向后兼容（保留为 0，不破坏现有引用）
// - Phase 2 Task 6：getCostEstimation / getDeepSeekCacheStats 成本估算与缓存聚合
//
// 已迁移到 vitest 风格（globals 模式）

import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordUsage,
  getStats,
  resetStats,
  getCostEstimation,
  getDeepSeekCacheStats,
  getModelPricing,
  PRICING,
  type TokenUsage,
} from '../tokenStats'

describe('tokenStats', () => {
  // 每个测试前重置内存与 localStorage 状态，避免跨用例污染
  beforeEach(() => {
    resetStats()
    // 清空 localStorage 中的 stats 数据
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ydxl-ai-token-stats')
    }
  })

  // ---------- 基础记录与累加 ----------

  it('recordUsage 应正确累加 prompt_tokens 与 completion_tokens', () => {
    const usage: TokenUsage = { prompt_tokens: 100, completion_tokens: 50 }
    recordUsage('article', 'deepseek-v4-pro', usage, false)

    const stats = getStats()
    expect(stats.byScenario['article']).toBeDefined()
    expect(stats.byScenario['article'].prompt).toBe(100)
    expect(stats.byScenario['article'].completion).toBe(50)
    expect(stats.byScenario['article'].totalCalls).toBe(1)
    expect(stats.byScenario['article'].apiCalls).toBe(1)
    expect(stats.byScenario['article'].cacheHits).toBe(0)
  })

  it('recordUsage 多次调用同 scenario 应正确累加', () => {
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 50 }, false)
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 200, completion_tokens: 80 }, false)

    const stats = getStats()
    expect(stats.byScenario['article'].prompt).toBe(300)
    expect(stats.byScenario['article'].completion).toBe(130)
    expect(stats.byScenario['article'].totalCalls).toBe(2)
  })

  it('recordUsage cacheHit=true 应记录缓存命中且不计 apiCalls', () => {
    recordUsage('translation', 'deepseek-v4-flash', { prompt_tokens: 0, completion_tokens: 0 }, true)

    const stats = getStats()
    expect(stats.byScenario['translation'].cacheHits).toBe(1)
    expect(stats.byScenario['translation'].totalCalls).toBe(1)
    expect(stats.byScenario['translation'].apiCalls).toBe(0)
    expect(stats.byScenario['translation'].cacheHitRate).toBe(1)
  })

  // ---------- Phase 2: DeepSeek 缓存字段累加 ----------

  it('recordUsage 应正确累加 prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
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
    const articleStats = stats.byScenario['article']
    expect(articleStats.deepseekCacheHitTokens).toBe(80)
    expect(articleStats.deepseekCacheMissTokens).toBe(20)
  })

  it('recordUsage 多次调用应累加 DeepSeek 缓存字段', () => {
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
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 200,
        completion_tokens: 80,
        prompt_cache_hit_tokens: 150,
        prompt_cache_miss_tokens: 50,
      },
      false
    )

    const stats = getStats()
    const articleStats = stats.byScenario['article']
    expect(articleStats.deepseekCacheHitTokens).toBe(230) // 80 + 150
    expect(articleStats.deepseekCacheMissTokens).toBe(70) // 20 + 50
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
    // 旧 cached 字段保留累加（保留兼容，Task 6 移除）
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

  // ---------- Phase 2 Task 6: getCostEstimation ----------

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

  it('getCostEstimation 在 v4-pro + hitTokens=80/missTokens=20/completion=50 场景下返回值与手算一致', () => {
    // 输入：hitTokens=80, missTokens=20, completion=50
    // 按 v4-pro 定价（inputCacheHit=0.025, inputCacheMiss=3, output=6，单位：元/百万 tokens）
    // inputCostYuan = (80×0.025 + 20×3) / 1e6 = (2 + 60) / 1e6 = 62 / 1e6 = 6.2e-5
    // outputCostYuan = 50×6 / 1e6 = 300 / 1e6 = 3e-4
    // totalCostYuan = 6.2e-5 + 3e-4 = 3.62e-4
    // savingsFromCacheHitYuan = 80×(3 - 0.025) / 1e6 = 80×2.975 / 1e6 = 238 / 1e6 = 2.38e-4
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

    const est = getCostEstimation()
    const article = est.byScenario['article']
    expect(article).toBeDefined()
    // inputCostYuan = (80×0.025 + 20×3) / 1e6 = 6.2e-5
    expect(article.inputCostYuan).toBeCloseTo(6.2e-5, 10)
    // outputCostYuan = 50×6 / 1e6 = 3e-4
    expect(article.outputCostYuan).toBeCloseTo(3e-4, 10)
    // totalCostYuan = 6.2e-5 + 3e-4 = 3.62e-4
    expect(article.totalCostYuan).toBeCloseTo(3.62e-4, 10)
    // savingsFromCacheHitYuan = 80×(3 - 0.025) / 1e6 = 2.38e-4
    expect(article.savingsFromCacheHitYuan).toBeCloseTo(2.38e-4, 10)
    // totalCostYuan 应等于 inputCostYuan + outputCostYuan
    expect(article.totalCostYuan).toBeCloseTo(
      article.inputCostYuan + article.outputCostYuan,
      12
    )
  })

  it('getCostEstimation totalCostYuan 等于各 scenario totalCostYuan 之和', () => {
    // scenario A: hit=80, miss=20, completion=50
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
    // scenario B: hit=120, miss=80, completion=200
    recordUsage(
      'questions',
      'deepseek-v4-pro',
      {
        prompt_tokens: 300,
        completion_tokens: 200,
        prompt_cache_hit_tokens: 120,
        prompt_cache_miss_tokens: 80,
      },
      false
    )

    const est = getCostEstimation()
    const sumByScenario =
      (est.byScenario['article']?.totalCostYuan ?? 0) +
      (est.byScenario['questions']?.totalCostYuan ?? 0)
    expect(est.totalCostYuan).toBeCloseTo(sumByScenario, 12)
  })

  it('getCostEstimation 在无任何 stats 时返回全零', () => {
    const est = getCostEstimation()
    expect(est.totalCostYuan).toBe(0)
    expect(est.byScenario).toEqual({})
  })

  it('getCostEstimation 按场景主要模型定价（scenario 唯一模型为 v4-flash 时按 flash 价格）', () => {
    // 多供应商改造：不再一律套用 v4-pro 价格，按调用次数最多的"主要模型"定价
    recordUsage(
      'translation',
      'deepseek-v4-flash',
      {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      },
      false
    )

    const est = getCostEstimation()
    const translation = est.byScenario['translation']
    // 按 v4-flash 估算：inputCostYuan = (80×0.02 + 20×1) / 1e6 = 2.16e-5
    // （旧行为按 v4-pro 保守估算为 6.2e-5，已废弃）
    expect(translation.inputCostYuan).toBeCloseTo(2.16e-5, 10)
    expect(translation.outputCostYuan).toBeCloseTo(1e-4, 10) // 50×2 / 1e6
  })

  it('getCostEstimation scenario 跨 model 时按调用次数最多的主要模型定价', () => {
    // 同一 scenario 内 v4-flash 调用 3 次、v4-pro 调用 1 次 → 主要模型为 v4-flash
    for (let i = 0; i < 3; i++) {
      recordUsage(
        'translation',
        'deepseek-v4-flash',
        { prompt_tokens: 100, completion_tokens: 50 },
        false
      )
    }
    recordUsage(
      'translation',
      'deepseek-v4-pro',
      { prompt_tokens: 100, completion_tokens: 50 },
      false
    )

    const est = getCostEstimation()
    const translation = est.byScenario['translation']
    // 按 v4-flash 定价：outputCostYuan = 200×2 / 1e6 = 4e-4
    // （若按 v4-pro 则为 1.2e-3）
    expect(translation.outputCostYuan).toBeCloseTo(4e-4, 10)
  })

  it('getCostEstimation 未知模型（第三方/自定义）按 v4-pro 定价保守估算', () => {
    // OpenAI/Qwen/自定义模型未登记价格，按最高价保守估算避免低估支出
    recordUsage(
      'article',
      'gpt-5.2-mini',
      { prompt_tokens: 1000, completion_tokens: 500 },
      false
    )

    const est = getCostEstimation()
    const article = est.byScenario['article']
    // 按 v4-pro 估算：outputCostYuan = 500×6 / 1e6 = 3e-3
    expect(article.outputCostYuan).toBeCloseTo(3e-3, 10)
  })

  it('getModelPricing 已知模型返回定价，未知模型返回 undefined', () => {
    expect(getModelPricing('deepseek-v4-pro')).toEqual({
      inputCacheHit: 0.025,
      inputCacheMiss: 3,
      output: 6,
    })
    expect(getModelPricing('deepseek-v4-flash')).toBeDefined()
    expect(getModelPricing('gpt-5.2-mini')).toBeUndefined()
    expect(getModelPricing('')).toBeUndefined()
  })

  // ---------- Phase 2 Task 6: getDeepSeekCacheStats ----------

  it('getDeepSeekCacheStats 跨 scenario 聚合 hitTokens / missTokens / hitRate 正确', () => {
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

    const cacheStats = getDeepSeekCacheStats()
    // 总 hit=200, miss=100
    expect(cacheStats.hitTokens).toBe(200)
    expect(cacheStats.missTokens).toBe(100)
    // hitRate = 200 / 300 ≈ 0.6667
    expect(cacheStats.hitRate).toBeCloseTo(0.6667, 3)
    // estimatedSavingsYuan = 200 × (3 - 0.025) / 1e6 = 200 × 2.975 / 1e6 = 595 / 1e6 = 5.95e-4
    expect(cacheStats.estimatedSavingsYuan).toBeCloseTo(5.95e-4, 10)
  })

  it('getDeepSeekCacheStats 在无缓存数据时返回全零', () => {
    recordUsage('article', 'deepseek-v4-pro', { prompt_tokens: 100, completion_tokens: 50 }, false)

    const cacheStats = getDeepSeekCacheStats()
    expect(cacheStats.hitTokens).toBe(0)
    expect(cacheStats.missTokens).toBe(0)
    expect(cacheStats.hitRate).toBe(0)
    expect(cacheStats.estimatedSavingsYuan).toBe(0)
  })

  it('getDeepSeekCacheStats 在无任何 stats 时返回全零', () => {
    const cacheStats = getDeepSeekCacheStats()
    expect(cacheStats.hitTokens).toBe(0)
    expect(cacheStats.missTokens).toBe(0)
    expect(cacheStats.hitRate).toBe(0)
    expect(cacheStats.estimatedSavingsYuan).toBe(0)
  })

  it('getDeepSeekCacheStats.estimatedSavingsYuan 与 getCostEstimation 的 savingsFromCacheHitYuan 之和一致', () => {
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

    const cacheStats = getDeepSeekCacheStats()
    const est = getCostEstimation()
    const sumSavings =
      (est.byScenario['article']?.savingsFromCacheHitYuan ?? 0) +
      (est.byScenario['questions']?.savingsFromCacheHitYuan ?? 0)
    expect(cacheStats.estimatedSavingsYuan).toBeCloseTo(sumSavings, 12)
  })
})
