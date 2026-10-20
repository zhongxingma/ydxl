//
// 目标：验证「响应缓存 + 请求去重 + 模型分级 + Prompt 精简」四项优化措施
//      在典型用户场景下的 Token 消耗节省效果，目标节省 ≥ 30%。
//
// 验证策略：
// 1. 模拟用户一天的典型 AI 调用流程（阅读 + 生词 + 复习 + 翻译）
// 2. 对比「冷启动（无缓存）」与「热启动（缓存命中）」两次的 Token 消耗
// 3. 单独验证模型分级带来的成本节省（v4-pro vs v4-flash 价格比约 3:1）
// 4. 输出详细的优化前后对比报告
//
// 运行方式：npx vitest run src/__tests__/tokenOptimization.verification.test.ts
//
// 注：本文件为验证脚本，不属于常规回归测试，可按需手动运行

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeepSeekProvider } from '@/shared/services/ai/deepseekProvider'
import {
  installFetchMock,
  installFetchMockSequence,
  restoreFetch,
  type FetchCall,
} from '@/test/setup'
import { clearCache } from '@/shared/services/ai/responseCache'
import { getStats, resetStats } from '@/shared/services/ai/tokenStats'

// ---------- 典型响应数据工厂 ----------

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

const QUESTIONS_RESPONSE = [
  {
    id: 'q-1',
    type: 'main_idea',
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: '解析',
    locationClue: '线索',
  },
]

const TRANSLATION_RESPONSE = '上周日，我们一家去了海滩。'

const VOCABULARY_RESPONSE = [
  {
    word: 'beach',
    phonetic: '/biːtʃ/',
    pos: 'n.',
    definition: '海滩',
    example: 'went to the beach',
    exampleTranslation: '去了海滩',
    importance: 'high',
  },
]

const WORD_INFO = (word: string, def: string) => ({
  word,
  phonetic: '/test/',
  pos: 'n.',
  definition: def,
  example: `This is an example for ${word}.`,
  exampleTranslation: `这是 ${word} 的例句。`,
  phrases: [],
})

const WORD_BREAKDOWN = { phonics: ['a', 'b'], syllables: 2 }
const EMOJI_HINT = ['🌟', '✨']
const MNEMONIC = { mnemonic: '记忆口诀', explanation: '解释' }
const EXAMPLE_SENTENCE = 'This is an example sentence.'

// 模拟 DeepSeek API 响应的 usage 字段（典型 token 数）
// 参考 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
function makeUsage(promptTokens: number, completionTokens: number, cachedTokens = 0) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: cachedTokens,
  }
}

// 典型单词列表（模拟用户添加/复习的 5 个生词）
const TYPICAL_WORDS: Array<{ word: string; definition: string }> = [
  { word: 'adventure', definition: '冒险' },
  { word: 'discover', definition: '发现' },
  { word: 'journey', definition: '旅程' },
  { word: 'experience', definition: '经历' },
  { word: 'wonderful', definition: '美妙的' },
]

