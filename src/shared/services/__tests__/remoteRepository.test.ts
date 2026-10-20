//
// 测试范围：
// 1. update 远程 404 时返回 fallback 对象（不抛错，best-effort 更新本地缓存）
// 2. update 远程 500 时重新抛出（但仍 best-effort 更新本地缓存）
// 3. update 成功时同步本地缓存并返回远程更新后的对象
// 7. getById 远程成功时同步本地缓存
// 9. update 远程网络错误（非 404）时 best-effort 更新本地缓存后重新抛出（markAsRead 离线场景）
//
// Mock 策略：CachedRemoteRepository 构造函数注入 remote 与 local 两个依赖，
// 通过 vi.fn() 构造 mock 对象传入，仅 mock 测试中用到的方法
// 参考 wordbookService.test.ts 的 mock 模式

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CachedRemoteRepository } from '../remoteRepository'
import { cacheEvents } from '../cacheEvents'
import type { Article, BaseEntity } from '@/shared/types'

// 测试用实体类型：仅包含 name 字段（BaseEntity 已提供 id 与 updated_at）
interface TestEntity extends BaseEntity {
  name: string
}

// Mock RemoteRepository：按需 mock 方法
function createMockRemote() {
  return {
    update: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    add: vi.fn(),
  }
}

// Mock Repository：按需 mock 方法
function createMockLocal() {
  return {
    update: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    put: vi.fn(),
  }
}

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
