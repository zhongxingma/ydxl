// parseJsonArrayResponse 单元测试
// 覆盖：
// 1. 顶层数组直接返回（标准路径）
// 2. 对象包装自动解包（默认：元素须全为对象——题目/词汇/短语场景）
// 3. allowPrimitives：字符串元素数组的解包（emoji 助记场景，
//    2026-08-29 修复第三方 json_object 模式把 ["☀️"] 包成 {"emojis": ["☀️"]} 导致解析失败）
// 4. 防误判约束：默认模式不把 {"stem","options":[...]} 的 options 字符串数组当题目数组
import { describe, it, expect } from 'vitest'
import { parseJsonArrayResponse } from '../baseProvider'
import { AIError } from '../types'

describe('parseJsonArrayResponse', () => {
  it('顶层数组直接返回', () => {
    const result = parseJsonArrayResponse<{ a: number }>('[{"a":1},{"a":2}]')
    expect(result).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('对象包装自动解包（元素全为对象，默认模式）', () => {
    const result = parseJsonArrayResponse<{ q: string }>('{"questions":[{"q":"1"},{"q":"2"}]}')
    expect(result).toEqual([{ q: '1' }, { q: '2' }])
  })

  it('allowPrimitives：字符串元素数组的包装对象可解包（emoji 场景）', () => {
    const result = parseJsonArrayResponse<string>('{"emojis":["☀️","🌞"]}', {
      allowPrimitives: true,
    })
    expect(result).toEqual(['☀️', '🌞'])
  })

  it('默认模式拒绝字符串元素数组（防误判题目 options）', () => {
    // 单个题目对象 {"stem","options":["A","B"]}：options 是字符串数组，
    // 默认约束下不能被当题目数组解包，应抛错避免静默错数据
    expect(() =>
      parseJsonArrayResponse<{ stem: string }>('{"stem":"题干","options":["A","B"]}')
    ).toThrow(AIError)
  })

  it('空文本抛 AIError', () => {
    expect(() => parseJsonArrayResponse<string>('')).toThrow(AIError)
  })
})
