// CachedRemoteRepository 分页 / 计数 / 删除与缓存同步异常单元测试
//
// 覆盖场景：
// 1. getPage 远程成功同步缓存；离线时 offset=0 回退 getRecent，offset>0 回退 getAll 切片
// 2. count 远程成功 / 失败回退本地计数
// 3. getRecent 远程成功同步缓存 / 失败回退本地索引
// 4. getByIdLocalFirst 本地命中后后台刷新失败仅记录警告
// 5. getById / add / update 远程成功但本地缓存写入失败时 best-effort 降级
// 6. update 远程失败且本地回退失败时记录两级警告并重新抛出
// 7. delete / bulkDelete 缓存同步失败仅记录警告
// 8. bulkAdd 委托远程批量端点
//
// Mock 策略：远程与本地仓储均为纯 mock 对象，聚焦错误分支与调用约定
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Repository } from '../repository'
import type { RemoteRepository } from '../remoteRepositoryBase'
import { CachedRemoteRepository } from '../remoteRepository'

interface TestEntity {
  id: string
  name: string
  updated_at: number
}

function makeEntity(id: string, updated_at = 100): TestEntity {
  return { id, name: `name-${id}`, updated_at }
}

function createRemote() {
  return {
    getAll: vi.fn(),
    getPage: vi.fn(),
    getById: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulkDelete: vi.fn(),
    bulkAdd: vi.fn(),
  }
}

function createLocal() {
  return {
    getAll: vi.fn(),
    getRecent: vi.fn(),
    count: vi.fn(),
    getById: vi.fn(),
    put: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulkDelete: vi.fn(),
  }
}

function createRepo() {
  const remote = createRemote()
  const local = createLocal()
  const repo = new CachedRemoteRepository<TestEntity>(
    remote as unknown as RemoteRepository<TestEntity>,
    local as unknown as Repository<TestEntity>,
    'articles'
  )
  return { repo, remote, local }
}

