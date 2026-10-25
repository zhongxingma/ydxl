// AI Token 优化验证测试共用的数据工厂与流程模拟
//
// 由 tokenOptimization.verification.test.ts 拆分时抽取，
// 供响应缓存 / 模型分级 / 并发去重三个验证文件共用。

import type { DeepSeekProvider } from '@/shared/services/ai/deepseekProvider'
import { getStats } from '@/shared/services/ai/tokenStats'

// ---------- 典型响应数据工厂 ----------

export const ARTICLE_RESPONSE = {
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

export const QUESTIONS_RESPONSE = [
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

export const TRANSLATION_RESPONSE = '上周日，我们一家去了海滩。'

export const VOCABULARY_RESPONSE = [
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

export const WORD_INFO = (word: string, def: string) => ({
  word,
  phonetic: '/test/',
  pos: 'n.',
  definition: def,
  example: `This is an example for ${word}.`,
  exampleTranslation: `这是 ${word} 的例句。`,
  phrases: [],
})

export const WORD_BREAKDOWN = { phonics: ['a', 'b'], syllables: 2 }
export const EMOJI_HINT = ['🌟', '✨']
export const MNEMONIC = { mnemonic: '记忆口诀', explanation: '解释' }
export const EXAMPLE_SENTENCE = 'This is an example sentence.'

// 模拟 DeepSeek API 响应的 usage 字段（典型 token 数）
// 参考 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
export function makeUsage(promptTokens: number, completionTokens: number, cachedTokens = 0) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: cachedTokens,
  }
}

// 典型单词列表（模拟用户添加/复习的 5 个生词）
export const TYPICAL_WORDS: Array<{ word: string; definition: string }> = [
  { word: 'adventure', definition: '冒险' },
  { word: 'discover', definition: '发现' },
  { word: 'journey', definition: '旅程' },
  { word: 'experience', definition: '经历' },
  { word: 'wonderful', definition: '美妙的' },
]

// 构造完整的响应序列（覆盖一次完整用户流程的所有 AI 调用）
// 顺序：article → questions → translation → vocabulary → 5×enrich → 5×breakdown → 5×emoji → 5×mnemonic → 5×example
export function buildFullResponseSequence() {
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
export async function simulateUserFlow(provider: DeepSeekProvider): Promise<void> {
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
export function totalTokensFromStats(): {
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
