// AI Token 用量统计模块
//
// 设计目标：best-effort 记录每次 AI 调用的 token 消耗，支持按 scenario 聚合查看，
// 量化缓存命中与模型分级带来的成本节省。
//
// 存储：
// - 内存：Map<scenario, AggregatedStats>，进程内聚合
// - localStorage：key `ydxl-ai-token-stats`（见 tokenStatsStorage.ts），跨会话统计
//
// 容错：localStorage 损坏（非 JSON / 缺字段）按空统计处理，不抛错；
// 监控失败不阻塞主流程（调用方应 try/catch）
//
// 类型与定价见 tokenStatsTypes.ts；持久化读写见 tokenStatsStorage.ts。
import { logger } from '../../utils/logger'
import type {
  CostEstimationSnapshot,
  DeepSeekCacheStatsSnapshot,
  ScenarioCostEstimation,
  ScenarioStats,
  StatsEntry,
  TokenStatsSnapshot,
  TokenUsage,
} from './tokenStatsTypes'
import { getModelPricing, PRICING } from './tokenStatsTypes'
import { loadEntriesFromStorage, persistEntries, STORAGE_KEY } from './tokenStatsStorage'

export type {
  CostEstimationSnapshot,
  DeepSeekCacheStatsSnapshot,
  ScenarioCostEstimation,
  ScenarioStats,
  StatsEntry,
  TokenStatsSnapshot,
  TokenUsage,
} from './tokenStatsTypes'
export { getModelPricing, PRICING } from './tokenStatsTypes'

// 内存聚合缓存：scenario -> 聚合统计
const memoryAggregation = new Map<string, ScenarioStats>()

// 场景级模型调用计数：scenario -> (model -> 调用次数)
// 用于成本估算时确定每个场景的"主要模型"（调用次数最多者），
// 跨供应商场景下（如 OpenAI/Qwen/自定义模型）按对应模型定价而非一律套用 DeepSeek 价格
const scenarioModelCounter = new Map<string, Map<string, number>>()

// 是否已从 localStorage 加载过历史 entries
let loadedFromStorage = false

/**
 * 将单条 entry 累加到内存聚合
 */
function aggregateEntry(entry: StatsEntry): void {
  const existing = memoryAggregation.get(entry.scenario) ?? {
    prompt: 0,
    completion: 0,
    cached: 0,
    totalCalls: 0,
    cacheHits: 0,
    cacheHitRate: 0,
    apiCalls: 0,
    deepseekCacheHitTokens: 0,
    deepseekCacheMissTokens: 0,
    deepseekCacheHitRate: 0,
  }
  existing.prompt += entry.prompt_tokens
  existing.completion += entry.completion_tokens
  // 旧 cached_tokens 字段保留累加（始终为 0，因 DeepSeek 不返回该字段），不破坏现有引用
  existing.cached += entry.cached_tokens ?? 0
  // 累加 DeepSeek 官方缓存字段（旧 entries 无此字段按 0 处理）
  existing.deepseekCacheHitTokens += entry.prompt_cache_hit_tokens ?? 0
  existing.deepseekCacheMissTokens += entry.prompt_cache_miss_tokens ?? 0
  existing.deepseekCacheHitRate =
    existing.deepseekCacheHitTokens + existing.deepseekCacheMissTokens > 0
      ? existing.deepseekCacheHitTokens /
        (existing.deepseekCacheHitTokens + existing.deepseekCacheMissTokens)
      : 0
  existing.totalCalls += 1
  if (entry.cacheHit) existing.cacheHits += 1
  existing.cacheHitRate = existing.totalCalls > 0 ? existing.cacheHits / existing.totalCalls : 0

  // 缓存命中不计入 apiCalls（已在 cacheHits 中统计），也不累加 token（缓存命中 token 通常为 0）
  if (!entry.cacheHit) {
    existing.apiCalls += 1
  }

  memoryAggregation.set(entry.scenario, existing)

  // 记录场景级模型调用计数（成本估算按主要模型定价）
  let modelCounter = scenarioModelCounter.get(entry.scenario)
  if (!modelCounter) {
    modelCounter = new Map()
    scenarioModelCounter.set(entry.scenario, modelCounter)
  }
  modelCounter.set(entry.model, (modelCounter.get(entry.model) ?? 0) + 1)
}

