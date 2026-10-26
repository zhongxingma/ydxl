// Repository 通用仓储单元测试
//
// 覆盖场景：
// 1. isQuotaExceededError：QuotaExceededError / 普通 Error / 非 Error
// 2. 基础查询：getAll / count / getById / getRecent
// 3. 索引查询：whereEquals / whereEqualsFiltered / whereBetween / above / aboveOrEqual /
//    aboveOrEqualFiltered / belowOrEqual / countWhereAbove / countWhereBelowOrEqual
// 4. 写入：add / update 自动刷新 updated_at；delete / bulkDelete
// 5. put：新增与覆盖；配额超限后清理重试成功；重试仍超限抛 StorageQuotaError；
//    非配额错误原样抛出；重试返回其他错误原样抛出
//
// 环境依赖：fake-indexeddb（setupIndexedDB.ts 注入）承载真实 Dexie 表；
// put 的配额分支使用最小 Table stub，避免依赖真实存储配额
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Dexie from 'dexie'
import type { Table } from 'dexie'
import type { BaseEntity } from '@/shared/types'
import { StorageQuotaError } from '../storageManager'
import { Repository, isQuotaExceededError } from '../repository'

interface TestEntity extends BaseEntity {
  name: string
  score: number
  category: string
}

const db = new Dexie(`repository-test-${Date.now()}`)
db.version(1).stores({ items: 'id, updated_at, score, name, category' })
const table = db.table<TestEntity, string>('items')
const repo = new Repository<TestEntity>(table)

function makeEntity(id: string, overrides: Partial<TestEntity> = {}): TestEntity {
  return {
    id,
    name: `name-${id}`,
    score: 1,
    category: 'c1',
    updated_at: 1000,
    ...overrides,
  }
}

function quotaError(): Error {
  const err = new Error('quota exceeded')
  err.name = 'QuotaExceededError'
  return err
}

