// questionMapper 题目转换去重单元测试
//
// 覆盖场景：
// 1. buildReadingQuestions：合法题目映射、grammar_fill 混入跳过、重复 id 跳过
// 2. buildGrammarFillQuestions：结构非法跳过、强制 grammar_fill 类型、
//    与阅读理解题干重复跳过、同批次重复 id / 题干跳过
//
// Mock 策略：纯函数测试，不依赖仓储与网络；仅 spy console.warn 抑制噪声。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QuestionGenerationResult } from '@/shared/services/ai'
import type { Question } from '@/shared/types'
import { buildReadingQuestions, buildGrammarFillQuestions } from '../questionMapper'

function makeAIQuestion(
  id: string,
  overrides: Partial<QuestionGenerationResult> = {},
): QuestionGenerationResult {
  return {
    id,
    type: 'main_idea',
    stem: `stem-${id}`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'explanation',
    locationClue: 'paragraph 1',
    ...overrides,
  }
}

function makeReadingQuestion(id: string, stem: string): Question {
  return {
    id,
    updated_at: 1,
    articleId: 'art-1',
    type: 'detail',
    stem,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'e',
    locationClue: 'p1',
    createdAt: 1,
  }
}

describe('questionMapper', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildReadingQuestions', () => {
    it('合法题目映射为 Question 并关联 articleId', () => {
      const result = buildReadingQuestions([makeAIQuestion('art-1-1')], 'art-1')

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'art-1-1',
        articleId: 'art-1',
        type: 'main_idea',
        stem: 'stem-art-1-1',
      })
      expect(result[0].options).toEqual(['A', 'B', 'C', 'D'])
    })

    it('混入 grammar_fill 类型时跳过', () => {
      const result = buildReadingQuestions(
        [makeAIQuestion('art-1-1'), makeAIQuestion('art-1-2', { type: 'grammar_fill' })],
        'art-1',
      )

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('art-1-1')
    })

    it('同批次 id 重复时仅保留第一条', () => {
      const result = buildReadingQuestions(
        [
          makeAIQuestion('art-1-1', { stem: 'first' }),
          makeAIQuestion('art-1-1', { stem: 'second' }),
        ],
        'art-1',
      )

      expect(result).toHaveLength(1)
      expect(result[0].stem).toBe('first')
    })

    it('结构非法题目跳过', () => {
      const result = buildReadingQuestions(
        [makeAIQuestion('art-1-1', { options: ['A', 'B', 'C'] as never })],
        'art-1',
      )

      expect(result).toEqual([])
    })
  })

  describe('buildGrammarFillQuestions', () => {
    it('结构非法题目跳过', () => {
      const result = buildGrammarFillQuestions(
        [makeAIQuestion('art-g1', { correctIndex: 4 })],
        'art',
        [],
      )

      expect(result).toEqual([])
    })

    it('忽略模型 type 并强制改写为 grammar_fill', () => {
      const result = buildGrammarFillQuestions(
        [makeAIQuestion('art-g1', { type: 'detail' })],
        'art',
        [],
      )

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('grammar_fill')
      expect(result[0].id).toBe('art-g1')
    })

    it('与阅读理解题干重复时跳过', () => {
      const result = buildGrammarFillQuestions(
        [makeAIQuestion('art-g1', { stem: 'Same Stem?' })],
        'art',
        [makeReadingQuestion('art-1', 'same   stem?')],
      )

      expect(result).toEqual([])
    })

    it('同批次重复 id 时仅保留第一条', () => {
      const result = buildGrammarFillQuestions(
        [
          makeAIQuestion('art-g1', { stem: 'first blank ______' }),
          makeAIQuestion('art-g1', { stem: 'second blank ______' }),
        ],
        'art',
        [],
      )

      expect(result).toHaveLength(1)
      expect(result[0].stem).toBe('first blank ______')
    })

    it('同批次题干规范化重复时跳过', () => {
      const result = buildGrammarFillQuestions(
        [
          makeAIQuestion('art-g1', { stem: 'Fill __ the blank' }),
          makeAIQuestion('art-g2', { stem: 'fill ___ the blank' }),
        ],
        'art',
        [],
      )

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('art-g1')
    })
  })
})
