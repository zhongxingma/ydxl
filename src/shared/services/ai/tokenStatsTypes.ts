// AI Token 统计类型与定价表
//
// 集中定义记录/聚合/快照结构与 DeepSeek 官方定价，供 tokenStats.ts 与 UI 复用。

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
