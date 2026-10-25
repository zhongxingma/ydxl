// buildVocabularyFromHighlighted 高亮生词转换
//
// 高亮生词字段完整映射为基础版 ArticleVocabulary。
// 由 vocabularyService.cache.test.ts 按职责拆分而来，用例内容与断言未改动。

import { buildVocabularyFromHighlighted } from '../vocabularyService'

describe('buildVocabularyFromHighlighted 高亮生词转换（基础版持久化）', () => {
  // 11. 字段映射完整：word/phonetic/pos/definition/example 逐一保留
  it('高亮生词字段完整映射为基础版 ArticleVocabulary', () => {
    const highlighted = [
      {
        word: 'annual',
        phonetic: '/ˈænjuəl/',
        pos: 'adj.',
        definition: '每年的；年度的',
        example: 'the annual Sports Day',
      },
      {
        word: 'uniform',
        phonetic: '/ˈjuːnɪfɔːm/',
        pos: 'n.',
        definition: '制服',
        example: 'wear your sports uniform',
      },
      {
        word: 'instruction',
        phonetic: '/ɪnˈstrʌkʃn/',
        pos: 'n.',
        definition: '指示；说明',
        example: 'follow the instructions',
      },
    ]
    const result = buildVocabularyFromHighlighted(highlighted)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      word: 'annual',
      phonetic: '/ˈænjuəl/',
      pos: 'adj.',
      definition: '每年的；年度的',
      example: 'the annual Sports Day',
    })
    // 基础版不含增强字段（阅读页打开时由 AI 增强升级）
    expect(result[0].exampleSentence).toBeUndefined()
    expect(result[0].emojiHint).toBeUndefined()
  })

  // 12. importance 推断：第 1 个 high / 第 2-3 个 medium / 其余 low
  it('importance 按位置推断：high / medium / low', () => {
    const make = (word: string) => ({
      word,
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
    })
    const result = buildVocabularyFromHighlighted([
      make('w1'),
      make('w2'),
      make('w3'),
      make('w4'),
      make('w5'),
    ])
    expect(result.map((v) => v.importance)).toEqual([
      'high',
      'medium',
      'medium',
      'low',
      'low',
    ])
  })

  // 13. 空输入防御：undefined / 空数组返回空数组
  it('undefined 或空数组返回空数组', () => {
    expect(buildVocabularyFromHighlighted(undefined)).toEqual([])
    expect(buildVocabularyFromHighlighted([])).toEqual([])
  })
})
