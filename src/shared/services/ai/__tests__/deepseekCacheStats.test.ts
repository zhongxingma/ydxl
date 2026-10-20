// DeepSeek 缓存统计集成测试（Task 8 / SubTask 8.1）
//
// 端到端验证 DeepSeek 上下文硬盘缓存（KV cache）统计在真实调用链路中的正确性
// 覆盖以下 4 个场景：
// 1. API 响应含 prompt_cache_hit_tokens / prompt_cache_miss_tokens 字段时，tokenStats 正确记录
// 2. 真实 DeepSeek 缓存命中与本地 responseCache 命中区分（不混淆统计）
// 3. getCostEstimation() 跨 scenario 聚合一致性 + 数学公式验证
// 4. 旧 localStorage entries（无 prompt_cache_* 字段）向后兼容，不报错且按 0 处理
//
// 运行方式：npx vitest run src/shared/services/ai/__tests__/deepseekCacheStats.test.ts
//
// 注：本文件为 Task 8 集成测试，依赖 Task 1（缓存字段修复）、Task 6（成本估算函数）已实现

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeepSeekProvider } from '../deepseekProvider'
import {
  installFetchMock,
  installFetchMockSequence,
  restoreFetch,
  type FetchCall,
} from '@/test/setup'
import { clearCache } from '../responseCache'
import {
  getStats,
  resetStats,
  getCostEstimation,
  getDeepSeekCacheStats,
  PRICING,
} from '../tokenStats'

// ---------- 测试用响应数据工厂 ----------

const ARTICLE_RESPONSE = {
  title: 'A Day at the Beach',
  content: 'Last Sunday, my family went to the beach. The sun was shining brightly...',
  translation: '上周日，我们一家去了海滩。阳光明媚地照耀着...',
  genre: 'narrative',
  wordCount: 250,
  topic: 'travel',
  difficulty: 'easy',
  lexileRange: { min: 600, max: 700 },
  highlightedWords: [
    { word: 'beach', phonetic: '/biːtʃ/', pos: 'n.', definition: '海滩', example: 'went to the beach' },
  ],
  phrases: [{ phrase: 'go to the beach', meaning: '去海滩', example: '', exampleTranslation: '' }],
}

const WORD_BREAKDOWN_RESPONSE = { phonics: ['ap', 'ple'], syllables: 2 }

// 构造带 usage 字段的 DeepSeek 响应
function makeUsageResponse(
  content: string,
  usage: {
    prompt_tokens: number
    completion_tokens: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
  }
) {
  return {
    json: {
      choices: [{ message: { content } }],
      usage,
    },
  }
}

// ---------- 测试隔离：每个用例前清空缓存与统计 ----------