/**
 * 确保从 localStorage 加载过历史数据（懒加载，仅第一次调用时执行）
 */
function ensureLoaded(): void {
  if (loadedFromStorage) return
  loadedFromStorage = true
  const entries = loadEntriesFromStorage()
  for (const entry of entries) {
    aggregateEntry(entry)
  }
}

/**
 * 记录一次 AI 调用的 token 用量
 * @param scenario 调用场景标识（如 'wordBreakdown' / 'translation'）
 * @param model 实际使用的模型名（如 'deepseek-v4-pro' / 'deepseek-v4-flash'）
 * @param usage token 用量结构
 * @param cacheHit 是否命中缓存（命中时 prompt_tokens / completion_tokens 通常为 0，source 自动置为 'cache'）
 * @param source 调用来源：'api'（默认）| 'cache'
 */
export function recordUsage(
  scenario: string,
  model: string,
  usage: TokenUsage,
  cacheHit: boolean,
  source?: 'api' | 'cache'
): void {
  ensureLoaded()
  // 缓存命中自动识别 source
  const effectiveSource: 'api' | 'cache' = cacheHit ? 'cache' : source ?? 'api'
  const entry: StatsEntry = {
    scenario,
    model,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    // 保留旧字段写入以兼容旧版读取代码（始终为 undefined，因新调用方不再传 cached_tokens）
    cached_tokens: usage.cached_tokens,
    // 记录 DeepSeek 官方缓存字段（新代码使用）
    prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens,
    prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens,
    cacheHit,
    timestamp: Date.now(),
    source: effectiveSource,
  }
  // 1. 累加到内存聚合
  aggregateEntry(entry)
  // 2. 持久化到 localStorage（追加到现有 entries，超出上限 FIFO 淘汰）
  try {
    const existing = loadEntriesFromStorage()
    existing.push(entry)
    persistEntries(existing)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[tokenStats] 持久化失败', err)
  }
}

/**
 * 获取当前统计快照
 * @returns 总计与按 scenario 聚合的统计
 */
export function getStats(): TokenStatsSnapshot {
  ensureLoaded()
  let totalPrompt = 0
  let totalCompletion = 0
  let totalCached = 0
  let totalCalls = 0
  let totalCacheHits = 0
  let totalDeepseekCacheHitTokens = 0
  let totalDeepseekCacheMissTokens = 0
  const byScenario: Record<string, ScenarioStats> = {}
  for (const [scenario, stats] of memoryAggregation.entries()) {
    byScenario[scenario] = { ...stats }
    totalPrompt += stats.prompt
    totalCompletion += stats.completion
    totalCached += stats.cached
    totalCalls += stats.totalCalls
    totalCacheHits += stats.cacheHits
    totalDeepseekCacheHitTokens += stats.deepseekCacheHitTokens
    totalDeepseekCacheMissTokens += stats.deepseekCacheMissTokens
  }
  const totalDeepseekCacheHitRate =
    totalDeepseekCacheHitTokens + totalDeepseekCacheMissTokens > 0
      ? totalDeepseekCacheHitTokens /
        (totalDeepseekCacheHitTokens + totalDeepseekCacheMissTokens)
      : 0
  return {
    total: {
      prompt: totalPrompt,
      completion: totalCompletion,
      cached: totalCached,
      cacheHitRate: totalCalls > 0 ? totalCacheHits / totalCalls : 0,
      deepseekCacheHitTokens: totalDeepseekCacheHitTokens,
      deepseekCacheMissTokens: totalDeepseekCacheMissTokens,
      deepseekCacheHitRate: totalDeepseekCacheHitRate,
    },
    byScenario,
  }
}

/**
 * 重置统计：清空内存与 localStorage
 * 主要用于测试隔离与手动重置
 */
export function resetStats(): void {
  memoryAggregation.clear()
  scenarioModelCounter.clear()
  loadedFromStorage = true
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[tokenStats] localStorage 清空失败', err)
  }
}

