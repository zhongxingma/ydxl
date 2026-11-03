// LocalIndexRepository 本地索引查询基类单元测试
//
// 覆盖场景：12 个索引查询方法均按原参数委托给本地 Repository 并返回其结果。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BaseEntity } from '@/shared/types'
import type { Repository } from '../repository'
import { LocalIndexRepository } from '../localIndexRepository'

interface Entity extends BaseEntity {
  word: string
  mastery: number
  nextReview: number
}

function makeEntity(id: string): Entity {
  return { id, updated_at: Date.now(), word: id, mastery: 1, nextReview: 1000 }
}

const first = makeEntity('apple')
const second = makeEntity('banana')

function makeLocal() {
  const local = {
    whereEquals: vi.fn().mockResolvedValue([first]),
    whereEqualsFiltered: vi.fn().mockResolvedValue([first, second]),
    whereBetween: vi.fn().mockResolvedValue([first, second]),
    whereAbove: vi.fn().mockResolvedValue([second]),
    whereAboveOrEqual: vi.fn().mockResolvedValue([first, second]),
    whereAboveOrEqualFiltered: vi.fn().mockResolvedValue([second]),
    whereBelowOrEqual: vi.fn().mockResolvedValue([first]),
    countWhereAbove: vi.fn().mockResolvedValue(1),
    countWhereBelowOrEqual: vi.fn().mockResolvedValue(2),
    // 查询下沉方法
    count: vi.fn().mockResolvedValue(2),
    countLocal: vi.fn().mockResolvedValue(2),
    queryOrdered: vi.fn().mockResolvedValue([first, second]),
    countMatching: vi.fn().mockResolvedValue(1),
  }
  return local
}

describe('LocalIndexRepository 索引查询委托', () => {
  let local: ReturnType<typeof makeLocal>
  let repo: LocalIndexRepository<Entity>

  beforeEach(() => {
    local = makeLocal()
    repo = new LocalIndexRepository(local as unknown as Repository<Entity>)
  })

  it('whereEquals 透传字段与值', async () => {
    await expect(repo.whereEquals('word', 'apple')).resolves.toEqual([first])
    expect(local.whereEquals).toHaveBeenCalledWith('word', 'apple')
  })

  it('whereEqualsFiltered 透传过滤函数', async () => {
    const filter = (item: Entity) => item.mastery > 1

    await expect(repo.whereEqualsFiltered('word', 'apple', filter)).resolves.toEqual([
      first,
      second,
    ])
    expect(local.whereEqualsFiltered).toHaveBeenCalledWith('word', 'apple', filter)
  })

  it('whereBetween 透传上下界', async () => {
    await expect(repo.whereBetween('nextReview', 1, 2000)).resolves.toEqual([
      first,
      second,
    ])
    expect(local.whereBetween).toHaveBeenCalledWith('nextReview', 1, 2000)
  })

  it('whereAbove 透传比较值', async () => {
    await expect(repo.whereAbove('mastery', 4)).resolves.toEqual([second])
    expect(local.whereAbove).toHaveBeenCalledWith('mastery', 4)
  })

  it('whereAboveOrEqual 透传比较值', async () => {
    await expect(repo.whereAboveOrEqual('mastery', 2)).resolves.toEqual([first, second])
    expect(local.whereAboveOrEqual).toHaveBeenCalledWith('mastery', 2)
  })

  it('whereAboveOrEqualFiltered 透传比较值与过滤函数', async () => {
    const filter = (item: Entity) => item.id === 'banana'

    await expect(
      repo.whereAboveOrEqualFiltered('mastery', 2, filter)
    ).resolves.toEqual([second])
    expect(local.whereAboveOrEqualFiltered).toHaveBeenCalledWith(
      'mastery',
      2,
      filter
    )
  })

  it('whereBelowOrEqual 透传比较值', async () => {
    await expect(repo.whereBelowOrEqual('nextReview', 1000)).resolves.toEqual([first])
    expect(local.whereBelowOrEqual).toHaveBeenCalledWith('nextReview', 1000)
  })

  it('countWhereAbove 返回本地计数', async () => {
    await expect(repo.countWhereAbove('mastery', 4)).resolves.toBe(1)
    expect(local.countWhereAbove).toHaveBeenCalledWith('mastery', 4)
  })

  it('countWhereBelowOrEqual 返回本地计数', async () => {
    await expect(repo.countWhereBelowOrEqual('nextReview', 2000)).resolves.toBe(2)
    expect(local.countWhereBelowOrEqual).toHaveBeenCalledWith('nextReview', 2000)
  })

  it('countLocal 返回本地缓存记录数（不发网络请求）', async () => {
    await expect(repo.countLocal()).resolves.toBe(2)
    expect(local.countWhereAbove).not.toHaveBeenCalled()
    expect(local.countWhereBelowOrEqual).not.toHaveBeenCalled()
  })

  it('queryOrdered 透传有序查询参数', async () => {
    const filter = (item: Entity) => item.mastery < 5
    const params = { orderBy: 'nextReview' as const, reverse: true, filter, offset: 1, limit: 2 }

    await expect(repo.queryOrdered(params)).resolves.toEqual([first, second])
    expect(local.queryOrdered).toHaveBeenCalledWith(params)
  })

  it('countMatching 透传过滤函数', async () => {
    const filter = (item: Entity) => item.mastery < 5

    await expect(repo.countMatching(filter)).resolves.toBe(1)
    expect(local.countMatching).toHaveBeenCalledWith(filter)
  })
})