beforeEach(() => {
  clearCache()
  resetStats()
  // 静默 baseProvider 中的 console.debug 请求/响应日志
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

// ---------- 集成测试 ----------

describe('DeepSeek 缓存统计集成测试（Task 8）', () => {
  // ===== 场景 1：API 响应含缓存命中字段时 tokenStats 正确记录 =====
  it('场景 1：API 响应含 prompt_cache_hit/miss_tokens 时，tokenStats.byScenario.article 正确记录', async () => {
    // mock fetch 返回含 DeepSeek 官方缓存字段的 usage
    const calls = installFetchMock(
      makeUsageResponse(JSON.stringify(ARTICLE_RESPONSE), {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      })
    )

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    await provider.generateArticle('2026-07-26')

    // 验证 fetch 被调用一次
    expect(calls.length).toBe(1)

    const stats = getStats()
    const articleStats = stats.byScenario['article']
    expect(articleStats).toBeDefined()
    // DeepSeek 缓存命中/未命中 token 数应正确记录
    expect(articleStats.deepseekCacheHitTokens).toBe(80)
    expect(articleStats.deepseekCacheMissTokens).toBe(20)
    // hitRate = 80 / (80 + 20) = 0.8
    expect(articleStats.deepseekCacheHitRate).toBeCloseTo(0.8, 10)
    // prompt/completion 也应正确记录
    expect(articleStats.prompt).toBe(100)
    expect(articleStats.completion).toBe(50)
  })

  // ===== 场景 2：真实 DeepSeek 缓存命中与本地 responseCache 命中区分 =====
  it('场景 2：本地 responseCache 命中不应膨胀 DeepSeek 缓存命中率，跨 scenario 聚合正确', async () => {
    // 第 1 步：generateWordBreakdown 第一次调用，发请求并记录 DeepSeek 缓存统计
    // 第 2 步：generateWordBreakdown 第二次调用同 word，命中本地 responseCache，不发请求
    //         此时本地缓存命中不应改变 DeepSeek 缓存统计
    // 第 3 步：generateArticle 调用，mock 返回不同 DeepSeek 缓存命中数据
    //         验证 getDeepSeekCacheStats() 跨 scenario 聚合正确

    const breakdownUsage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
    }
    const articleUsage = {
      prompt_tokens: 200,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 150,
      prompt_cache_miss_tokens: 50,
    }

    // 序列 mock：第 1 次 wordBreakdown，第 2 次 article（wordBreakdown 第 2 次命中本地缓存不发请求）
    const calls: FetchCall[] = installFetchMockSequence([
      makeUsageResponse(JSON.stringify(WORD_BREAKDOWN_RESPONSE), breakdownUsage),
      makeUsageResponse(JSON.stringify(ARTICLE_RESPONSE), articleUsage),
    ])

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })

    // 第 1 步：wordBreakdown 第一次（发请求，记录 DeepSeek 缓存统计）
    await provider.generateWordBreakdown('apple')
    expect(calls.length).toBe(1)

    // 第 2 步：wordBreakdown 第二次同 word（命中本地 responseCache，不发请求）
    await provider.generateWordBreakdown('apple')
    expect(calls.length).toBe(1) // 仍为 1，本地缓存命中

    // 验证 wordBreakdown 的 DeepSeek 缓存统计保持第 1 次的值，未被本地缓存命中膨胀
    const statsAfterCacheHit = getStats()
    const wbStats = statsAfterCacheHit.byScenario['wordBreakdown']
    expect(wbStats).toBeDefined()
    expect(wbStats.deepseekCacheHitTokens).toBe(80) // 仍为第 1 次的值
    expect(wbStats.deepseekCacheMissTokens).toBe(20)
    expect(wbStats.deepseekCacheHitRate).toBeCloseTo(0.8, 10)
    // totalCalls 应为 2（1 次 API + 1 次缓存命中），cacheHits 应为 1
    expect(wbStats.totalCalls).toBe(2)
    expect(wbStats.cacheHits).toBe(1)
    // 本地缓存命中率反映 responseCache 命中（1/2 = 0.5），与 DeepSeek 缓存命中率（0.8）不同
    expect(wbStats.cacheHitRate).toBeCloseTo(0.5, 10)

    // 第 3 步：generateArticle 调用（mock 返回不同的 DeepSeek 缓存命中数据）
    await provider.generateArticle('2026-07-26')
    expect(calls.length).toBe(2)

    // 验证跨 scenario 聚合：getDeepSeekCacheStats()
    const cacheStats = getDeepSeekCacheStats()
    // hitTokens = 80 (wordBreakdown) + 150 (article) = 230
    expect(cacheStats.hitTokens).toBe(230)
    // missTokens = 20 (wordBreakdown) + 50 (article) = 70
    expect(cacheStats.missTokens).toBe(70)
    // hitRate = 230 / 300 ≈ 0.7667
    expect(cacheStats.hitRate).toBeCloseTo(0.7667, 3)

    // 验证本地缓存命中（responseCache）未膨胀 DeepSeek 缓存命中率
    // wordBreakdown 的 DeepSeek 缓存命中率仍为 0.8（仅基于第 1 次的 API 响应）
    // 若本地缓存命中被错误计入，hitTokens 会是 160（80×2），missTokens 会是 40（20×2）
    const finalStats = getStats()
    expect(finalStats.byScenario['wordBreakdown'].deepseekCacheHitTokens).toBe(80)
    expect(finalStats.byScenario['wordBreakdown'].deepseekCacheMissTokens).toBe(20)
    expect(finalStats.byScenario['article'].deepseekCacheHitTokens).toBe(150)
    expect(finalStats.byScenario['article'].deepseekCacheMissTokens).toBe(50)
  })

  // ===== 场景 3：成本估算一致性 =====
  it('场景 3：getCostEstimation() 跨 scenario 聚合一致 + 数学公式验证', async () => {
    // 调用 generateArticle（v4-pro）+ generateWordBreakdown（v4-flash）各一次
    // mock 返回已知 usage，验证 getCostEstimation() 返回值与手算一致
    const articleUsage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
    }
    const breakdownUsage = {
      prompt_tokens: 200,
      completion_tokens: 80,
      prompt_cache_hit_tokens: 150,
      prompt_cache_miss_tokens: 50,
    }

    const calls: FetchCall[] = installFetchMockSequence([
      makeUsageResponse(JSON.stringify(ARTICLE_RESPONSE), articleUsage),
      makeUsageResponse(JSON.stringify(WORD_BREAKDOWN_RESPONSE), breakdownUsage),
    ])

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    await provider.generateArticle('2026-07-26')
    await provider.generateWordBreakdown('apple')

    expect(calls.length).toBe(2)

    const est = getCostEstimation()

    // --- article scenario 成本（按 v4-pro 保守估算） ---
    // PRICING['deepseek-v4-pro'] = { inputCacheHit: 0.025, inputCacheMiss: 3, output: 6 }
    const proPricing = PRICING['deepseek-v4-pro']
    const articleExpectedInput =
      (80 * proPricing.inputCacheHit + 20 * proPricing.inputCacheMiss) / 1_000_000
    const articleExpectedOutput = (50 * proPricing.output) / 1_000_000
    const articleExpectedTotal = articleExpectedInput + articleExpectedOutput
    const articleExpectedSavings =
      (80 * (proPricing.inputCacheMiss - proPricing.inputCacheHit)) / 1_000_000

    expect(est.byScenario['article']).toBeDefined()
    expect(est.byScenario['article'].inputCostYuan).toBeCloseTo(articleExpectedInput, 12)
    expect(est.byScenario['article'].outputCostYuan).toBeCloseTo(articleExpectedOutput, 12)
    expect(est.byScenario['article'].totalCostYuan).toBeCloseTo(articleExpectedTotal, 12)
    expect(est.byScenario['article'].savingsFromCacheHitYuan).toBeCloseTo(
      articleExpectedSavings,
      12
    )

    // --- wordBreakdown scenario 成本（多供应商改造：按主要模型 v4-flash 定价） ---
    // wordBreakdown 调用使用 deepseek-v4-flash（getFlashModel 降级），按 flash 价格计算
    const flashPricing = PRICING['deepseek-v4-flash']
    const wbExpectedInput =
      (150 * flashPricing.inputCacheHit + 50 * flashPricing.inputCacheMiss) / 1_000_000
    const wbExpectedOutput = (80 * flashPricing.output) / 1_000_000
    const wbExpectedTotal = wbExpectedInput + wbExpectedOutput
    const wbExpectedSavings =
      (150 * (flashPricing.inputCacheMiss - flashPricing.inputCacheHit)) / 1_000_000

    expect(est.byScenario['wordBreakdown']).toBeDefined()
    expect(est.byScenario['wordBreakdown'].inputCostYuan).toBeCloseTo(wbExpectedInput, 12)
    expect(est.byScenario['wordBreakdown'].outputCostYuan).toBeCloseTo(wbExpectedOutput, 12)
    expect(est.byScenario['wordBreakdown'].totalCostYuan).toBeCloseTo(wbExpectedTotal, 12)
    expect(est.byScenario['wordBreakdown'].savingsFromCacheHitYuan).toBeCloseTo(
      wbExpectedSavings,
      12
    )

    // --- 跨 scenario 聚合一致性：totalCostYuan === sum(byScenario[*].totalCostYuan) ---
    const sumByScenario =
      (est.byScenario['article']?.totalCostYuan ?? 0) +
      (est.byScenario['wordBreakdown']?.totalCostYuan ?? 0)
    expect(est.totalCostYuan).toBeCloseTo(sumByScenario, 12)

    // --- 有缓存命中时 savingsFromCacheHitYuan 应为正数 ---
    expect(est.byScenario['article'].savingsFromCacheHitYuan).toBeGreaterThan(0)
    expect(est.byScenario['wordBreakdown'].savingsFromCacheHitYuan).toBeGreaterThan(0)

    // --- 数学公式验证：inputCostYuan = (hitTokens × 单价 + missTokens × 单价) / 1e6 ---
    // article（v4-pro）: (80 * 0.025 + 20 * 3) / 1e6 = (2 + 60) / 1e6 = 6.2e-5
    expect(est.byScenario['article'].inputCostYuan).toBeCloseTo(6.2e-5, 12)
    // wordBreakdown（v4-flash）: (150 * 0.02 + 50 * 1) / 1e6 = (3 + 50) / 1e6 = 5.3e-5
    expect(est.byScenario['wordBreakdown'].inputCostYuan).toBeCloseTo(5.3e-5, 12)
  })

  // ===== 场景 4：旧 localStorage entries 向后兼容 =====
  it('场景 4：旧 localStorage entries（无 prompt_cache_* 字段）加载后按 0 处理不报错', async () => {
    // 模拟旧 localStorage entries：仅有 cached_tokens 字段，无 prompt_cache_* 字段
    const oldEntry = {
      scenario: 'article',
      model: 'deepseek-v4-pro',
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 30, // 旧字段（DeepSeek 从不返回，但旧代码写入）
      cacheHit: false,
      timestamp: Date.now(),
      source: 'api' as const,
      // 注意：不包含 prompt_cache_hit_tokens / prompt_cache_miss_tokens 字段
    }
    localStorage.setItem(
      'ydxl-ai-token-stats',
      JSON.stringify({ entries: [oldEntry], updatedAt: new Date().toISOString() })
    )

    // resetStats 会清空 localStorage 并设置 loadedFromStorage=true，阻止后续 ensureLoaded
    // 因此使用 vi.resetModules + 动态 import 获取全新模块实例（loadedFromStorage=false）
    vi.resetModules()
    const { getStats: freshGetStats, getCostEstimation: freshGetCostEstimation } = await import(
      '../tokenStats'
    )

    // 触发 ensureLoaded 从 localStorage 加载旧 entry，不应抛错
    let stats: ReturnType<typeof freshGetStats>
    expect(() => {
      stats = freshGetStats()
    }).not.toThrow()

    // 旧 entry 的 article scenario 应被加载，新字段按 0 处理
    expect(stats!.byScenario['article']).toBeDefined()
    expect(stats!.byScenario['article'].deepseekCacheHitTokens).toBe(0)
    expect(stats!.byScenario['article'].deepseekCacheMissTokens).toBe(0)
    expect(stats!.byScenario['article'].deepseekCacheHitRate).toBe(0)
    // 旧字段 cached 仍累加（保留兼容）
    expect(stats!.byScenario['article'].cached).toBe(30)
    // prompt/completion 应正确累加
    expect(stats!.byScenario['article'].prompt).toBe(100)
    expect(stats!.byScenario['article'].completion).toBe(50)

    // getCostEstimation() 也不应抛错，且成本计算正确（无缓存命中，按全 miss 计算）
    let est: ReturnType<typeof freshGetCostEstimation>
    expect(() => {
      est = freshGetCostEstimation()
    }).not.toThrow()

    // 旧 entry 无 prompt_cache_* 字段 → hitTokens=0, missTokens=0
    // inputCostYuan = (0 * 0.025 + 0 * 3) / 1e6 = 0
    // outputCostYuan = 50 * 6 / 1e6 = 3e-4
    // totalCostYuan = 0 + 3e-4 = 3e-4
    // savingsFromCacheHitYuan = 0 * (3 - 0.025) / 1e6 = 0
    expect(est!.byScenario['article']).toBeDefined()
    expect(est!.byScenario['article'].inputCostYuan).toBe(0)
    expect(est!.byScenario['article'].outputCostYuan).toBeCloseTo(3e-4, 12)
    expect(est!.byScenario['article'].totalCostYuan).toBeCloseTo(3e-4, 12)
    expect(est!.byScenario['article'].savingsFromCacheHitYuan).toBe(0)
  })
})