/**
 * 确定场景的主要模型（调用次数最多者）
 * 用于成本估算按实际使用的模型定价，而非一律套用 DeepSeek 价格
 */
function getDominantModel(scenario: string): string {
  const counter = scenarioModelCounter.get(scenario)
  if (!counter) return ''
  let dominant = ''
  let maxCount = 0
  for (const [model, count] of counter) {
    if (count > maxCount) {
      dominant = model
      maxCount = count
    }
  }
  return dominant
}

/**
 * 估算成本（多供应商定价支持）
 *
 * 计算公式（单位：元/百万 tokens）：
 * - inputCostYuan = (deepseekCacheHitTokens × pricing.inputCacheHit + deepseekCacheMissTokens × pricing.inputCacheMiss) / 1_000_000
 * - outputCostYuan = completion × pricing.output / 1_000_000
 * - savingsFromCacheHitYuan = deepseekCacheHitTokens × (pricing.inputCacheMiss - pricing.inputCacheHit) / 1_000_000
 *
 * 注意：单个 scenario 可能跨多个 model 调用，按调用次数最多的"主要模型"定价。
 * 已知模型使用 PRICING 表精确价格；未知模型（OpenAI/Qwen/自定义等未登记价格者）
 * 按 v4-pro 定价保守估算（最高价），避免低估实际支出。
 *
 * @returns 成本估算快照（总计 + 按 scenario 分组）
 */
export function getCostEstimation(): CostEstimationSnapshot {
  ensureLoaded()
  let totalCostYuan = 0
  const byScenario: Record<string, ScenarioCostEstimation> = {}
  for (const [scenario, stats] of memoryAggregation.entries()) {
    // 按主要模型查价；未登记价格的模型按 v4-pro 定价保守估算（最高价）
    const dominantModel = getDominantModel(scenario)
    const pricing = getModelPricing(dominantModel) ?? PRICING['deepseek-v4-pro']
    const inputCostYuan =
      (stats.deepseekCacheHitTokens * pricing.inputCacheHit +
        stats.deepseekCacheMissTokens * pricing.inputCacheMiss) /
      1_000_000
    const outputCostYuan = (stats.completion * pricing.output) / 1_000_000
    const totalScenarioCost = inputCostYuan + outputCostYuan
    const savingsFromCacheHitYuan =
      (stats.deepseekCacheHitTokens * (pricing.inputCacheMiss - pricing.inputCacheHit)) /
      1_000_000
    byScenario[scenario] = {
      inputCostYuan,
      outputCostYuan,
      totalCostYuan: totalScenarioCost,
      savingsFromCacheHitYuan,
    }
    totalCostYuan += totalScenarioCost
  }
  return { totalCostYuan, byScenario }
}

/**
 * 获取 DeepSeek 上下文硬盘缓存统计（跨 scenario 聚合）
 *
 * 与本地 responseCache 命中（`cacheHits` / `cacheHitRate`）不同，
 * 此处统计的是 DeepSeek 服务端的 KV cache 命中（按官方响应字段
 * `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 聚合）。
 *
 * 估算节省金额按 v4-pro 定价保守计算：
 *   saved = hitTokens × (inputCacheMiss - inputCacheHit) / 1_000_000
 *
 * @returns { hitTokens, missTokens, hitRate, estimatedSavingsYuan }
 */
export function getDeepSeekCacheStats(): DeepSeekCacheStatsSnapshot {
  ensureLoaded()
  let hitTokens = 0
  let missTokens = 0
  for (const stats of memoryAggregation.values()) {
    hitTokens += stats.deepseekCacheHitTokens
    missTokens += stats.deepseekCacheMissTokens
  }
  const total = hitTokens + missTokens
  const hitRate = total > 0 ? hitTokens / total : 0
  // 按 v4-pro 定价保守估算节省金额
  const pricing = PRICING['deepseek-v4-pro']
  const estimatedSavingsYuan =
    (hitTokens * (pricing.inputCacheMiss - pricing.inputCacheHit)) / 1_000_000
  return { hitTokens, missTokens, hitRate, estimatedSavingsYuan }
}
