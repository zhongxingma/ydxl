// AI 连接测试 hook：测试当前所选 AI 供应商的连通性
// 用当前输入的 API Key 与可选 model 覆盖参数创建临时实例，
// 调用纯文本连通性测试方法（testConnection）验证
// 失败时返回错误消息，5 秒后自动清除
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createAIProviderByName } from '@/shared/services/ai'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { AIProviderType } from './useProfileSettings'

// 测试结果消息
export interface TestMessage {
  type: 'success' | 'error'
  text: string
}

export interface UseAIConnectionTestResult {
  // 是否正在测试中
  testingConnection: boolean
  // 测试结果消息（null 表示无消息）
  testMessage: TestMessage | null
  // 触发连接测试
  handleTestConnection: () => Promise<void>
}

/**
 * AI 连接测试 hook
 * @param aiProviderType 当前 AI 供应商（决定实例化路径）
 * @param aiApiKey 当前 API Key
 * @param aiModel 可选模型名覆盖（为空时使用 Provider 默认模型）
 * @param customEndpoint 自定义模型的请求地址（仅 provider === 'custom' 时使用）
 */
export function useAIConnectionTest(
  aiProviderType: AIProviderType,
  aiApiKey: string,
  aiModel?: string,
  customEndpoint?: string,
): UseAIConnectionTestResult {
  const { t } = useTranslation()
  const [testingConnection, setTestingConnection] = useState(false)
  const [testMessage, setTestMessage] = useState<TestMessage | null>(null)
  // 消息自动清除定时器引用（卸载时清理，避免对已卸载组件 setState）
  const clearMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (clearMsgTimerRef.current) window.clearTimeout(clearMsgTimerRef.current)
    }
  }, [])

  // 测试 AI 连接：按当前供应商与配置创建临时实例，调用轻量方法验证
  // - 错误消息由 baseProvider 自动返回对应供应商的中文提示
  const handleTestConnection = useCallback(async () => {
    if (testingConnection) return
    setTestingConnection(true)
    setTestMessage(null)
    try {
      const provider = createAIProviderByName(aiProviderType, {
        apiKey: aiApiKey,
        model: aiModel || undefined,
        // 自定义模型：传入用户当前输入的请求地址做真实端点验证
        endpoint: customEndpoint || undefined,
      })
      // 纯文本连通性测试（无 JSON 解析、无缓存）：
      // 2026-08-29 修复此前用 generateEmojiHint 测试导致 JSON 输出不合规
      // 被误报为「连接失败（无法解析为 JSON）」的问题
      await provider.testConnection()
      setTestMessage({ type: 'success', text: t('settings.connection_success') })
    } catch (err) {
      logger.warn('[ProfilePage] AI 连接测试失败', err)
      setTestMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('settings.connection_failed'),
      })
    } finally {
      setTestingConnection(false)
      // 5 秒后清除消息（清理上一次定时器避免重叠）
      if (clearMsgTimerRef.current) window.clearTimeout(clearMsgTimerRef.current)
      clearMsgTimerRef.current = setTimeout(() => {
        setTestMessage(null)
        clearMsgTimerRef.current = null
      }, 5000)
    }
  }, [aiProviderType, aiApiKey, aiModel, customEndpoint, testingConnection, t])

  return {
    testingConnection,
    testMessage,
    handleTestConnection,
  }
}
