// RemoteRepository 远程仓储基类单元测试
//
// 覆盖场景：
// 1. getAll / getPage / getById 请求路径与参数构造
// 2. add / update 自动注入当前 updated_at
// 3. delete 单条删除端点
// 4. bulkDelete 逐条删除且单条失败不中断
// 5. bulkAdd 批量新增端点与 updated_at 默认值
//
// Mock 策略：mock localApi 的 HTTP 方法，仅断言仓储层的请求构造与结果透传。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BaseEntity } from '@/shared/types'

vi.mock('../localApi', () => ({
  localApi: {
    get: vi.fn(),
    getById: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}))

import { RemoteRepository } from '../remoteRepositoryBase'
import { localApi } from '../localApi'

interface TestEntity extends BaseEntity {
  name: string
}

const getMock = vi.mocked(localApi.get)
const getByIdMock = vi.mocked(localApi.getById)
const postMock = vi.mocked(localApi.post)
const putMock = vi.mocked(localApi.put)
const delMock = vi.mocked(localApi.del)

function makeEntity(id: string): TestEntity {
  return { id, name: `name-${id}`, updated_at: 1 }
}

describe('RemoteRepository', () => {
  let repo: RemoteRepository<TestEntity>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    repo = new RemoteRepository<TestEntity>('words')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getAll 使用最大分页并返回 items', async () => {
    getMock.mockResolvedValue({ items: [makeEntity('a')], total: 1, limit: 1000, offset: 0 })

    const result = await repo.getAll()

    expect(getMock).toHaveBeenCalledWith('/words?limit=1000')
    expect(result).toEqual([makeEntity('a')])
  })

  it('getPage 默认与自定义分页参数', async () => {
    getMock.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 })

    await repo.getPage()
    expect(getMock).toHaveBeenLastCalledWith('/words?limit=100&offset=0')

    await repo.getPage(20, 40)
    expect(getMock).toHaveBeenLastCalledWith('/words?limit=20&offset=40')
  })

  it('getById 委托 localApi.getById', async () => {
    getByIdMock.mockResolvedValue(makeEntity('x'))

    const result = await repo.getById('x')

    expect(getByIdMock).toHaveBeenCalledWith('/words', 'x')
    expect(result).toEqual(makeEntity('x'))
  })

  it('add 注入当前 updated_at 并 POST', async () => {
    postMock.mockResolvedValue(makeEntity('new'))

    await repo.add({ id: 'new', name: 'name-new' })

    expect(postMock).toHaveBeenCalledWith('/words', {
      id: 'new',
      name: 'name-new',
      updated_at: 1_700_000_000_000,
    })
  })

  it('update 注入当前 updated_at 并 PUT', async () => {
    putMock.mockResolvedValue(makeEntity('x'))

    await repo.update('x', { name: 'changed' })

    expect(putMock).toHaveBeenCalledWith('/words', 'x', {
      name: 'changed',
      updated_at: 1_700_000_000_000,
    })
  })

  it('delete 委托 localApi.del', async () => {
    delMock.mockResolvedValue(undefined)

    await repo.delete('x')

    expect(delMock).toHaveBeenCalledWith('/words', 'x')
  })

  it('bulkDelete 逐条删除且单条失败不中断', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    delMock.mockImplementation(async (_path, id) => {
      if (id === 'bad') throw new Error('boom')
    })

    await repo.bulkDelete(['a', 'bad', 'b'])

    expect(delMock).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalled()
  })

  it('bulkAdd 使用批量端点并补全 updated_at', async () => {
    postMock.mockResolvedValue({ added: 2, skipped: 0 })

    const result = await repo.bulkAdd([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b', updated_at: 999 },
    ])

    expect(postMock).toHaveBeenCalledWith('/words/bulk', {
      items: [
        { id: 'a', name: 'a', updated_at: 1_700_000_000_000 },
        { id: 'b', name: 'b', updated_at: 999 },
      ],
    })
    expect(result).toEqual({ added: 2, skipped: 0 })
  })
})
