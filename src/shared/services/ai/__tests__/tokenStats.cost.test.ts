// tokenStats 成本估算与模型定价
//
// getCostEstimation、getModelPricing、getDeepSeekCacheStats 与缓存节省金额。
// 由 tokenStats.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import { recordUsage, getCostEstimation, getDeepSeekCacheStats, getModelPricing, resetStats } from '../tokenStats'

describe('tokenStats 成本估算与模型定价', () => {
  // 每个测试前重置内存与 localStorage 状态，避免跨用例污染
  beforeEach(() => {
    resetStats()
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ydxl-ai-token-stats')
    }
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
