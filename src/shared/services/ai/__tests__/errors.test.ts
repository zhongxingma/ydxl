// AI 供应商错误码与错误消息工具单元测试
//
// 覆盖场景：
// 1. 可重试状态码判定（429 / 500 / 502 / 503 / 504）
// 2. 不可重试客户端错误判定（400 / 401 / 402 / 422）
// 3. 状态码常量与向后兼容别名
// 4. AIError 字段与 name
// 5. 错误消息按状态码与供应商名定制，未知供应商 / 未知状态码走兜底

import { describe, it, expect } from 'vitest'
import {
  AI_STATUS,
  DEEPSEEK_STATUS,
  AIError,
  isRetryableStatus,
  isNonRetryableClientError,
  getAIErrorMessage,
  getDeepSeekErrorMessage,
} from '../errors'

describe('errors', () => {
  describe('isRetryableStatus', () => {
    it('429 / 500 / 502 / 503 / 504 可重试', () => {
      for (const status of [429, 500, 502, 503, 504]) {
        expect(isRetryableStatus(status)).toBe(true)
      }
    })

    it('客户端错误与其他状态码不可重试', () => {
      for (const status of [400, 401, 402, 422, 403, 404, 200]) {
        expect(isRetryableStatus(status)).toBe(false)
      }
    })
  })

  describe('isNonRetryableClientError', () => {
    it('400 / 401 / 402 / 422 为不可重试客户端错误', () => {
      for (const status of [400, 401, 402, 422]) {
        expect(isNonRetryableClientError(status)).toBe(true)
      }
    })

    it('限速与服务端错误不属于客户端错误', () => {
      for (const status of [429, 500, 502, 503, 504, 404]) {
        expect(isNonRetryableClientError(status)).toBe(false)
      }
    })
  })

  it('状态码常量与向后兼容别名一致', () => {
    expect(DEEPSEEK_STATUS).toBe(AI_STATUS)
    expect(AI_STATUS.BAD_REQUEST).toBe(400)
    expect(AI_STATUS.UNAUTHORIZED).toBe(401)
    expect(AI_STATUS.INSUFFICIENT_BALANCE).toBe(402)
    expect(AI_STATUS.PARAM_ERROR).toBe(422)
    expect(AI_STATUS.RATE_LIMITED).toBe(429)
    expect(AI_STATUS.SERVER_ERROR).toBe(500)
    expect(AI_STATUS.BAD_GATEWAY).toBe(502)
    expect(AI_STATUS.SERVER_BUSY).toBe(503)
    expect(AI_STATUS.GATEWAY_TIMEOUT).toBe(504)
  })

  it('AIError 保留 message / status / code / cause', () => {
    const cause = new Error('upstream')
    const err = new AIError('boom', 500, 'SERVER_ERROR', cause)

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AIError')
    expect(err.message).toBe('boom')
    expect(err.status).toBe(500)
    expect(err.code).toBe('SERVER_ERROR')
    expect(err.cause).toBe(cause)
  })

  describe('getAIErrorMessage', () => {
    it('各状态码按供应商名返回定制文案', () => {
      expect(getAIErrorMessage(400, 'deepseek')).toBe('DeepSeek 请求体格式错误，请检查请求参数')
      expect(getAIErrorMessage(401, 'openai')).toBe('OpenAI API key 错误或认证失败，请检查配置')
      expect(getAIErrorMessage(402, 'qwen')).toBe('通义千问 账号余额不足，请充值')
      expect(getAIErrorMessage(422, 'custom')).toBe('自定义模型 请求体参数错误，请检查参数配置')
    })

    it('限速与服务端错误文案', () => {
      expect(getAIErrorMessage(429, 'deepseek')).toBe('DeepSeek 请求被限速，请稍后重试')
      expect(getAIErrorMessage(500, 'deepseek')).toBe('DeepSeek 服务器内部故障，请稍后重试')
      expect(getAIErrorMessage(502, 'deepseek')).toBe('DeepSeek 网关错误，请稍后重试')
      expect(getAIErrorMessage(503, 'deepseek')).toBe('DeepSeek 服务器繁忙，请稍后重试')
    })

    it('未传供应商名或未知供应商时使用通用表述', () => {
      expect(getAIErrorMessage(400)).toBe('AI 服务 请求体格式错误，请检查请求参数')
      expect(getAIErrorMessage(401, 'unknown')).toBe('AI 服务 API key 错误或认证失败，请检查配置')
    })

    it('未知状态码返回带 HTTP 状态码的兜底文案', () => {
      expect(getAIErrorMessage(418, 'deepseek')).toBe('DeepSeek API 返回错误：HTTP 418')
      expect(getAIErrorMessage(504, 'deepseek')).toBe('DeepSeek API 返回错误：HTTP 504')
    })

    it('getDeepSeekErrorMessage 等价于 deepseek 定制文案', () => {
      expect(getDeepSeekErrorMessage(429)).toBe(getAIErrorMessage(429, 'deepseek'))
      expect(getDeepSeekErrorMessage(500)).toBe('DeepSeek 服务器内部故障，请稍后重试')
    })
  })
})
