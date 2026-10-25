// CachedRemoteRepository SWR 本地优先读取
//
// getById 缓存完整性、getAllLocalFirst 与 getByIdLocalFirst 的本地优先与后台刷新行为。
// 由 remoteRepository.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CachedRemoteRepository } from '../remoteRepository'
import { cacheEvents } from '../cacheEvents'
import type { Article } from '@/shared/types'
import { createMockRemote, createMockLocal, TestEntity } from './remoteRepositoryTestMocks'

describe('CachedRemoteRepository.getById 缓存完整性', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    // 清空事件总线订阅，避免测试间互相影响
    cacheEvents.clear()
  })

  // 构造含完整 JSON 列字段的 Article（phrases[].exampleTranslation / highlightedWords / lexileRange）
  function buildFullArticle(): Article {
    return {
      id: '2026-07-16',
      title: 'A Brave Boy',
      content: 'Once upon a time, a brave boy took care of his sister.',
      translation: '从前有一个勇敢的男孩照顾他的妹妹。',
      genre: 'narrative',
      wordCount: 100,
      createdAt: 1000,
      updated_at: 2000,
      topic: 'biography',
      difficulty: 'medium',
      lexileRange: { min: 500, max: 700 },
      highlightedWords: [
        {
          word: 'brave',
          phonetic: '/breɪv/',
          pos: 'adj.',
          definition: '勇敢的',
          example: 'a brave boy',
        },
      ],
      contentHash: 'abc123def456',
      readAt: null,
      startedAt: null,
      phrases: [
        {
          phrase: 'take care of',
          meaning: '照顾',
          example: 'He takes care of his sister.',
          exampleTranslation: '他照顾他的妹妹。',
        },
        {
          phrase: 'look up',
          meaning: '查找',
          example: 'Look up the word in the dictionary.',
          exampleTranslation: '在字典里查找这个单词。',
        },
      ],
    }
  }

  // 1. getById 远程成功时，local.put 写入包含 phrases[].exampleTranslation 的完整对象
  it('getById 远程成功时，local.put 写入包含 phrases[].exampleTranslation 的完整对象', async () => {
    const remoteItem = buildFullArticle()
    mockRemote.getById.mockResolvedValue(remoteItem)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<Article>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getById('2026-07-16')

    // 验证返回远程完整对象
    expect(result).toEqual(remoteItem)
    // 验证 local.put 被调用一次且参数为完整对象（与远程返回值引用相同，即未做字段裁剪）
    expect(mockLocal.put).toHaveBeenCalledTimes(1)
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItem)

    // 验证 local.put 接收的对象包含嵌套 JSON 列字段（phrases[].exampleTranslation 等）
    const putArg = mockLocal.put.mock.calls[0][0] as Article
    expect(putArg.phrases).toEqual(remoteItem.phrases)
    expect(putArg.phrases![0].exampleTranslation).toBe('他照顾他的妹妹。')
    expect(putArg.phrases![1].exampleTranslation).toBe('在字典里查找这个单词。')
    expect(putArg.highlightedWords).toEqual(remoteItem.highlightedWords)
    expect(putArg.lexileRange).toEqual({ min: 500, max: 700 })
  })

  // 2. getById 缓存写回后，离线读取返回完整字段（含 phrases[].exampleTranslation）
  // 对应场景：联网时打开文章，完整对象同步到本地 Dexie；断网后再次打开，从本地缓存读取
  it('getById 缓存写回后，离线读取返回完整字段（含 phrases[].exampleTranslation）', async () => {
    const remoteItem = buildFullArticle()

    // 模拟 Dexie 结构化克隆：local.put 写入什么，local.getById 就返回什么
    // 用 JSON 深拷贝模拟存盘→读盘过程，验证存入与读出的对象字段一致
    let cached: Article | undefined
    mockLocal.put.mockImplementation(async (entity: Article) => {
      cached = JSON.parse(JSON.stringify(entity)) as Article
      return 'ok'
    })
    mockLocal.getById.mockImplementation(async () => cached)

    const repo = new CachedRemoteRepository<Article>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )

    // 第一次：联网，远程返回完整对象并同步本地缓存
    mockRemote.getById.mockResolvedValueOnce(remoteItem)
    const onlineResult = await repo.getById('2026-07-16')
    expect(onlineResult).toEqual(remoteItem)
    expect(mockLocal.put).toHaveBeenCalledTimes(1)

    // 第二次：断网，远程抛错，回退本地缓存
    mockRemote.getById.mockRejectedValueOnce(new Error('Network request failed'))
    const offlineResult = await repo.getById('2026-07-16')

    // 验证离线读取返回完整对象（含 phrases[].exampleTranslation）
    expect(offlineResult).toEqual(remoteItem)
    expect(offlineResult?.phrases).toBeDefined()
    expect(offlineResult?.phrases!.length).toBe(2)
    expect(offlineResult?.phrases![0].exampleTranslation).toBe('他照顾他的妹妹。')
    expect(offlineResult?.phrases![1].exampleTranslation).toBe('在字典里查找这个单词。')
    expect(offlineResult?.highlightedWords).toEqual(remoteItem.highlightedWords)
    expect(offlineResult?.lexileRange).toEqual({ min: 500, max: 700 })
  })
})

