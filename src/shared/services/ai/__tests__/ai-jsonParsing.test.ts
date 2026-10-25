// parseJsonResponse 解析与容错
//
// 覆盖纯 JSON、代码块包裹、前后闲聊、平衡块提取、转义与截断报错，provider 无关。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { AIError } from '../types'
import { parseJsonResponse } from '../jsonParsing'

describe('parseJsonResponse', () => {
  it('解析纯 JSON 字符串', () => {
    const result = parseJsonResponse<{ a: number; b: string }>('{"a":1,"b":"hi"}')
    expect(result.a).toBe(1)
    expect(result.b).toBe('hi')
  })

  it('解析带 ```json 代码块的字符串', () => {
    const result = parseJsonResponse<{ a: number }>('```json\n{"a":42}\n```')
    expect(result.a).toBe(42)
  })

  it('解析带 ``` 代码块的字符串', () => {
    const result = parseJsonResponse<{ a: number }>('```\n{"a":7}\n```')
    expect(result.a).toBe(7)
  })

  it('解析前后带空白字符的字符串', () => {
    const result = parseJsonResponse<{ a: number }>('  \n\t{"a":99}\n  ')
    expect(result.a).toBe(99)
  })

  it('无效 JSON 抛出 AIError', () => {
    expect(() => parseJsonResponse('not a json')).toThrow(AIError)
    expect(() => parseJsonResponse('```json\n{invalid}\n```')).toThrow(AIError)
  })

  // ---------- 多级容错（第三方模型混杂输出兼容）----------

  it('解析 JSON 前带说明文字的输出（开源模型常见）', () => {
    const result = parseJsonResponse<{ a: number }>(
      '以下是解析结果：\n{"a":123}\n希望有帮助！'
    )
    expect(result.a).toBe(123)
  })

  it('解析 JSON 后带尾随文字的输出', () => {
    const result = parseJsonResponse<{ a: number; b: string }>(
      '{"a":1,"b":"hi"} 以上就是全部内容。'
    )
    expect(result.a).toBe(1)
    expect(result.b).toBe('hi')
  })

  it('字符串值中包含花括号时提取正确的平衡块', () => {
    // 字符串内的 { } 不应干扰括号配对
    const result = parseJsonResponse<{ text: string }>(
      '结果：{"text":"包含 {嵌套} 与 }符号 的内容"}'
    )
    expect(result.text).toBe('包含 {嵌套} 与 }符号 的内容')
  })

  it('字符串值中包含转义引号时提取正确的平衡块', () => {
    const result = parseJsonResponse<{ text: string }>(
      '结果：{"text":"他说：\\"你好\\""}'
    )
    expect(result.text).toBe('他说："你好"')
  })

  it('解析代码块包裹且块内含前后闲聊的输出', () => {
    // 围栏剥离后仍非纯 JSON，应继续走平衡块提取
    const result = parseJsonResponse<{ a: number }>(
      '```json\n好的，结果如下：{"a":8}\n```'
    )
    expect(result.a).toBe(8)
  })

  it('提取首个平衡的数组 JSON 块', () => {
    const result = parseJsonResponse<number[]>('列表：[1, 2, 3] 完毕')
    expect(result).toEqual([1, 2, 3])
  })

  it('括号不闭合（响应截断）时抛出 AIError', () => {
    expect(() => parseJsonResponse('{"a": 1, "b":')).toThrow(AIError)
  })
})
