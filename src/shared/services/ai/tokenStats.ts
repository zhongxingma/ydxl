// AI Token 用量统计模块
//
// 设计目标：best-effort 记录每次 AI 调用的 token 消耗，支持按 scenario 聚合查看，
// 量化缓存命中与模型分级带来的成本节省。
//
// 存储：
// - 内存：Map<scenario, AggregatedStats>，进程内聚合
// - localStorage：key `ydxl-ai-token-stats`，结构 { entries: StatsEntry[]; updatedAt: string }
//   最多保留最近 1000 条 entries（FIFO 淘汰），用于跨会话统计
//
// 容错：localStorage 损坏（非 JSON / 缺字段）按空统计处理，不抛错；
// 监控失败不阻塞主流程（调用方应 try/catch）

// 单次记录条目
export interface StatsEntry {
  scenario: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  /**
   * 旧字段：DeepSeek 从不返回 cached_tokens，实际返回 prompt_cache_hit_tokens / prompt_cache_miss_tokens
   * 保留为可选以向后兼容旧 localStorage entries，新代码忽略该字段
   */
  cached_tokens?: number
  /**
   * DeepSeek 上下文硬盘缓存命中 token 数（按官方响应字段 prompt_cache_hit_tokens 记录）
   * 旧 entries 无此字段，按 0 处理
   * 文档参考：https://api-docs.deepseek.com/zh-cn/guides/kv_cache
   */
  prompt_cache_hit_tokens?: number
  /**
   * DeepSeek 上下文硬盘缓存未命中 token 数（按官方响应字段 prompt_cache_miss_tokens 记录）
   * 旧 entries 无此字段，按 0 处理
   */
  prompt_cache_miss_tokens?: number
  cacheHit: boolean
  timestamp: number
  /**
   * 调用来源：'api' | 'cache'
   * - api：通过 API 调用（计费）
   * - cache：缓存命中（不计费）
   * 历史数据无此字段视为 'api'（向后兼容）
   */
  source?: 'api' | 'cache'
}

// 聚合后的场景统计
export interface ScenarioStats {
  prompt: number
  completion: number
  /**
   * 新代码请使用 deepseekCacheHitTokens / deepseekCacheMissTokens
   */
  cached: number
  totalCalls: number
  cacheHits: number
  cacheHitRate: number
  /** API 调用次数（计费，缓存命中不计入） */
  apiCalls: number
  /** DeepSeek 上下文硬盘缓存命中 token 累计（按 prompt_cache_hit_tokens 聚合） */
  deepseekCacheHitTokens: number
  /** DeepSeek 上下文硬盘缓存未命中 token 累计（按 prompt_cache_miss_tokens 聚合） */
  deepseekCacheMissTokens: number
  /** DeepSeek 缓存命中率 = deepseekCacheHitTokens / (deepseekCacheHitTokens + deepseekCacheMissTokens)，分母为 0 时返回 0 */
  deepseekCacheHitRate: number
}

// Token 用量快照
export interface TokenStatsSnapshot {
  total: {
    prompt: number
    completion: number
    cached: number
    cacheHitRate: number
    /** DeepSeek 上下文硬盘缓存命中 token 累计 */
    deepseekCacheHitTokens: number
    /** DeepSeek 上下文硬盘缓存未命中 token 累计 */
    deepseekCacheMissTokens: number
    /** DeepSeek 缓存命中率（跨 scenario 聚合） */
    deepseekCacheHitRate: number
  }
  byScenario: Record<string, ScenarioStats>
}

// Token 用量结构（与 DeepSeek/OpenAI usage 字段一致）
// DeepSeek 官方响应含 prompt_cache_hit_tokens / prompt_cache_miss_tokens（非 cached_tokens）
// 文档参考：https://api-docs.deepseek.com/zh-cn/guides/kv_cache
export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  /**
   * 旧字段：DeepSeek 从不返回 cached_tokens，新代码忽略该字段
   * 保留为可选以兼容旧调用方与测试 mock
   */
  cached_tokens?: number
  /** DeepSeek 上下文硬盘缓存命中 token 数 */
  prompt_cache_hit_tokens?: number
  /** DeepSeek 上下文硬盘缓存未命中 token 数 */
  prompt_cache_miss_tokens?: number
}
// 存储 Key
const STORAGE_KEY = 'ydxl-ai-token-stats'
const BUDGET_STORAGE_KEY = 'ydxl-ai-budget-config'
const MAX_ENTRIES = 1000

/**
 * 预算配置
   */
export interface BudgetConfig {
  /** 月度预算上限（元） */
  monthlyBudgetYuan: number
  /** 预警阈值（0-1），例如 0.8 表示使用 80% 时预警 */
  alertThreshold: number
  /** 预算重置日期（ISO 字符串），用于计算本月用量 */
  lastResetDate: string
}

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  monthlyBudgetYuan: 10, // 默认 10 元
  alertThreshold: 0.8,
  lastResetDate: new Date().toISOString(),
}