// ============ 本地优先读取（SWR）测试 ============
// 验证 getAllLocalFirst / getByIdLocalFirst 的「本地优先 + 后台静默刷新」行为：
// - 本地有数据时立即返回本地，后台异步触发 refreshFromServer + cacheEvents.emit
// - 本地无数据时同步等待远程拉取
// - 后台刷新 30 秒节流：避免重复触发
// - getByIdLocalFirst 本地命中时立即返回，后台异步刷新该 id

describe('CachedRemoteRepository.getAllLocalFirst（SWR 模式）', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    cacheEvents.clear()
  })

  // 1. 本地有数据时立即返回本地，后台异步触发 refreshFromServer + emit
  it('本地有数据时立即返回本地，后台异步触发 refreshFromServer + emit', async () => {
    const localItems: TestEntity[] = [
      { id: 'a1', name: '本地文章1', updated_at: 1000 },
      { id: 'a2', name: '本地文章2', updated_at: 2000 },
    ]
    mockLocal.getAll.mockResolvedValue(localItems)
    mockRemote.getAll.mockResolvedValue([
      { id: 'a1', name: '远程文章1', updated_at: 1500 },
      { id: 'a2', name: '远程文章2', updated_at: 2500 },
    ])
    mockLocal.put.mockResolvedValue('ok')

    // 在调用前订阅，验证后台刷新完成后 emit 被触发
    let emitReceived = false
    cacheEvents.on('articles', () => {
      emitReceived = true
    })

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getAllLocalFirst()

    // 验证返回的是本地数据（立即返回，未等待远程）
    expect(result).toEqual(localItems)
    // 验证调用了本地 getAll
    expect(mockLocal.getAll).toHaveBeenCalledTimes(1)

    // 等待后台刷新完成（fire-and-forget，需等待微任务队列清空）
    await vi.waitFor(() => {
      expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
      expect(mockLocal.put).toHaveBeenCalled()
      expect(emitReceived).toBe(true)
    })
  })

  // 2. 本地无数据时同步等待 remote.getAll() 拉取
  it('本地无数据时同步等待 remote.getAll() 拉取', async () => {
    mockLocal.getAll.mockResolvedValue([])
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
    const result = await repo.getAllLocalFirst()

    // 验证返回远程数据（同步等待）
    expect(result).toEqual(remoteItems)
    // 验证本地缓存被写入
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItems[0])
  })

  // 3. 本地无数据且远程失败时返回 []
  it('本地无数据且远程失败时返回空数组', async () => {
    mockLocal.getAll.mockResolvedValue([])
    mockRemote.getAll.mockRejectedValue(new Error('Network request failed'))

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getAllLocalFirst()

    expect(result).toEqual([])
  })

  // 4. 30 秒节流：本地有数据时连续调用两次，第二次不重复触发后台刷新
  it('30 秒节流：连续调用两次 getAllLocalFirst，第二次不重复触发后台刷新', async () => {
    const localItems: TestEntity[] = [{ id: 'a1', name: '本地文章', updated_at: 1000 }]
    mockLocal.getAll.mockResolvedValue(localItems)
    mockRemote.getAll.mockResolvedValue(localItems)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )

    // 第一次调用：应触发后台刷新
    await repo.getAllLocalFirst()
    await vi.waitFor(() => {
      expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
    })

    // 第二次调用：节流窗口内，不应再次触发后台刷新
    await repo.getAllLocalFirst()
    // 等待微任务队列清空，确认未重复调用
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockRemote.getAll).toHaveBeenCalledTimes(1)
  })

  // 5. refreshFromServer 成功后触发 cacheEvents.emit
  it('refreshFromServer 成功后触发 cacheEvents.emit', async () => {
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
    await repo.refreshFromServer()

    expect(emitCount).toBe(1)
  })
})

