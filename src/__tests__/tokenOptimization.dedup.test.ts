// AI Token 优化效果验证 · 并发请求去重
//
// 目标：验证相同请求并发调用时的 inflight 去重效果。
//
// 由 tokenOptimization.verification.test.ts 按优化措施拆分而来，用例内容与断言未改动。
//
// 注：本文件为验证脚本，不属于常规回归测试，可按需手动运行

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeepSeekProvider } from '@/shared/services/ai/deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'
import { clearCache } from '@/shared/services/ai/responseCache'
import { resetStats } from '@/shared/services/ai/tokenStats'
import { WORD_BREAKDOWN, makeUsage } from './tokenOptimizationTestFixtures'

describe('AI Token 优化效果验证 · 并发去重', () => {
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

  // ===== 场景 3：并发请求去重验证 =====
  it('场景 3：并发 5 次同 word 调用，仅发 1 次 fetch（inflight 去重）', async () => {
    const calls = installFetchMock({
      json: {
        choices: [{ message: { content: JSON.stringify(WORD_BREAKDOWN) } }],
        usage: makeUsage(100, 50),
      },
    })

    const provider = new DeepSeekProvider({ apiKey: 'sk-test' })
    // 并发 5 次同 word
    const results = await Promise.all([
      provider.generateWordBreakdown('adventure'),
      provider.generateWordBreakdown('adventure'),
      provider.generateWordBreakdown('adventure'),
      provider.generateWordBreakdown('adventure'),
      provider.generateWordBreakdown('adventure'),
    ])

    // 所有结果应相同
    for (const r of results) {
      expect(r.syllables).toBe(2)
    }
    // inflight 去重：应只发 1 次 fetch
    expect(calls.length).toBe(1)

    console.log('\n========== 并发请求去重验证 ==========')
    console.log(`并发调用次数: 5（同 word='adventure'）`)
    console.log(`实际 fetch 次数: ${calls.length}（inflight 去重生效）`)
    console.log(`节省 fetch: 4 次（80%）`)
    console.log('=======================================\n')
  })
})
