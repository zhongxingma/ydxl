// AI 来源徽章：展示当前模块最近一次 AI 调用实际使用的接口
// scenario 与 baseProvider callChat / callChatStream 的 options.scenario 一一对应；
// 该场景从未调用过 AI（如纯本地缓存数据）时不渲染任何内容
// 展示优先级：record.platform（实际调用的平台，如 SiliconFlow/OpenRouter/DeepSeek）
// > AI_PROVIDER_META label（旧记录无 platform 字段时的回退）
import { AI_PROVIDER_META, type AIProviderName } from '@/shared/services/ai'
import { useAIUsage } from '@/shared/hooks/useAIUsage'
import { cn } from '@/shared/utils/cn'

interface AIProviderBadgeProps {
  /** 业务场景标识（如 'questions' / 'vocabulary' / 'articlePhrases'） */
  scenario: string
  /** 场景短标签（同一标题行展示多个徽章时用于区分，如 '例句' / '助记'） */
  text?: string
  /** 追加样式（如 margin） */
  className?: string
}

export default function AIProviderBadge({ scenario, text, className }: AIProviderBadgeProps) {
  const record = useAIUsage(scenario)
  // 无记录（本地缓存/兜底素材，未触发过 AI 调用）时不占位
  if (!record) return null
  // 平台标签：新记录携带 platform（实际调用平台）；旧记录回退供应商元数据 label
  const label = record.platform || AI_PROVIDER_META[record.provider as AIProviderName]?.label || record.provider
  const timeStr = new Date(record.time).toLocaleString()
  return (
    <span
      title={`${text ? `${text} AI 来源` : 'AI 来源'}：${label} · ${record.model || '默认模型'} · ${
        record.success ? '调用成功' : '调用失败'
      } · ${timeStr}`}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs leading-4 whitespace-nowrap',
        record.success
          ? 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400'
          : 'border-red-200 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400',
        className
      )}
    >
      {text
        ? `${text} · ${label}${record.success ? '' : ' · 失败'}`
        : record.success
          ? `AI · ${label}`
          : `AI · ${label} · 失败`}
    </span>
  )
}
