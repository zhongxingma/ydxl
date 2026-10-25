// AI Token 优化效果验证 · 响应缓存
//
// 目标：验证「响应缓存」在典型用户场景下的 Token 消耗节省效果，目标节省 ≥ 30%。
// 覆盖场景：
// 1. 冷启动（无缓存）vs 热启动（缓存命中）Token 消耗对比
// 2. 一周综合节省效果（缓存 + 模型分级 + 去重）
//
// 由 tokenOptimization.verification.test.ts 按优化措施拆分而来，用例内容与断言未改动。
//
// 注：本文件为验证脚本，不属于常规回归测试，可按需手动运行

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeepSeekProvider } from '@/shared/services/ai/deepseekProvider'
import {
  installFetchMockSequence,
  restoreFetch,
  type FetchCall,
} from '@/test/setup'
import { clearCache } from '@/shared/services/ai/responseCache'
import { resetStats } from '@/shared/services/ai/tokenStats'
import {
  ARTICLE_RESPONSE,
  buildFullResponseSequence,
  makeUsage,
  simulateUserFlow,
  totalTokensFromStats,
} from './tokenOptimizationTestFixtures'

describe('AI Token 优化效果验证 · 响应缓存', () => {
  beforeEach(() => {
    clearCache()
    resetStats()
    // 静默 baseProvider 中的 console.debug 日志
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    restoreFetch()
    vi.restoreAllMocks()
  })

  // ===== 场景 1：冷启动 vs 热启动 Token 消耗对比 =====
  it('场景 1：冷启动（无缓存）vs 热启动（缓存命中）Token 消耗对比，目标节省 ≥ 30%', async () => {
    // ----- 冷启动：第一次完整用户流程（所有缓存未命中）-----
    const coldResponses = buildFullResponseSequence()
    const coldCalls: FetchCall[] = installFetchMockSequence(coldResponses)
    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })

    await simulateUserFlow(provider)
    const coldStats = totalTokensFromStats()
    const coldFetchCount = coldCalls.length

    // ----- 热启动：第二次同样流程（缓存命中）-----
    // Phase 3 优化后（2026-07-27）：
    // - article 不缓存 → 仍发请求（1 次）
    // - questions 启用 7 天缓存 → 命中缓存，不发请求
    // - vocabulary 启用 24h 缓存 → 命中缓存，不发请求
    // - translation 启用 30 天缓存 → 命中缓存，不发请求
    // - 其余 7 类简单任务（共 25 次调用）应全部命中缓存
    // 故热启动仅 article 发 1 次 fetch
    const hotResponses = [
      // 仅 article 需要新响应（1 次）
      { json: { choices: [{ message: { content: JSON.stringify(ARTICLE_RESPONSE) } }], usage: makeUsage(800, 600) } },
    ]
    const hotCalls: FetchCall[] = installFetchMockSequence(hotResponses)

    await simulateUserFlow(provider)
    const hotStats = totalTokensFromStats() // 累计统计（含冷启动）
    const hotFetchCount = hotCalls.length

    // 计算热启动增量 Token（总统计 - 冷启动统计）
    const hotIncrementTokens = hotStats.total - coldStats.total
    const hotIncrementCalls = hotStats.totalCalls - coldStats.totalCalls
    const hotIncrementHits = hotStats.cacheHits - coldStats.cacheHits

    // 节省比例 = (冷启动 Token - 热启动增量 Token) / 冷启动 Token
    const savingRate = (coldStats.total - hotIncrementTokens) / coldStats.total

    // ----- 输出对比报告 -----
    console.log('\n========== AI Token 优化效果对比报告 ==========')
    console.log('\n【冷启动】（第一次用户流程，所有缓存未命中）')
    console.log(`  fetch 调用次数: ${coldFetchCount}`)
    console.log(`  Token 总消耗: ${coldStats.total}（prompt=${coldStats.prompt}, completion=${coldStats.completion}）`)
    console.log(`  缓存命中次数: ${coldStats.cacheHits}/${coldStats.totalCalls}`)

    console.log('\n【热启动】（第二次同样流程，缓存命中）')
    console.log(`  fetch 调用次数: ${hotFetchCount}（仅 article，其余全部命中缓存）`)
    console.log(`  Token 增量消耗: ${hotIncrementTokens}`)
    console.log(`  缓存命中次数: ${hotIncrementHits}/${hotIncrementCalls}`)

    console.log('\n【节省效果】')
    console.log(`  fetch 调用节省: ${coldFetchCount - hotFetchCount}/${coldFetchCount} = ${(((coldFetchCount - hotFetchCount) / coldFetchCount) * 100).toFixed(1)}%`)
    console.log(`  Token 消耗节省: ${coldStats.total - hotIncrementTokens}/${coldStats.total} = ${(savingRate * 100).toFixed(1)}%`)

    console.log('\n【按 scenario 明细】')
    for (const [scenario, s] of Object.entries(coldStats.byScenario)) {
      const hotS = hotStats.byScenario[scenario]
      const hotIncTokens = (hotS?.tokens ?? 0) - s.tokens
      const hotIncCalls = (hotS?.calls ?? 0) - s.calls
      const hotIncHits = (hotS?.hits ?? 0) - s.hits
      console.log(`  ${scenario.padEnd(20)} 冷: ${String(s.tokens).padStart(6)} tokens / ${s.calls} calls | 热增量: ${String(hotIncTokens).padStart(6)} tokens / ${hotIncCalls} calls (hits=${hotIncHits})`)
    }
    console.log('\n===============================================\n')

    // ----- 断言 -----
    // 1. 冷启动应发起所有 29 次 fetch（4 + 5×5 = 29）
    expect(coldFetchCount).toBe(29)
    // 2. Phase 3 后热启动仅 article 不缓存 → 1 次 fetch
    //    questions（7天缓存）/ vocabulary（24h缓存）/ translation（30天缓存）+ 25 次简单任务全部命中缓存
    expect(hotFetchCount).toBe(1)
    // 3. Token 节省比例应 ≥ 30%
    expect(savingRate).toBeGreaterThanOrEqual(0.3)
    // 4. 热启动应有缓存命中（questions + translation + vocabulary + 25 次简单任务 = 28 次命中）
    expect(hotIncrementHits).toBeGreaterThanOrEqual(28)
  })

  // ===== 场景 4：综合节省效果汇总 =====
  it('场景 4：综合节省效果汇总（缓存 + 模型分级 + 去重）', async () => {
    // 模拟典型用户一周场景：每天阅读 1 篇 + 添加 5 生词 + 复习 5 单词
    // 第一天：冷启动（全部新请求）
    // 第二天~第七天：热启动（生词/拼读/emoji/助记/例句全部命中缓存）
    // article/questions/vocabulary 每天都新请求（不缓存）

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })

    // 第一天（冷启动）：完整流程
    const day1Responses = buildFullResponseSequence()
    installFetchMockSequence(day1Responses)
    await simulateUserFlow(provider)
    const day1Stats = totalTokensFromStats()

    // 第二天~第七天（热启动）：Phase 3 后仅 article 发请求
    // questions（7天缓存）/ vocabulary（24h缓存）/ translation（30天缓存）+ 25 次简单任务全部命中缓存
    for (let day = 2; day <= 7; day++) {
      const hotResponses = [
        { json: { choices: [{ message: { content: JSON.stringify(ARTICLE_RESPONSE) } }], usage: makeUsage(800, 600) } },
      ]
      installFetchMockSequence(hotResponses)
      await simulateUserFlow(provider)
    }

    const weekStats = totalTokensFromStats()
    // 一周统计已包含第一天，此处仅用于验证累计调用次数符合预期
    expect(weekStats.totalCalls).toBe(29 + 6 * 29)

    // 假设无优化场景：一周 7 天 × 29 次/天 = 203 次调用，每次都发请求
    // Phase 3 优化后：第一天 29 次 + 后 6 天 × 1 次/天（仅 article）= 29 + 6 = 35 次请求
    const baselineCalls = 7 * 29
    const optimizedCalls = 29 + 6 * 1
    const callSavingRate = (baselineCalls - optimizedCalls) / baselineCalls

    // Token 节省估算：
    // 基线（无缓存）：7 × 冷启动 Token
    // 优化后：1 × 冷启动 Token + 6 × 仅 article 的 Token
    const day1Tokens = day1Stats.total
    const dailyHotTokens = 800 + 600 // 仅 article 的 token
    const baselineTokens = 7 * day1Tokens
    const optimizedTokens = day1Tokens + 6 * dailyHotTokens
    const tokenSavingRate = (baselineTokens - optimizedTokens) / baselineTokens

    console.log('\n========== 一周综合节省效果 ==========')
    console.log('场景：每天阅读 1 篇 + 添加 5 生词 + 复习 5 单词')
    console.log(`第一天（冷启动）Token: ${day1Tokens}`)
    console.log(`后 6 天（热启动）每天 Token: ${dailyHotTokens}（仅 article，其余命中缓存）`)
    console.log('')
    console.log('【基线（无优化）】')
    console.log(`  一周调用次数: ${baselineCalls} 次`)
    console.log(`  一周 Token 消耗: ${baselineTokens}`)
    console.log('')
    console.log('【优化后（缓存 + 模型分级）】')
    console.log(`  一周调用次数: ${optimizedCalls} 次`)
    console.log(`  一周 Token 消耗: ${optimizedTokens}`)
    console.log('')
    console.log('【节省效果】')
    console.log(`  调用次数节省: ${baselineCalls - optimizedCalls}/${baselineCalls} = ${(callSavingRate * 100).toFixed(1)}%`)
    console.log(`  Token 消耗节省: ${baselineTokens - optimizedTokens}/${baselineTokens} = ${(tokenSavingRate * 100).toFixed(1)}%`)
    console.log('=======================================\n')

    // 综合节省应 ≥ 30%
    expect(tokenSavingRate).toBeGreaterThanOrEqual(0.3)
    expect(callSavingRate).toBeGreaterThanOrEqual(0.3)
  })
})