describe('CachedRemoteRepository 分页与缓存同步分支', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('getPage 远程成功：同步写入本地缓存并返回远程结果', async () => {
    const { repo, remote, local } = createRepo()
    const items = [makeEntity('a'), makeEntity('b')]
    const res = { items, total: 5, limit: 20, offset: 0 }
    remote.getPage.mockResolvedValue(res)
    local.put.mockResolvedValue('ok')

    await expect(repo.getPage(20, 0)).resolves.toEqual(res)
    expect(remote.getPage).toHaveBeenCalledWith(20, 0)
    expect(local.put).toHaveBeenCalledTimes(2)
    expect(local.put).toHaveBeenCalledWith(items[0])
  })

  it('getPage 远程失败且 offset=0：回退最近记录与本地计数', async () => {
    const { repo, remote, local } = createRepo()
    const cached = [makeEntity('c')]
    remote.getPage.mockRejectedValue(new Error('offline'))
    local.getRecent.mockResolvedValue(cached)
    local.count.mockResolvedValue(3)

    await expect(repo.getPage(20, 0)).resolves.toEqual({
      items: cached,
      total: 3,
      limit: 20,
      offset: 0,
    })
    expect(local.getRecent).toHaveBeenCalledWith(20)
    expect(local.getAll).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] 服务器不可用，回退到本地缓存',
      expect.any(Error)
    )
  })

  it('getPage 远程失败且 offset>0：回退全量记录切片', async () => {
    const { repo, remote, local } = createRepo()
    const all = Array.from({ length: 6 }, (_, i) => makeEntity(`e${i}`))
    remote.getPage.mockRejectedValue(new Error('offline'))
    local.getAll.mockResolvedValue(all)
    local.count.mockResolvedValue(6)

    await expect(repo.getPage(2, 4)).resolves.toEqual({
      items: all.slice(4, 6),
      total: 6,
      limit: 2,
      offset: 4,
    })
    expect(local.getRecent).not.toHaveBeenCalled()
  })

  it('count 远程成功返回 total，失败回退本地计数', async () => {
    const { repo, remote, local } = createRepo()
    remote.getPage.mockResolvedValueOnce({ items: [], total: 42, limit: 1, offset: 0 })

    await expect(repo.count()).resolves.toBe(42)
    expect(remote.getPage).toHaveBeenCalledWith(1, 0)

    remote.getPage.mockRejectedValueOnce(new Error('offline'))
    local.count.mockResolvedValue(7)
    await expect(repo.count()).resolves.toBe(7)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] count 服务器不可用，回退本地',
      expect.any(Error)
    )
  })

  it('getRecent 远程成功同步缓存，失败回退本地索引', async () => {
    const { repo, remote, local } = createRepo()
    const items = [makeEntity('a'), makeEntity('b')]
    remote.getPage.mockResolvedValueOnce({ items, total: 2, limit: 10, offset: 0 })
    local.put.mockResolvedValue('ok')

    await expect(repo.getRecent(10)).resolves.toEqual(items)
    expect(remote.getPage).toHaveBeenCalledWith(10, 0)
    expect(local.put).toHaveBeenCalledTimes(2)

    remote.getPage.mockRejectedValueOnce(new Error('offline'))
    local.getRecent.mockResolvedValue(items)
    await expect(repo.getRecent(10)).resolves.toEqual(items)
    expect(local.getRecent).toHaveBeenCalledWith(10)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] getRecent 服务器不可用，回退本地',
      expect.any(Error)
    )
  })

  it('getByIdLocalFirst 本地命中后后台刷新失败仅记录警告', async () => {
    const { repo, remote, local } = createRepo()
    const cached = makeEntity('a')
    local.getById.mockResolvedValue(cached)
    remote.getById.mockRejectedValue(new Error('refresh failed'))

    await expect(repo.getByIdLocalFirst('a')).resolves.toBe(cached)
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[CachedRemoteRepository] getByIdLocalFirst 后台刷新失败',
        expect.any(Error)
      )
    )
  })

  it('getById 远程成功但本地写入失败时仅记录警告并返回数据', async () => {
    const { repo, remote, local } = createRepo()
    const item = makeEntity('a')
    remote.getById.mockResolvedValue(item)
    local.put.mockRejectedValue(new Error('quota'))

    await expect(repo.getById('a')).resolves.toBe(item)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] sync getById to local cache failed',
      expect.any(Error)
    )
  })

  it('add 远程成功但本地写入失败时仅记录警告并返回创建结果', async () => {
    const { repo, remote, local } = createRepo()
    const created = makeEntity('new')
    remote.add.mockResolvedValue(created)
    local.put.mockRejectedValue(new Error('quota'))

    await expect(repo.add({ id: 'new', name: 'name-new' })).resolves.toBe(created)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] sync add to local cache failed',
      expect.any(Error)
    )
  })

  it('update 远程成功但本地同步失败时仅记录警告并返回远程结果', async () => {
    const { repo, remote, local } = createRepo()
    const updated = makeEntity('a', 200)
    remote.update.mockResolvedValue(updated)
    local.update.mockRejectedValue(new Error('quota'))

    await expect(repo.update('a', { name: 'next' })).resolves.toBe(updated)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] sync update to local cache failed',
      expect.any(Error)
    )
  })

  it('update 远程与本地回退均失败时记录两级警告并重新抛出', async () => {
    const { repo, remote, local } = createRepo()
    const remoteErr = new Error('server 500')
    remote.update.mockRejectedValue(remoteErr)
    local.update.mockRejectedValue(new Error('local failed'))

    await expect(repo.update('a', { name: 'next' })).rejects.toBe(remoteErr)
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] local fallback update failed',
      expect.any(Error)
    )
  })

  it('delete 远程成功但本地删除失败时仅记录警告', async () => {
    const { repo, remote, local } = createRepo()
    remote.delete.mockResolvedValue(undefined)
    local.delete.mockRejectedValue(new Error('local failed'))

    await expect(repo.delete('a')).resolves.toBeUndefined()
    expect(remote.delete).toHaveBeenCalledWith('a')
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] sync delete to local cache failed',
      expect.any(Error)
    )
  })

  it('bulkDelete 远程成功但本地批量删除失败时仅记录警告', async () => {
    const { repo, remote, local } = createRepo()
    remote.bulkDelete.mockResolvedValue(undefined)
    local.bulkDelete.mockRejectedValue(new Error('local failed'))

    await expect(repo.bulkDelete(['a', 'b'])).resolves.toBeUndefined()
    expect(remote.bulkDelete).toHaveBeenCalledWith(['a', 'b'])
    expect(warnSpy).toHaveBeenCalledWith(
      '[CachedRemoteRepository] sync bulkDelete to local cache failed',
      expect.any(Error)
    )
  })

  it('bulkAdd 委托远程批量端点并返回统计', async () => {
    const { repo, remote, local } = createRepo()
    remote.bulkAdd.mockResolvedValue({ added: 2, skipped: 1 })
    const items = [{ id: 'a', name: 'name-a' }, { id: 'b', name: 'name-b' }]

    await expect(repo.bulkAdd(items)).resolves.toEqual({ added: 2, skipped: 1 })
    expect(remote.bulkAdd).toHaveBeenCalledWith(items)
    expect(local.put).not.toHaveBeenCalled()
  })
})