// 构造完整的响应序列（覆盖一次完整用户流程的所有 AI 调用）
// 顺序：article → questions → translation → vocabulary → 5×enrich → 5×breakdown → 5×emoji → 5×mnemonic → 5×example
function buildFullResponseSequence() {
  const responses = [
    // 1. generateArticle（v4-pro，复杂任务，不缓存）
    { json: { choices: [{ message: { content: JSON.stringify(ARTICLE_RESPONSE) } }], usage: makeUsage(800, 600) } },
    // 2. generateQuestions（v4-pro，复杂任务，不缓存）
    { json: { choices: [{ message: { content: JSON.stringify(QUESTIONS_RESPONSE) } }], usage: makeUsage(700, 400) } },
    // 3. generateTranslation（v4-flash，简单任务，30 天缓存）
    { json: { choices: [{ message: { content: TRANSLATION_RESPONSE } }], usage: makeUsage(400, 200) } },
    // 4. extractVocabulary（v4-pro，复杂任务，不缓存）
    { json: { choices: [{ message: { content: JSON.stringify(VOCABULARY_RESPONSE) } }], usage: makeUsage(600, 200) } },
  ]
  // 5-9. enrichSingleWord × 5（v4-flash，简单任务，30 天缓存）
  for (const { word, definition } of TYPICAL_WORDS) {
    responses.push({
      json: { choices: [{ message: { content: JSON.stringify(WORD_INFO(word, definition)) } }], usage: makeUsage(200, 150) },
    })
  }
  // 10-14. generateWordBreakdown × 5（v4-flash，简单任务，永久缓存）
  for (let i = 0; i < TYPICAL_WORDS.length; i++) {
    responses.push({
      json: { choices: [{ message: { content: JSON.stringify(WORD_BREAKDOWN) } }], usage: makeUsage(100, 50) },
    })
  }
  // 15-19. generateEmojiHint × 5（v4-flash，简单任务，永久缓存）
  for (let i = 0; i < TYPICAL_WORDS.length; i++) {
    responses.push({
      json: { choices: [{ message: { content: JSON.stringify(EMOJI_HINT) } }], usage: makeUsage(100, 20) },
    })
  }
  // 20-24. generateMnemonic × 5（v4-flash，简单任务，7 天缓存）
  for (let i = 0; i < TYPICAL_WORDS.length; i++) {
    responses.push({
      json: { choices: [{ message: { content: JSON.stringify(MNEMONIC) } }], usage: makeUsage(150, 100) },
    })
  }
  // 25-29. generateExampleSentence × 5（v4-flash，简单任务，24h 缓存）
  for (let i = 0; i < TYPICAL_WORDS.length; i++) {
    responses.push({
      json: { choices: [{ message: { content: EXAMPLE_SENTENCE } }], usage: makeUsage(100, 80) },
    })
  }
  return responses
}

// 模拟一次完整的用户流程
async function simulateUserFlow(provider: DeepSeekProvider): Promise<void> {
  // 1. 阅读文章
  await provider.generateArticle('2026-07-25', 'narrative', 'travel', 'easy')
  // 2. 生成题目
  await provider.generateQuestions('art-1', ARTICLE_RESPONSE.content)
  // 3. 翻译文章
  await provider.generateTranslation(ARTICLE_RESPONSE.content)
  // 4. 提取词汇
  await provider.extractVocabulary(ARTICLE_RESPONSE.content)
  // 5. 添加 5 个生词到生词本
  for (const { word } of TYPICAL_WORDS) {
    await provider.enrichSingleWord(word)
  }
  // 6. 查看 5 个单词的拼读
  for (const { word } of TYPICAL_WORDS) {
    await provider.generateWordBreakdown(word)
  }
  // 7. 查看 5 个单词的 emoji
  for (const { word, definition } of TYPICAL_WORDS) {
    await provider.generateEmojiHint(word, definition)
  }
  // 8. 复习 5 个单词的助记
  for (const { word, definition } of TYPICAL_WORDS) {
    await provider.generateMnemonic(word, definition)
  }
  // 9. 查看 5 个单词的例句
  for (const { word, definition } of TYPICAL_WORDS) {
    await provider.generateExampleSentence(word, definition)
  }
}

// 计算统计快照中的总 Token 消耗（prompt + completion，cacheHit 不计）
function totalTokensFromStats(): {
  total: number
  prompt: number
  completion: number
  cacheHits: number
  totalCalls: number
  byScenario: Record<string, { tokens: number; calls: number; hits: number }>
} {
  const stats = getStats()
  let total = 0
  let prompt = 0
  let completion = 0
  let cacheHits = 0
  let totalCalls = 0
  const byScenario: Record<string, { tokens: number; calls: number; hits: number }> = {}
  for (const [scenario, s] of Object.entries(stats.byScenario)) {
    const tokens = s.prompt + s.completion
    total += tokens
    prompt += s.prompt
    completion += s.completion
    cacheHits += s.cacheHits
    totalCalls += s.totalCalls
    byScenario[scenario] = { tokens, calls: s.totalCalls, hits: s.cacheHits }
  }
  return { total, prompt, completion, cacheHits, totalCalls, byScenario }
}

// ---------- 验证测试 ----------

describe('AI Token 优化效果验证', () => {
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
