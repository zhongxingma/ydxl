// 复习模块音节工具
//
// estimateSyllables：按元音组数量估算音节（末尾不发音 e 修正）
// breakdownWord：按元音核心切分本地拼读，覆盖双元音、magic E、无元音与空串

import { describe, it, expect } from 'vitest'
import { estimateSyllables, breakdownWord } from '../phonetics'

describe('estimateSyllables 音节估算', () => {
  it('单音节词返回 1', () => {
    expect(estimateSyllables('cat')).toBe(1)
    expect(estimateSyllables('be')).toBe(1)
  })

  it('多个元音组按组数计算', () => {
    expect(estimateSyllables('banana')).toBe(3)
    expect(estimateSyllables('beautiful')).toBe(3)
  })

  it('末尾不发音的 e 不计入音节', () => {
    expect(estimateSyllables('make')).toBe(1)
    expect(estimateSyllables('apple')).toBe(1)
  })

  it('y 作为元音参与统计', () => {
    expect(estimateSyllables('rhythm')).toBe(1)
    expect(estimateSyllables('happy')).toBe(2)
  })

  it('大小写不敏感', () => {
    expect(estimateSyllables('BANANA')).toBe(3)
  })
})

describe('breakdownWord 拼读分解', () => {
  it('空字符串返回空拼读', () => {
    expect(breakdownWord('')).toEqual({ phonics: [], syllables: 0 })
  })

  it('单音节词整体作为一个音节', () => {
    expect(breakdownWord('cat')).toEqual({ phonics: ['cat'], syllables: 1 })
    expect(breakdownWord('rain')).toEqual({ phonics: ['rain'], syllables: 1 })
  })

  it('多音节词按元音核心切分', () => {
    expect(breakdownWord('banana')).toEqual({
      phonics: ['ba', 'na', 'na'],
      syllables: 3,
    })
    expect(breakdownWord('beautiful')).toEqual({
      phonics: ['bea', 'u', 'ti', 'ful'],
      syllables: 4,
    })
  })

  it('识别常见双元音组合', () => {
    expect(breakdownWord('flower')).toEqual({ phonics: ['flow', 'er'], syllables: 2 })
  })

  it('magic E 模式合并为单音节', () => {
    expect(breakdownWord('make')).toEqual({ phonics: ['make'], syllables: 1 })
    expect(breakdownWord('cake')).toEqual({ phonics: ['cake'], syllables: 1 })
  })

  it('无元音核心时整个单词作为一个音节', () => {
    expect(breakdownWord('sky')).toEqual({ phonics: ['sky'], syllables: 1 })
    expect(breakdownWord('myth')).toEqual({ phonics: ['myth'], syllables: 1 })
  })

  it('大小写不敏感且保留原字母', () => {
    expect(breakdownWord('BANANA')).toEqual({
      phonics: ['ba', 'na', 'na'],
      syllables: 3,
    })
  })
})
