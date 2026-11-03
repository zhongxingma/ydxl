// tokenStats 用量记录与累加
//
// recordUsage 的 prompt / completion 累加、缓存命中标记与 DeepSeek 缓存字段。
// 由 tokenStats.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import { recordUsage, getStats, resetStats, type TokenUsage } from '../tokenStats'

describe('tokenStats 用量记录与累加', () => {
  // 每个测试前重置内存与 localStorage 状态，避免跨用例污染
  beforeEach(() => {
    resetStats()
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

  // ---------- DeepSeek 缓存字段累加 ----------

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

})
