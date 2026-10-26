// contentHash 文章内容指纹工具单元测试
//
// 覆盖场景：
// 1. SHA-256 分支：crypto.subtle 可用时取摘要前 16 位 hex
// 2. 回退分支：crypto 不可用时使用同步 DJB2 变体，返回 8 位 hex
// 3. 归一化：标题与正文首尾空白裁剪、统一小写
// 4. 稳定性：相同内容指纹一致，不同内容指纹不同

import { describe, it, expect, afterEach, vi } from 'vitest'
import { computeContentHash } from '../contentHash'

// 构造 32 字节摘要，便于断言 hex 前缀
function makeDigestBytes(): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, (_, i) => i))
}

describe('computeContentHash', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('crypto.subtle 可用时返回 SHA-256 摘要前 16 位 hex', async () => {
    const digest = vi.fn(
      async (_algorithm: string, _data: Uint8Array) => makeDigestBytes().buffer,
    )
    vi.stubGlobal('crypto', { subtle: { digest } })

    const hash = await computeContentHash('Title', 'Content')

    expect(digest).toHaveBeenCalledTimes(1)
    const [algorithm, data] = digest.mock.calls[0]
    expect(algorithm).toBe('SHA-256')
    // 编码内容为「标题\n正文」并统一小写
    expect(new TextDecoder().decode(data)).toBe('title\ncontent')
    // 摘要字节 00 01 02 ... → hex 00010203...，截取前 16 位
    expect(hash).toBe('0001020304050607')
    expect(hash).toHaveLength(16)
  })

  it('crypto 不可用时回退到同步 hash，返回 8 位 hex', async () => {
    vi.stubGlobal('crypto', undefined)

    const hash = await computeContentHash('Title', 'Content')

    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('空内容回退结果为 00000000', async () => {
    vi.stubGlobal('crypto', undefined)

    expect(await computeContentHash('', '')).toBe('00000000')
    expect(await computeContentHash('  ', '\n ')).toBe('00000000')
  })

  it('标题与正文大小写、首尾空白归一化后指纹一致', async () => {
    vi.stubGlobal('crypto', undefined)

    // 组合文本整体裁剪首尾空白（标题前导空白与正文尾随空白被去除）
    const a = await computeContentHash('  HELLO', 'WORLD  ')
    const b = await computeContentHash('hello', 'world')

    expect(a).toBe(b)
  })

  it('内容变化时指纹不同', async () => {
    vi.stubGlobal('crypto', undefined)

    const a = await computeContentHash('Title', 'Content A')
    const b = await computeContentHash('Title', 'Content B')

    expect(a).not.toBe(b)
  })

  it('相同内容多次计算指纹稳定', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => makeDigestBytes().buffer } })

    expect(await computeContentHash('Same', 'Body')).toBe(
      await computeContentHash('Same', 'Body'),
    )
  })
})
