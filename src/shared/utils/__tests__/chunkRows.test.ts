// chunkRows 工具单元测试
//
// 覆盖：
// 1. 整行切分（元素数正好为列数整数倍）
// 2. 末行不足时保留剩余元素
// 3. 列数非法（0 / 负数 / NaN）时按 1 列处理
// 4. 空数组返回空行列表
// 5. 返回新行数组，元素引用保持
import { describe, it, expect } from 'vitest'
import { chunkRows } from '../chunkRows'

describe('chunkRows', () => {
  it('按列数整行切分', () => {
    expect(chunkRows([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('末行保留不足一行的剩余元素', () => {
    expect(chunkRows(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('列数非法时按 1 列处理', () => {
    expect(chunkRows([1, 2, 3], 0)).toEqual([[1], [2], [3]])
    expect(chunkRows([1, 2, 3], -2)).toEqual([[1], [2], [3]])
    expect(chunkRows([1, 2, 3], Number.NaN)).toEqual([[1], [2], [3]])
  })

  it('空数组返回空行列表', () => {
    expect(chunkRows([], 3)).toEqual([])
  })

  it('返回新行数组，元素引用保持', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    const rows = chunkRows(items, 1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual([{ id: 'a' }])
    expect(rows[1][0]).toBe(items[1])
  })
})