describe('Repository 通用仓储', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await table.clear()
  })

  afterAll(async () => {
    await db.delete()
  })

  it('isQuotaExceededError 仅识别 QuotaExceededError', () => {
    expect(isQuotaExceededError(quotaError())).toBe(true)
    expect(isQuotaExceededError(new Error('network'))).toBe(false)
    expect(isQuotaExceededError('QuotaExceededError')).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
  })

  it('getAll / count / getById / getRecent 基础查询', async () => {
    await table.bulkAdd([
      makeEntity('a', { updated_at: 100 }),
      makeEntity('b', { updated_at: 300 }),
      makeEntity('c', { updated_at: 200 }),
    ])

    expect((await repo.getAll()).map((e) => e.id).sort()).toEqual(['a', 'b', 'c'])
    expect(await repo.count()).toBe(3)
    expect((await repo.getById('b'))?.name).toBe('name-b')
    expect(await repo.getById('missing')).toBeUndefined()
    expect((await repo.getRecent()).map((e) => e.id)).toEqual(['b', 'c', 'a'])
    expect((await repo.getRecent(2)).map((e) => e.id)).toEqual(['b', 'c'])
  })

  it('whereEquals / whereEqualsFiltered 按索引精确匹配并支持内存过滤', async () => {
    await table.bulkAdd([
      makeEntity('a', { category: 'c1', score: 1 }),
      makeEntity('b', { category: 'c1', score: 5 }),
      makeEntity('c', { category: 'c2', score: 3 }),
    ])

    expect((await repo.whereEquals('category', 'c1')).map((e) => e.id).sort()).toEqual([
      'a',
      'b',
    ])
    expect(
      (await repo.whereEqualsFiltered('category', 'c1', (e) => e.score >= 5)).map((e) => e.id)
    ).toEqual(['b'])
  })

  it('whereBetween 含两端；above / belowOrEqual 边界正确', async () => {
    await table.bulkAdd([
      makeEntity('a', { score: 1 }),
      makeEntity('b', { score: 3 }),
      makeEntity('c', { score: 5 }),
      makeEntity('d', { score: 7 }),
    ])

    expect((await repo.whereBetween('score', 3, 5)).map((e) => e.id).sort()).toEqual(['b', 'c'])
    expect((await repo.whereAbove('score', 3)).map((e) => e.id).sort()).toEqual(['c', 'd'])
    expect((await repo.whereAboveOrEqual('score', 3)).map((e) => e.id).sort()).toEqual([
      'b',
      'c',
      'd',
    ])
    expect((await repo.whereBelowOrEqual('score', 3)).map((e) => e.id).sort()).toEqual([
      'a',
      'b',
    ])
  })

  it('whereAboveOrEqualFiltered 与计数查询', async () => {
    await table.bulkAdd([
      makeEntity('a', { score: 1 }),
      makeEntity('b', { score: 3 }),
      makeEntity('c', { score: 5 }),
      makeEntity('d', { score: 7 }),
    ])

    expect(
      (await repo.whereAboveOrEqualFiltered('score', 3, (e) => e.id !== 'c')).map((e) => e.id)
    ).toEqual(['b', 'd'])
    expect(await repo.countWhereAbove('score', 3)).toBe(2)
    expect(await repo.countWhereBelowOrEqual('score', 3)).toBe(2)
  })

  it('add 自动写入 updated_at 时间戳', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123_456)

    const id = await repo.add({ id: 'a', name: 'apple', score: 1, category: 'c1' })

    expect(id).toBe('a')
    const saved = await repo.getById('a')
    expect(saved?.updated_at).toBe(123_456)
  })

  it('update 刷新 updated_at 并返回更新条数；不存在返回 0', async () => {
    await table.add(makeEntity('a', { updated_at: 1 }))
    vi.spyOn(Date, 'now').mockReturnValue(999)

    expect(await repo.update('a', { score: 9 })).toBe(1)
    const saved = await repo.getById('a')
    expect(saved).toMatchObject({ score: 9, updated_at: 999 })

    expect(await repo.update('missing', { score: 1 })).toBe(0)
  })

  it('delete / bulkDelete 删除记录', async () => {
    await table.bulkAdd([makeEntity('a'), makeEntity('b'), makeEntity('c')])

    await repo.delete('a')
    expect(await repo.count()).toBe(2)

    await repo.bulkDelete(['b', 'c'])
    expect(await repo.count()).toBe(0)
  })

  it('put 新增或覆盖整条记录', async () => {
    expect(await repo.put(makeEntity('a', { score: 1 }))).toBe('a')
    expect((await repo.getById('a'))?.score).toBe(1)

    await repo.put(makeEntity('a', { score: 4 }))
    expect(await repo.count()).toBe(1)
    expect((await repo.getById('a'))?.score).toBe(4)
  })

  it('put 遇到配额超限：清理后重试成功', async () => {
    const put = vi.fn().mockRejectedValueOnce(quotaError()).mockResolvedValueOnce('a')
    const stubRepo = new Repository<TestEntity>({ put } as unknown as Table<TestEntity, string>)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(stubRepo.put(makeEntity('a'))).resolves.toBe('a')

    expect(put).toHaveBeenCalledTimes(2)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('put 清理后重试仍配额超限：抛出 StorageQuotaError', async () => {
    const put = vi.fn().mockRejectedValue(quotaError())
    const stubRepo = new Repository<TestEntity>({ put } as unknown as Table<TestEntity, string>)

    await expect(stubRepo.put(makeEntity('a'))).rejects.toBeInstanceOf(StorageQuotaError)
    await expect(stubRepo.put(makeEntity('a'))).rejects.toThrow(
      '存储空间不足，清理后仍无法写入: a'
    )
    expect(put).toHaveBeenCalledTimes(4)
  })

  it('put 非配额错误原样抛出且不重试', async () => {
    const err = new Error('disk failure')
    const put = vi.fn().mockRejectedValue(err)
    const stubRepo = new Repository<TestEntity>({ put } as unknown as Table<TestEntity, string>)

    await expect(stubRepo.put(makeEntity('a'))).rejects.toBe(err)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('put 重试返回非配额错误：原样抛出', async () => {
    const retryErr = new Error('retry failed')
    const put = vi.fn().mockRejectedValueOnce(quotaError()).mockRejectedValueOnce(retryErr)
    const stubRepo = new Repository<TestEntity>({ put } as unknown as Table<TestEntity, string>)

    await expect(stubRepo.put(makeEntity('a'))).rejects.toBe(retryErr)
    expect(put).toHaveBeenCalledTimes(2)
  })
})