describe('CachedRemoteRepository.getByIdLocalFirst（SWR 模式）', () => {
  let mockRemote: ReturnType<typeof createMockRemote>
  let mockLocal: ReturnType<typeof createMockLocal>

  beforeEach(() => {
    mockRemote = createMockRemote()
    mockLocal = createMockLocal()
    cacheEvents.clear()
  })

  // 1. 本地命中时立即返回本地，后台异步刷新该 id
  it('本地命中时立即返回本地数据，后台异步刷新该 id', async () => {
    const localItem: TestEntity = { id: 'a1', name: '本地缓存', updated_at: 1000 }
    const remoteItem: TestEntity = { id: 'a1', name: '远程最新', updated_at: 2000 }
    mockLocal.getById.mockResolvedValue(localItem)
    mockRemote.getById.mockResolvedValue(remoteItem)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getByIdLocalFirst('a1')

    // 验证立即返回本地数据
    expect(result).toEqual(localItem)
    // 验证调用了本地 getById
    expect(mockLocal.getById).toHaveBeenCalledWith('a1')

    // 等待后台异步刷新完成
    await vi.waitFor(() => {
      expect(mockRemote.getById).toHaveBeenCalledWith('a1')
      expect(mockLocal.put).toHaveBeenCalledWith(remoteItem)
    })
  })

  // 2. 本地未命中时同步等待 remote.getById()
  it('本地未命中时同步等待 remote.getById() 拉取', async () => {
    mockLocal.getById.mockResolvedValue(undefined)
    const remoteItem: TestEntity = { id: 'a1', name: '远程', updated_at: 1000 }
    mockRemote.getById.mockResolvedValue(remoteItem)
    mockLocal.put.mockResolvedValue('ok')

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getByIdLocalFirst('a1')

    // 验证返回远程数据
    expect(result).toEqual(remoteItem)
    // 验证写入本地缓存
    expect(mockLocal.put).toHaveBeenCalledWith(remoteItem)
  })

  // 3. 本地未命中且远程返回 undefined 时不写入本地缓存
  it('本地未命中且远程返回 undefined 时不写入本地缓存', async () => {
    mockLocal.getById.mockResolvedValue(undefined)
    mockRemote.getById.mockResolvedValue(undefined)

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getByIdLocalFirst('not-exist')

    expect(result).toBeUndefined()
    expect(mockLocal.put).not.toHaveBeenCalled()
  })

  // 4. 本地未命中且远程失败时返回 undefined
  it('本地未命中且远程失败时返回 undefined', async () => {
    mockLocal.getById.mockResolvedValue(undefined)
    mockRemote.getById.mockRejectedValue(new Error('Network request failed'))

    const repo = new CachedRemoteRepository<TestEntity>(
      mockRemote as never,
      mockLocal as never,
      'articles',
    )
    const result = await repo.getByIdLocalFirst('a1')

    expect(result).toBeUndefined()
  })
})

// ============ triggerRefresh 测试 ============
// 验证 triggerRefresh 的「fire-and-forget + 30 秒节流」行为：
// - 调用后异步触发 refreshFromServer（不阻塞调用方）
// - 30 秒节流：连续调用两次，第二次不重复触发
// - 刷新成功后触发 cacheEvents.emit
// - 远程失败时不抛错（fire-and-forget，异常由内部 catch）
// 使用场景：reviewService.getTodayReviewQueueInfo 使用 whereBelowOrEqual 本地索引查询，
//           需单独触发后台刷新以保证跨终端数据新鲜度

