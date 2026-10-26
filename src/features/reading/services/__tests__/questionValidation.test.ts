// questionValidation 题目校验与错误描述工具单元测试
//
// 覆盖场景：
// 1. isValidQuestionStructure：合法题目、非法题型、ignoreType、空字段、选项数量与空选项、correctIndex 越界、locationClue 类型
// 2. normalizeQuestionId：保留规范前缀、非规范 id 重写、语法填空 g 序号
// 3. describeAIError：中文透传、HTTP 状态码映射、空消息兜底、非 AIError 分支
// 4. normalizeForDedupe：小写、空白压缩、空缺占位符统一

import { describe, it, expect } from 'vitest'
import { AIError } from '@/shared/services/ai'
import {
  VALID_TYPES,
  isValidQuestionStructure,
  normalizeQuestionId,
  describeAIError,
  normalizeForDedupe,
} from '../questionValidation'

function validQuestion() {
  return {
    id: 'art-1',
    type: 'main_idea' as const,
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Because A',
    locationClue: 'paragraph 1',
  }
}

describe('questionValidation', () => {
  describe('isValidQuestionStructure', () => {
    it('合法题目返回 true', () => {
      expect(isValidQuestionStructure(validQuestion())).toBe(true)
    })

    it('非法题型返回 false，ignoreType 时跳过题型校验', () => {
      const q = { ...validQuestion(), type: 'unknown' as never }
      expect(isValidQuestionStructure(q)).toBe(false)
      expect(isValidQuestionStructure(q, { ignoreType: true })).toBe(true)
    })

    it('空的 stem / explanation 返回 false', () => {
      expect(isValidQuestionStructure({ ...validQuestion(), stem: '  ' })).toBe(false)
      expect(isValidQuestionStructure({ ...validQuestion(), explanation: '' })).toBe(false)
    })

    it('选项数量不为 4 或含空选项返回 false', () => {
      expect(isValidQuestionStructure({ ...validQuestion(), options: ['A', 'B', 'C'] })).toBe(false)
      expect(
        isValidQuestionStructure({ ...validQuestion(), options: ['A', 'B', 'C', '  '] }),
      ).toBe(false)
      expect(
        isValidQuestionStructure({ ...validQuestion(), options: ['A', 'B', 'C', 1 as never] }),
      ).toBe(false)
    })

    it('correctIndex 非整数或越界返回 false', () => {
      expect(isValidQuestionStructure({ ...validQuestion(), correctIndex: 4 })).toBe(false)
      expect(isValidQuestionStructure({ ...validQuestion(), correctIndex: -1 })).toBe(false)
      expect(isValidQuestionStructure({ ...validQuestion(), correctIndex: 1.5 })).toBe(false)
    })

    it('locationClue 非字符串返回 false', () => {
      expect(
        isValidQuestionStructure({ ...validQuestion(), locationClue: undefined as never }),
      ).toBe(false)
    })

    it('VALID_TYPES 包含阅读理解与语法填空题型', () => {
      expect(VALID_TYPES).toContain('grammar_fill')
      expect(VALID_TYPES).toContain('detail')
      expect(VALID_TYPES).toContain('structure')
    })
  })

  describe('normalizeQuestionId', () => {
    it('已带 articleId 前缀的 id 原样保留', () => {
      expect(normalizeQuestionId('art-1-2', 'art-1', 3, false)).toBe('art-1-2')
    })

    it('非规范 id 重写为 articleId-序号', () => {
      expect(normalizeQuestionId('q1', 'art-1', 3, false)).toBe('art-1-3')
      expect(normalizeQuestionId('', 'art-1', 1, false)).toBe('art-1-1')
    })

    it('语法填空题使用 g 序号', () => {
      expect(normalizeQuestionId('q1', 'art-1', 2, true)).toBe('art-1-g2')
    })
  })

  describe('describeAIError', () => {
    it('已是中文消息时直接返回', () => {
      expect(describeAIError(new AIError('账号余额不足，请充值'))).toBe('账号余额不足，请充值')
    })

    it('HTTP 状态码映射为中文提示', () => {
      expect(describeAIError(new AIError('HTTP 503'))).toBe(
        'AI 服务未配置或不可用，请联系管理员检查服务端 API Key 配置',
      )
      expect(describeAIError(new AIError('HTTP 401'))).toContain('API key 错误')
      expect(describeAIError(new AIError('HTTP 402'))).toContain('余额不足')
      expect(describeAIError(new AIError('HTTP 429'))).toBe('请求被限速，请稍后重试')
      expect(describeAIError(new AIError('HTTP 500'))).toBe('AI 服务器繁忙，请稍后重试')
      expect(describeAIError(new AIError('HTTP 502'))).toBe('AI 服务器繁忙，请稍后重试')
    })

    it('其他英文消息原样返回，空消息返回兜底文案', () => {
      expect(describeAIError(new AIError('network down'))).toBe('network down')
      expect(describeAIError(new AIError(''))).toBe('AI 调用失败')
    })

    it('非 AIError：Error 取 message，其他类型返回兜底文案', () => {
      expect(describeAIError(new Error('plain error'))).toBe('plain error')
      expect(describeAIError('string error')).toBe('AI 调用失败')
      expect(describeAIError(undefined)).toBe('AI 调用失败')
    })
  })

  describe('normalizeForDedupe', () => {
    it('小写、压缩空白并统一空缺占位符', () => {
      expect(normalizeForDedupe('  Fill   In ___  The ____ Blank ')).toBe(
        'fill in _ the _ blank',
      )
    })
  })
})
