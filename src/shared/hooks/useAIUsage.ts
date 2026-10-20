// useAIUsage：订阅 AI 调用来源追踪器，返回指定场景最近一次调用记录
// 与 AIProviderBadge 配合，在各 AI 调用模块展示「来自哪个 AI 接口」
import { useSyncExternalStore } from 'react'
import {
  getAIUsage,
  subscribeAIUsage,
  type AIUsageRecord,
} from '@/shared/services/ai/aiUsageTracker'

/**
 * 读取指定业务场景最近一次 AI 调用的来源记录（跨组件实时同步）
 * @param scenario 业务场景标识（如 'questions' / 'vocabulary' / 'articlePhrases'）
 * @returns 最近一次调用记录；该场景从未调用过 AI 时返回 undefined
 */
export function useAIUsage(scenario: string): AIUsageRecord | undefined {
  return useSyncExternalStore(
    subscribeAIUsage,
    () => getAIUsage(scenario),
    () => undefined
  )
}
