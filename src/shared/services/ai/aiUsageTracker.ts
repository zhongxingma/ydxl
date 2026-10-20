// AI 调用来源追踪器
//
// 记录各业务场景（questions / vocabulary / articlePhrases / wordHint 等）最近一次
// AI 调用实际使用的供应商与模型，供前端模块展示「本模块来自哪个 AI 接口」。
//
// 记录点位于 BaseAIProvider.callChat / callChatStream 的成败路径：
// 谁真正发出并完成了请求就记录谁——因此「自定义 API 失败自动切换 DeepSeek 兜底」时，
// 展示的是实际提供结果的 DeepSeek，而非配置的首选自定义 API。
//
// 数据持久化到 localStorage（key: ydxl-ai-usage），页面刷新后仍可展示；
// 存储不可用/损坏时按空记录处理，不影响主流程。
import type { AIProviderName } from './types'

export interface AIUsageRecord {
  /** 实际服务的供应商名称 */
  provider: AIProviderName
  /** 实际调用的平台标签（如 'DeepSeek' / 'SiliconFlow' / 'OpenRouter'）
   *  custom 供应商接入任意聚合平台，只看 provider 无法判断真实平台；
   *  由 baseProvider 的 usagePlatformLabel() 在记录时推断（custom 按端点 URL 匹配）
   */
  platform: string
  /** 实际使用的模型 ID */
  model: string
  /** 是否成功 */
  success: boolean
  /** 记录时间戳（毫秒） */
  time: number
}

// localStorage key（与 storageManager 维护的派生数据前缀风格保持一致）
const STORAGE_KEY = 'ydxl-ai-usage'

// 场景 → 最近一次调用记录（内存镜像，首次读取时从 localStorage 懒加载）
let records: Record<string, AIUsageRecord> | null = null

// 订阅者集合（React useSyncExternalStore 通过 subscribeAIUsage 接入）
const listeners = new Set<() => void>()

function loadRecords(): Record<string, AIUsageRecord> {
  if (records !== null) return records
  records = {}
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, AIUsageRecord>
        if (parsed && typeof parsed === 'object') records = parsed
      }
    }
  } catch {
    // localStorage 不可用 / JSON 损坏：按空记录处理
  }
  return records
}

function persist(): void {
  try {
    if (typeof window !== 'undefined' && records !== null) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    }
  } catch {
    // 配额满等：忽略，仅影响持久化不影响内存记录
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

// 合法供应商白名单（providerName() 返回值归一化，未知值按 custom 展示）
const VALID_PROVIDERS: readonly string[] = ['deepseek', 'openai', 'qwen', 'custom']

function normalizeProvider(provider: string): AIProviderName {
  return VALID_PROVIDERS.includes(provider) ? (provider as AIProviderName) : 'custom'
}

/**
 * 记录一次 AI 调用（由 baseProvider 的请求成败路径调用）
 * @param scenario 业务场景标识（与 callChat / callChatStream 的 options.scenario 一致）
 * @param provider 实际发起请求的供应商名称（子类 providerName() 返回值）
 * @param platform 实际调用的平台标签（如 'DeepSeek' / 'SiliconFlow' / 'OpenRouter'，
 *                 custom 供应商按端点 URL 推断，见 inferCustomPlatformLabel）
 * @param model 实际使用的模型 ID
 * @param success 是否成功返回内容
 */
export function recordAIUsage(
  scenario: string,
  provider: string,
  platform: string,
  model: string,
  success: boolean
): void {
  // 未标识场景的调用（连接测试等）不记录，避免污染业务场景的展示
  if (!scenario || scenario === 'unknown') return
  const store = loadRecords()
  store[scenario] = {
    provider: normalizeProvider(provider),
    platform: platform || normalizeProvider(provider),
    model,
    success,
    time: Date.now(),
  }
  persist()
  notify()
}

/**
 * 读取指定场景最近一次调用记录
 * @param scenario 业务场景标识
 * @returns 最近一次记录；该场景从未调用过 AI 时返回 undefined
 */
export function getAIUsage(scenario: string): AIUsageRecord | undefined {
  return loadRecords()[scenario]
}

/**
 * 订阅记录变化（React useSyncExternalStore 接入用）
 * @param listener 变化回调
 * @returns 取消订阅函数
 */
export function subscribeAIUsage(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 清空全部记录（存储维护 / 测试用）
 */
export function clearAIUsage(): void {
  records = {}
  persist()
  notify()
}
