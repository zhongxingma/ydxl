// 练习题目生成器单元测试
//
// 覆盖场景：
// 1. 题量落在 3-5 题区间
// 2. 每题 4 个不重复选项，且正确答案索引指向正确值
// 3. 完整单词（非词典词）不会生成近义词 / 反义词题
// 4. 词典词会生成近义 / 反义题；字段缺失时按可用题型降级
// 5. 题型中文标签覆盖全部 7 种题型
import { describe, it, expect } from 'vitest'
import type { Word } from '@/shared/types'
import { generateQuestions, TYPE_LABEL } from '../practiceQuestionGenerator'

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'apple',
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: 'I ate an apple yesterday.',
    mastery: 0,
    nextReview: 0,
    lastReview: 0,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// 各题型对应的正确选项文本
function expectedCorrect(word: Word, type: string): string {
  switch (type) {
    case 'word-to-def':
    case 'listen-choose-def':
      return word.definition
    case 'synonym':
      // 词典中第一个候选词为正确答案
      return 'glad'
    case 'antonym':
      return 'sad'
    default:
      // def-to-word / fill-blank / def-choose-word 的正确答案为单词本身
      return word.word
  }
}

describe('practiceQuestionGenerator', () => {
  it('完整单词生成 3-5 道题，每题 4 个不重复选项且答案索引正确', () => {
    const word = makeWord()
    for (let i = 0; i < 20; i++) {
      const questions = generateQuestions(word, [])
      expect(questions.length).toBeGreaterThanOrEqual(3)
      expect(questions.length).toBeLessThanOrEqual(5)
      for (const q of questions) {
        expect(q.options).toHaveLength(4)
        expect(new Set(q.options).size).toBe(4)
        expect(q.correctIndex).toBeGreaterThanOrEqual(0)
        expect(q.correctIndex).toBeLessThan(q.options.length)
        expect(q.options[q.correctIndex]).toBe(expectedCorrect(word, q.type))
      }
    }
  })

  it('非词典词不会生成近义词或反义词题', () => {
    const word = makeWord()
    for (let i = 0; i < 20; i++) {
      const types = generateQuestions(word, []).map((q) => q.type)
      expect(types).not.toContain('synonym')
      expect(types).not.toContain('antonym')
    }
  })

  it('词典词在字段缺失时仍生成近义 / 反义 / 看义选音三类题', () => {
    // definition 与 example 为空：释义类与例句类题型不可用，仅剩 3 种
    const word = makeWord({
      id: 'happy',
      word: 'happy',
      definition: '',
      example: '',
    })
    const questions = generateQuestions(word, [])
    expect(questions).toHaveLength(3)
    expect(questions.map((q) => q.type).sort()).toEqual(
      ['antonym', 'def-choose-word', 'synonym'].sort(),
    )
    // 近义 / 反义题：正确答案分别为词典首选候选词
    for (const q of questions) {
      if (q.type === 'synonym' || q.type === 'antonym') {
        expect(q.options[q.correctIndex]).toBe(expectedCorrect(word, q.type))
      }
    }
  })

  it('队列干扰词与正确词重复时仍保持选项唯一', () => {
    // 干扰池包含大小写变体与重复项，验证过滤与去重
    const word = makeWord({ word: 'happy', definition: '快乐的', example: 'I feel happy.' })
    const distractors = [
      makeWord({ id: 'd1', word: 'Happy', definition: '快乐的' }),
      makeWord({ id: 'd2', word: 'happy', definition: '快乐的' }),
      makeWord({ id: 'd3', word: 'glad', definition: '高兴的' }),
    ]
    for (let i = 0; i < 20; i++) {
      const questions = generateQuestions(word, distractors)
      for (const q of questions) {
        expect(new Set(q.options).size).toBe(q.options.length)
        const correct = q.options[q.correctIndex]
        expect(q.options.filter((o) => o === correct)).toHaveLength(1)
      }
    }
  })

  it('题型中文标签覆盖全部 7 种题型', () => {
    expect(Object.keys(TYPE_LABEL)).toHaveLength(7)
    for (const label of Object.values(TYPE_LABEL)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
