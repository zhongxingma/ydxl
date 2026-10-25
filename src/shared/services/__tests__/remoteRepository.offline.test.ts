// CachedRemoteRepository 离线持久化
//
// 离线场景下的本地缓存写入、读取与事件通知。
// 由 remoteRepository.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach } from 'vitest'
import { CachedRemoteRepository } from '../remoteRepository'
import { cacheEvents } from '../cacheEvents'
import { createMockRemote, createMockLocal, TestEntity } from './remoteRepositoryTestMocks'

describe('CachedRemoteRepository 离线持久化', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    // 清空事件总线订阅，避免测试间互相影响
    cacheEvents.clear()
  })

  // 1. getAll 远程失败（断网）时回退本地缓存
  // 对应场景：断网时打开首页/生词本/复习页/历史阅读，数据从本地 Dexie 缓存加载
  it('getAll 远程失败时回退本地缓存（断网可读）', async () => {
    const localItems: TestEntity[] = [
      { id: 'a1', name: '本地缓存文章1', updated_at: 1000 },
      { id: 'a2', name: '本地缓存文章2', updated_at: 2000 },
    ]
    // 远程不可用（模拟断网）
    mockRemote.getAll.mockRejectedValue(new Error('Network request failed'))
    // 本地缓存有数据
    mockLocal.getAll.mockResolvedValue(localItems)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getAll()

    // 验证返回的是本地缓存数据
    expect(result).toEqual(localItems)
    // 验证调用了本地缓存的 getAll
    expect(mockLocal.getAll).toHaveBeenCalledTimes(1)
  })

  // 2. getAll 远程成功时同步本地缓存（写入后离线可读）
  // 对应场景：联网时加载文章列表，数据同步到本地 Dexie，断网后仍可读
  it('getAll 远程成功时同步本地缓存（put 每条记录）', async () => {
    const remoteItems: TestEntity[] = [
      { id: 'a1', name: '远程文章1', updated_at: 1000 },
      { id: 'a2', name: '远程文章2', updated_at: 2000 },
    ]
    mockRemote.getAll.mockResolvedValue(remoteItems)
    // local.put 成功
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getAll()

    // 验证返回远程数据
    expect(result).toEqual(remoteItems)
    // 验证每条记录都同步到了本地缓存（put 被调用 2 次）
    expect(mockLocal.put).toHaveBeenCalledTimes(2)
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[0])
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[1])
  })

  // 3. getById 远程失败（断网）时回退本地缓存
  // 对应场景：断网时按日期打开文章，从本地 Dexie 缓存读取
  it('getById 远程失败时回退本地缓存（断网可读）', async () => {
    const localItem: TestEntity = {
      id: '2026-07-16',
      name: '本地缓存文章',
      updated_at: 1000,
    }
    // 远程不可用（模拟断网）
    mockRemote.getById.mockRejectedValue(new Error('Network request failed'))
    // 本地缓存命中
    mockLocal.getById.mockResolvedValue(localItem)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getById('2026-07-16')

    // 验证返回本地缓存数据
    expect(result).toEqual(localItem)
    // 验证调用了本地缓存的 getById
    expect(mockLocal.getById).toHaveBeenCalledWith('2026-07-16')
  })

  // 4. getById 远程成功时同步本地缓存
  it('getById 远程成功时同步本地缓存', async () => {
    const remoteItem: TestEntity = {
      id: '2026-07-16',
      name: '远程文章',
      updated_at: 1000,
    }
    mockRemote.getById.mockResolvedValue(remoteItem)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getById('2026-07-16')

    // 验证返回远程数据
    expect(result).toEqual(remoteItem)
    // 验证同步到本地缓存
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItem)
  })

  // 5. getById 远程返回 undefined 时不写入本地缓存
  it('getById 远程返回 undefined 时不写入本地缓存', async () => {
    mockRemote.getById.mockResolvedValue(undefined)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getById('not-exist')

    expect(result).toBeUndefined()
    // 验证未写入本地缓存（undefined 不应 put）
    expect(mockLocal.put).not.toHaveBeenCalled()
  })

  // 6. add 远程成功时同步本地缓存（写入后离线可读）
  // 对应场景：联网时生成新文章/加入生词本，写入服务器后同步到本地 Dexie，断网后仍可读
  it('add 远程成功时同步本地缓存（写入后离线可读）', async () => {
    const newEntity = { id: 'new1', name: '新文章' }
    const created: TestEntity = {
      ...newEntity,
      updated_at: 5000,
    }
    mockRemote.add.mockResolvedValue(created)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.add(newEntity)

    // 验证返回远程创建后的对象
    expect(result).toEqual(created)
    // 验证同步到本地缓存
    expect(mockLocal.put).toHaveBeenCalledWith(created)
  })

  // 7. update 远程 404 时 best-effort 更新本地缓存并返回 fallback（断网 markAsRead 场景）
  // 对应场景：断网时标记已读，远程返回 404（服务器无此文章），
  // 但本地缓存仍被更新，后续离线查询可读到已读状态
  it('update 远程 404 时 best-effort 更新本地缓存，返回 fallback 对象', async () => {
    mockRemote.update.mockRejectedValue(
      new Error('API /articles/2026-07-16 failed: 404 Not found'),
    )
    mockLocal.update.mockResolvedValue(1)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.update('2026-07-16', { name: 'updated' })

    // 验证返回 fallback 对象（不抛错）
    expect(result).toMatchObject({
      id: '2026-07-16',
      name: 'updated',
      updated_at: expect.any(Number),
    })
    // 验证本地缓存被 best-effort 更新（已读状态写入本地）
    expect(mockLocal.update).toHaveBeenCalledWith('2026-07-16', { name: 'updated' })
  })
})

// 验证 getById 写回本地缓存的对象包含所有字段，尤其是 JSON 列（phrases / highlightedWords / lexileRange）
// 的嵌套结构完整保留，phrases[].exampleTranslation 等新字段不丢失。
//
// 审阅结论（getById 缓存完整性）：
// - CachedRemoteRepository.getById 调用 this.local.put(item)，item 为远程返回的完整对象（无字段裁剪）
// - Repository.put 直接调用 Dexie table.put(entity)，使用结构化克隆存储整个对象
// - Dexie schema 仅声明索引不限制存储字段，phrases/highlightedWords/lexileRange 等未索引字段同样被存储
// - 服务器 JSON_COLUMNS 已将 phrases 反序列化为 ArticlePhrase[]，exampleTranslation 随数组一起存入缓存
// 以下测试用于回归防护，确保未来重构不破坏缓存完整性。
