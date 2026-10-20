// wordbook store 单元测试（Task 9.4）
//
// 测试范围：
// 1. alphabetical 升序：apple 排在 banana 前
// 2. alphabetical 降序：banana 排在 apple 前
//
// 测试 filterAndSortWords 纯函数的字母排序逻辑，无需 mock repository

import { filterAndSortWords } from '../store'
import type { Word } from '@/shared/types'
import type { WordbookFilters } from '../types'

// 构造 Word 对象（提供合理默认值）
function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

describe('wordbook store - filterAndSortWords', () => {
  // 1. alphabetical 升序：apple 排在 banana 前
  it('alphabetical 升序：apple 排在 banana 前', () => {
    const words: Word[] = [
      makeWord('banana', { word: 'banana' }),
      makeWord('apple', { word: 'apple' }),
      makeWord('cherry', { word: 'cherry' }),
    ]
    const filters: WordbookFilters = {
      search: '',
      sortField: 'alphabetical',
      sortOrder: 'asc',
      onlyFavorite: false,
    }

    const result = filterAndSortWords(words, filters)

    // 升序：a → z
    expect(result.map((w) => w.word)).toEqual(['apple', 'banana', 'cherry'])
  })

  // 2. alphabetical 降序：banana 排在 apple 前
  it('alphabetical 降序：banana 排在 apple 前', () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
      makeWord('cherry', { word: 'cherry' }),
    ]
    const filters: WordbookFilters = {
      search: '',
      sortField: 'alphabetical',
      sortOrder: 'desc',
      onlyFavorite: false,
    }

    const result = filterAndSortWords(words, filters)

    // 降序：z → a
    expect(result.map((w) => w.word)).toEqual(['cherry', 'banana', 'apple'])
  })
})
