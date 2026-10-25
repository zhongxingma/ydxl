// AI 代理契约：请求信封与 URL
//
// 代理模式 fetch body 的 { provider, body } 信封结构，以及 proxyBaseUrl 尾部斜杠处理。
// 由 ai-proxy-contract.test.ts 按契约分组拆分而来，用例内容与断言未改动。

import { type ChatMessage } from '../types'
import { DeepSeekProvider } from '../deepseekProvider'
import { installFetchMock, restoreFetch } from '@/test/setup'

describe('AI 代理契约：请求信封与 URL', () => {
  // 静默 baseProvider.ts 中的 console.debug 请求/响应日志，避免测试输出噪音
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })
  // ===== DeepSeekProvider 代理模式契约 =====

  it('DeepSeekProvider 代理模式：fetch body 应为 { provider, body: { model, messages, max_tokens } } 信封结构', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api',
        apiKey: 'proxy-token',
        model: 'deepseek-v4-pro',
      })
      await provider.generateTranslation('hello')

      // 验证 URL 拼接：proxyBaseUrl + /v1/ai-proxy/deepseek
      expect(calls[0].url).toBe('/api/v1/ai-proxy/deepseek')

      // 验证请求体结构（信封格式）
      const body = JSON.parse(calls[0].body) as {
        provider: string
        body: {
          model: string
          messages: ChatMessage[]
          max_tokens?: number
          response_format?: { type: string }
          thinking?: { type: string }
        }
      }
      expect(body.provider).toBe('deepseek')
      // 注：generateTranslation 为简单任务，按模型分级策略降级到 deepseek-v4-flash（覆盖 config.model）
      expect(body.body.model).toBe('deepseek-v4-flash')
      expect(Array.isArray(body.body.messages)).toBe(true)
      expect(body.body.messages.length).toBe(2)
      expect(body.body.messages[0].role).toBe('system')
      expect(body.body.messages[1].role).toBe('user')
      expect(body.body.messages[0].content.length > 0).toBe(true)
      // Phase 2 fine-tune: generateTranslation maxTokens 2048 → 768（典型 ~500 token，1.5x 上限）
      expect(body.body.max_tokens).toBe(768)
      // 纯文本场景不应有 response_format
      expect(body.body.response_format).toBeUndefined()
    } finally {
      restoreFetch()
    }
  })

  // ===== URL 拼接契约（含尾部斜杠处理）=====

  it('代理模式 URL 拼接：proxyBaseUrl 含尾部斜杠时应正确去除并拼接 /v1/ai-proxy/deepseek', async () => {
    const calls = installFetchMock({
      json: { choices: [{ message: { content: 'ok' } }] },
    })
    try {
      const provider = new DeepSeekProvider({
        proxyBaseUrl: '/api/',
        apiKey: 'proxy-token',
      })
      await provider.generateTranslation('hello')
      expect(calls[0].url).toBe('/api/v1/ai-proxy/deepseek')
    } finally {
      restoreFetch()
    }
  })

})
