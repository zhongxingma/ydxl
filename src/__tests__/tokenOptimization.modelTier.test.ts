// AI Token 优化效果验证 · 模型分级
//
// 目标：验证「模型分级（v4-pro vs v4-flash，价格比约 3:1）」带来的成本节省。
//
// 由 tokenOptimization.verification.test.ts 按优化措施拆分而来，用例内容与断言未改动。
//
// 注：本文件为验证脚本，不属于常规回归测试，可按需手动运行

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeepSeekProvider } from '@/shared/services/ai/deepseekProvider'
import { installFetchMockSequence, restoreFetch, type FetchCall } from '@/test/setup'
import { clearCache } from '@/shared/services/ai/responseCache'
import { getStats, resetStats } from '@/shared/services/ai/tokenStats'
import { TYPICAL_WORDS, WORD_BREAKDOWN, makeUsage } from './tokenOptimizationTestFixtures'

describe('AI Token 优化效果验证 · 模型分级', () => {
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

  // ===== 场景 2：模型分级成本节省验证 =====
  it('场景 2：模型分级（v4-pro → v4-flash）成本节省验证', async () => {
    // DeepSeek 定价参考（https://api-docs.deepseek.com/zh-cn/quick_start/pricing）
    // v4-pro: 输入 2 元/百万 tokens，输出 8 元/百万 tokens
    // v4-flash: 输入 0.5 元/百万 tokens，输出 2 元/百万 tokens
    // 即 v4-flash 成本约为 v4-pro 的 1/4（输入）~ 1/4（输出）
    const PRO_INPUT_RATE = 2 // 元/百万 tokens
    const PRO_OUTPUT_RATE = 8
    const FLASH_INPUT_RATE = 0.5
    const FLASH_OUTPUT_RATE = 2

    // 模拟简单任务调用（使用 v4-flash）
    const responses = TYPICAL_WORDS.map(() => ({
      json: {
        choices: [{ message: { content: JSON.stringify(WORD_BREAKDOWN) } }],
        usage: makeUsage(100, 50),
      },
    }))
    const calls: FetchCall[] = installFetchMockSequence(responses)

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    for (const { word } of TYPICAL_WORDS) {
      await provider.generateWordBreakdown(word)
    }

    // 验证所有调用都使用 v4-flash
    for (const call of calls) {
      const body = JSON.parse(call.body) as { model: string }
      expect(body.model).toBe('deepseek-v4-flash')
    }

    // 计算成本对比
    const stats = getStats()
    const wbStats = stats.byScenario['wordBreakdown']
    expect(wbStats).toBeDefined()

    const totalInput = wbStats.prompt
    const totalOutput = wbStats.completion

    // 优化后成本（v4-flash）
    const optimizedCost =
      (totalInput * FLASH_INPUT_RATE + totalOutput * FLASH_OUTPUT_RATE) / 1_000_000
    // 优化前成本（v4-pro，假设同样 token 数）
    const baselineCost =
      (totalInput * PRO_INPUT_RATE + totalOutput * PRO_OUTPUT_RATE) / 1_000_000

    const costSavingRate = (baselineCost - optimizedCost) / baselineCost

    console.log('\n========== 模型分级成本节省验证 ==========')
    console.log(`调用次数: ${calls.length}（generateWordBreakdown × ${TYPICAL_WORDS.length}）`)
    console.log(`实际模型: deepseek-v4-flash`)
    console.log(`总输入 tokens: ${totalInput}`)
    console.log(`总输出 tokens: ${totalOutput}`)
    console.log(`优化前成本（v4-pro）: ¥${baselineCost.toFixed(6)}`)
    console.log(`优化后成本（v4-flash）: ¥${optimizedCost.toFixed(6)}`)
    console.log(`成本节省: ${((1 - optimizedCost / baselineCost) * 100).toFixed(1)}%`)
    console.log('===========================================\n')

    // v4-flash 成本应约为 v4-pro 的 1/4
    expect(costSavingRate).toBeGreaterThanOrEqual(0.7) // 至少节省 70%
    expect(optimizedCost).toBeLessThan(baselineCost * 0.3)
  })
})
