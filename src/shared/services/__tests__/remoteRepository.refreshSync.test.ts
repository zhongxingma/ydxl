// CachedRemoteRepository 后台刷新与增量同步
//
// triggerRefresh 触发条件、增量更新与异常处理加固。
// 由 remoteRepository.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CachedRemoteRepository } from '../remoteRepository'
import { cacheEvents } from '../cacheEvents'
import { createMockRemote, createMockLocal, TestEntity } from './remoteRepositoryTestMocks'

describe('CachedRemoteRepository.triggerRefresh（SWR 后台刷新触发）', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    cacheEvents.clear()
  })

  // 1. triggerRefresh 异步触发 refreshFromServer（remote.getAll 被调用）
  it('调用后异步触发 refreshFromServer（remote.getAll 被调用）', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程文章1', updated_at: 1000 },
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    // triggerRefresh 是 fire-and-forget（void），立即返回
    repo.triggerRefresh()

    // 等待后台刷新完成
    await vi.waitFor(() => {
      expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
      expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[0])
    })
  })

  // 2. triggerRefresh 刷新成功后触发 cacheEvents.emit
  it('刷新成功后触发 cacheEvents.emit', async () => {
    mockRemote.getAll.mockResolvedValue([])
    mockLocal.put.mockResolvedValue('ok')

    let emitCount = 0
    cacheEvents.on('articles', () => {
      emitCount++
    })

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    repo.triggerRefresh()

    await vi.waitFor(() => {
      expect(emitCount).toBe(1)
    })
  })

  // 3. 30 秒节流：连续调用两次 triggerRefresh，第二次不重复触发
  it('30 秒节流：连续调用两次，第二次不重复触发后台刷新', async () => {
    mockRemote.getAll.mockResolvedValue([])
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    // 第一次调用：应触发后台刷新
    repo.triggerRefresh()
    await vi.waitFor(() => {
      expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
    })

    // 第二次调用：节流窗口内，不应再次触发
    repo.triggerRefresh()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
  })

  // 4. triggerRefresh 远程失败时不抛错（fire-and-forget，异常由内部 catch）
  it('远程失败时不抛错（fire-and-forget，异常由内部 catch）', async () => {
    mockRemote.getAll.mockRejectedValue(new Error('Network request failed'))

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    // 应同步返回 void，不抛错
    expect(() => repo.triggerRefresh()).not.toThrow()

    // 等待后台刷新的 Promise reject 被 catch
    await vi.waitFor(() => {
      expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
    })
  })
})

// 验证基于 updated_at 字段的差异比对策略：
// - 本地 updated_at >= remote 时不调用 local.put（避免覆盖本地较新数据）
// - 本地 updated_at < remote 时调用 local.put（同步远程更新）
// - 本地不存在时调用 local.put（新记录写入）
// 对应实现：CachedRemoteRepository.shouldUpdate 私有方法

describe('CachedRemoteRepository 增量更新', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    cacheEvents.clear()
  })

  // 场景 a: 本地 updated_at >= remote 时不调用 local.put
  it('getAll 刷新时本地 updated_at >= remote 的记录不调用 local.put', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程文章1', updated_at: 1000 },
    ]
    const localItems: TestEntity[] = [
      { id: 'a1', name: '本地文章1', updated_at: 1000 }, // 相同 updated_at
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    mockLocal.getById.mockResolvedValue(localItems[0]) // 本地已存在
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    await repo.getAll() // 触发 refreshFromServer

    await vi.waitFor(() => {
      expect(mockLocal.put).not.toHaveBeenCalled()
    })
  })

  // 场景 b: 本地 updated_at < remote 时调用 local.put
  it('getAll 刷新时本地 updated_at < remote 的记录调用 local.put', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程文章1-更新', updated_at: 2000 },
    ]
    const localItems: TestEntity[] = [
      { id: 'a1', name: '本地文章1-旧', updated_at: 1000 },
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    mockLocal.getById.mockResolvedValue(localItems[0])
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    await repo.getAll()

    await vi.waitFor(() => {
      expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[0])
    })
  })

  // 场景 c: 本地不存在时调用 local.put
  it('getAll 刷新时本地不存在的记录调用 local.put', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程新文章', updated_at: 1000 },
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    mockLocal.getById.mockResolvedValue(undefined) // 本地不存在
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    await repo.getAll()

    await vi.waitFor(() => {
      expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[0])
    })
  })
})

// 验证 refreshFromServer 中 local.put 包裹 try/catch 后的 best-effort 行为：
// - local.put 抛出 QuotaExceededError（或任意错误）时不中断整体刷新流程
// - 即使 local.put 失败，cacheEvents.emit 仍被触发，订阅方可收到刷新通知
//
// 注意：Repository.put 的 QuotaExceededError 清理重试逻辑在 repository.ts（真实 Dexie 实现），
// 此处 mock 的是 local repository（mockLocal），不会触发真实的清理重试。
// 本测试仅验证 CachedRemoteRepository 层的 best-effort 容错行为。

describe('CachedRemoteRepository 异常处理加固', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    cacheEvents.clear()
  })

  // 场景 a: QuotaExceededError 不中断 refreshFromServer 流程（best-effort）
  it('refreshFromServer 中 local.put 抛出 QuotaExceededError 后不中断流程（best-effort）', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程文章1', updated_at: 2000 },
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    // 本地无数据（触发 shouldUpdate = true）
    mockLocal.getById.mockResolvedValue(undefined)
    // local.put 抛出 QuotaExceededError
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    mockLocal.put.mockRejectedValue(quotaError)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    // refreshFromServer 不应抛错（best-effort）
    await expect(repo.refreshFromServer()).resolves.toBeUndefined()
    // 验证 local.put 被调用（虽然失败）
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[0])
  })

  // 场景 b: refreshFromServer best-effort 失败后仍触发 cacheEvents.emit
  it('refreshFromServer best-effort 失败后仍触发 cacheEvents.emit', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程文章1', updated_at: 2000 },
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    mockLocal.getById.mockResolvedValue(undefined)
    // local.put 抛出 QuotaExceededError
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    mockLocal.put.mockRejectedValue(quotaError)

    const listener = vi.fn()
    cacheEvents.on('articles', listener)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    await repo.refreshFromServer()

    // 验证 cacheEvents.emit 仍被调用（即使 local.put 失败）
    expect(listener).toHaveBeenCalled()
  })
})