/**
 * 获取当前的预算配置
   */
export function getBudgetConfig(): BudgetConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_BUDGET_CONFIG
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY)
    if (!raw) return DEFAULT_BUDGET_CONFIG
    return JSON.parse(raw) as BudgetConfig
  } catch {
    return DEFAULT_BUDGET_CONFIG
  }
}

/**
 * 更新预算配置
   */
export function updateBudgetConfig(config: Partial<BudgetConfig>): void {
  if (typeof localStorage === 'undefined') return
  const current = getBudgetConfig()
  const updated = { ...current, ...config }
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(updated))
}

export function checkQuotaStatus() {
  ensureLoaded()
  const config = getBudgetConfig()
  const { totalCostYuan } = getCostEstimation()
  
  const usageRate = totalCostYuan / config.monthlyBudgetYuan
  
  let status: 'ok' | 'warning' | 'exceeded' = 'ok'
  if (usageRate >= 1) status = 'exceeded'
  else if (usageRate >= config.alertThreshold) status = 'warning'
  
  return {
    status,
    usageRate,
    currentCost: totalCostYuan,
    budget: config.monthlyBudgetYuan,
  }
}

/**
 * 获取预算状态快照（供 UI 展示）
   */
export function getBudgetStatus() {
  const config = getBudgetConfig()
  const statusInfo = checkQuotaStatus()
  return {
    config,
    ...statusInfo,
  }
}

// DeepSeek 官方定价（单位：元/百万 tokens）
// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// v4-pro: 输入缓存命中 0.025 元、缓存未命中 3 元、输出 6 元
// v4-flash: 输入缓存命中 0.02 元、缓存未命中 1 元、输出 2 元
export const PRICING = {
  'deepseek-v4-pro': { inputCacheHit: 0.025, inputCacheMiss: 3, output: 6 },
  'deepseek-v4-flash': { inputCacheHit: 0.02, inputCacheMiss: 1, output: 2 },
} as const

// 单个场景的成本估算
export interface ScenarioCostEstimation {
  inputCostYuan: number
  outputCostYuan: number
  totalCostYuan: number
  savingsFromCacheHitYuan: number
}

// 全局成本估算快照
export interface CostEstimationSnapshot {
  totalCostYuan: number
  byScenario: Record<string, ScenarioCostEstimation>
}

// DeepSeek 缓存统计快照（跨 scenario 聚合）
export interface DeepSeekCacheStatsSnapshot {
  hitTokens: number
  missTokens: number
  hitRate: number
  estimatedSavingsYuan: number
}

// 内存聚合缓存：scenario -> 聚合统计
const memoryAggregation = new Map<string, ScenarioStats>()

// 场景级模型调用计数：scenario -> (model -> 调用次数)
// 用于成本估算时确定每个场景的"主要模型"（调用次数最多者），
// 跨供应商场景下（如 OpenAI/Qwen/自定义模型）按对应模型定价而非一律套用 DeepSeek 价格
const scenarioModelCounter = new Map<string, Map<string, number>>()

// 是否已从 localStorage 加载过历史 entries
let loadedFromStorage = false

/**
 * 从 localStorage 加载历史 entries 到内存聚合
 * 失败时返回空数组，不抛错
   */
function loadEntriesFromStorage(): StatsEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { entries?: unknown }
    if (!parsed || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter(isValidEntry) as StatsEntry[]
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[tokenStats] localStorage 加载失败，按空统计处理', err)
    return []
  }
}

/**
 * 校验 entry 是否有效
   */
function isValidEntry(entry: unknown): entry is StatsEntry {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.scenario === 'string' &&
    typeof e.model === 'string' &&
    typeof e.prompt_tokens === 'number' &&
    typeof e.completion_tokens === 'number' &&
    typeof e.cacheHit === 'boolean' &&
    typeof e.timestamp === 'number'
  )
}

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
 * 持久化 entries 到 localStorage
 * 失败时 console.warn，不抛错
   */
function persistEntries(entries: StatsEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload = JSON.stringify({
      entries: entries.slice(-MAX_ENTRIES),
      updatedAt: new Date().toISOString(),
    })
    localStorage.setItem(STORAGE_KEY, payload)
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[tokenStats] localStorage 写入失败', err)
  }
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
      console.warn('[tokenStats] 持久化失败', err)
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
      console.warn('[tokenStats] localStorage 清空失败', err)
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
 * 查询模型定价
 * 已知模型返回精确价格；未知模型（第三方/自定义）返回 undefined，
 * 由调用方决定回退策略（当前按 DeepSeek 最高价保守估算）
   */
export function getModelPricing(
  model: string
): { inputCacheHit: number; inputCacheMiss: number; output: number } | undefined {
  return PRICING[model as keyof typeof PRICING]
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
