// CachedRemoteRepository.update
//
// 远程 404 兜底、500 与网络错误 best-effort 写缓存后抛出、成功时同步本地缓存。
// 由 remoteRepository.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import { CachedRemoteRepository } from '../remoteRepository'
import { cacheEvents } from '../cacheEvents'
import { createMockRemote, createMockLocal, TestEntity } from './remoteRepositoryTestMocks'

describe('CachedRemoteRepository.update', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    // 清空事件总线订阅，避免测试间互相影响
    cacheEvents.clear()
  })

  // 1. 远程 404 时返回 fallback 对象（不抛错）
  // 对应修复：CachedRemoteRepository.update 404 兜底
  it('远程 404 时返回 fallback 对象（不抛错）', async () => {
    // 模拟远程 404 错误（错误消息包含 '404'）
    mockRemote.update.mockRejectedValue(
      new Error('API /test/id1 failed: 404 Not found'),
    )
    // 本地缓存更新成功（返回受影响行数 1）
    mockLocal.update.mockResolvedValue(1)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.update('id1', { name: 'test' })

    // 验证返回 fallback 对象：包含 id、patch 字段与 updated_at
    expect(result).toMatchObject({
      id: 'id1',
      name: 'test',
      updated_at: expect.any(Number),
    })
    // 验证本地缓存被 best-effort 更新（先在 catch 中尝试，再返回 fallback）
    expect(mockLocal.update).toHaveBeenCalledWith('id1', { name: 'test' })
  })

  // 2. 远程 500 时重新抛出
  it('远程 500 时重新抛出', async () => {
    // 模拟远程 500 错误（错误消息包含 '500'）
    const error = new Error(
      'API /test/id1 failed: 500 Internal Server Error',
    )
    mockRemote.update.mockRejectedValue(error)
    // 本地缓存更新成功（best-effort）
    mockLocal.update.mockResolvedValue(1)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )

    // 验证非 404 错误被重新抛出
    await expect(repo.update('id1', { name: 'test' })).rejects.toThrow('500')
    // 验证本地缓存仍被 best-effort 更新
    expect(mockLocal.update).toHaveBeenCalledWith('id1', { name: 'test' })
  })

  // 3. 成功时同步本地缓存
  it('成功时同步本地缓存并返回远程更新后的对象', async () => {
    // 模拟远程更新成功，返回完整的更新后对象
    const updated: TestEntity = {
      id: 'id1',
      name: 'test',
      updated_at: Date.now(),
    }
    mockRemote.update.mockResolvedValue(updated)
    // 本地缓存更新成功
    mockLocal.update.mockResolvedValue(1)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.update('id1', { name: 'test' })

    // 验证返回远程更新后的对象
    expect(result).toEqual(updated)
    // 验证本地缓存被同步更新（成功路径调用 local.update）
    expect(mockLocal.update).toHaveBeenCalledWith('id1', { name: 'test' })
    // 验证仅调用了一次本地缓存更新
    expect(mockLocal.update).toHaveBeenCalledTimes(1)
  })

  // 4. update 远程网络错误（非 404）时 best-effort 更新本地缓存后重新抛出
  // 对应 markAsRead 离线场景：断网时 remote.update 抛出网络错误，
  // CachedRemoteRepository 仍会 best-effort 调用 local.update 写入本地缓存，
  // 随后重新抛出错误（由 markAsRead 的 try/catch 兜住）
  it('update 远程网络错误（非 404）时 best-effort 更新本地缓存后重新抛出', async () => {
    // 模拟远程网络错误（错误消息不含 '404'）
    const networkError = new Error('Network request failed: TypeError: Failed to fetch')
    mockRemote.update.mockRejectedValue(networkError)
    // 本地缓存更新成功（best-effort）
    mockLocal.update.mockResolvedValue(1)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )

    // 验证非 404 错误被重新抛出
    await expect(repo.update('id1', { name: 'test' })).rejects.toThrow('Failed to fetch')
    // 验证本地缓存仍被 best-effort 更新（断网时已读状态写入本地）
    expect(mockLocal.update).toHaveBeenCalledWith('id1', { name: 'test' })
  })
})

// 验证 CachedRemoteRepository 的「服务器为主 + Dexie 离线只读缓存」策略：
// - 读取：远程失败时回退本地缓存（断网可读）
// - 写入：远程成功时同步本地缓存（写入后离线可读）

