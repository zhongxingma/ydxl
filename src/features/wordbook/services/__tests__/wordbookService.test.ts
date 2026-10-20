// wordbookService 单元测试（Task 6.1 / Task 6.5）
//
// 测试范围：
// 1. addToWordbook 新增生词 → 返回值正确且持久化（wordRepository.add 被调用）
// 2. addToWordbook 已存在词 → 合并笔记而非新增
// 3. removeFromWordbook 删除生词 → wordRepository.delete 被调用
// 4. removeFromWordbook 删除不存在的 id → 不抛错（边界）
// 5. updateNote 更新生词笔记 → wordRepository.update 被调用
// 6. getWordbookStats 统计 → 按 mastery/nextReview 过滤计数（类似 byDifficulty 的过滤语义）
// 7. bulkAddToWordbook 批量新增 → 返回成功/失败计数
// 8. getWordbook 分页/搜索/排序（Task 6.5）
//
// Mock 策略：重写 wordRepository 单例上的方法，使用内存数组作为存储
// 参考 articleDedup.test.ts / reviewService.test.ts 的 mock 模式

import type { Word } from '@/shared/types'
import type { VocabularyItem } from '@/shared/services/ai'
import { wordRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import {
  addToWordbook,
  removeFromWordbook,
  updateNote,
  getWordbookStats,
  bulkAddToWordbook,
  bulkRemove,
  enrichWord,
  getWordbook,
} from '../wordbookService'

// ---------- wordRepository 内存 Mock ----------

// 内存存储：模拟 words 表
let mockStore: Word[] = []

// 记录方法调用情况，便于断言持久化行为
const callLog: {
  add: number
  delete: number
  update: number
  bulkDelete: number
  bulkAdd: number
  // 记录每次 update 调用传入的 patch，用于验证仅缺失字段被写回
  patches: Array<{ id: string; patch: Record<string, unknown> }>
} = { add: 0, delete: 0, update: 0, bulkDelete: 0, bulkAdd: 0, patches: [] }

// 保存原始方法引用，便于恢复
const originalGetById = wordRepository.getById
const originalGetByIdLocalFirst = wordRepository.getByIdLocalFirst
const originalGetAll = wordRepository.getAll
const originalGetAllLocalFirst = wordRepository.getAllLocalFirst
const originalAdd = wordRepository.add
const originalUpdate = wordRepository.update
const originalDelete = wordRepository.delete
const originalBulkDelete = wordRepository.bulkDelete
const originalBulkAdd = wordRepository.bulkAdd
const originalCount = wordRepository.count
const originalCountWhereAbove = wordRepository.countWhereAbove
const originalCountWhereBelowOrEqual = wordRepository.countWhereBelowOrEqual

// 安装 wordRepository mock：重写相关方法，使用内存数组作为存储
function installWordMock(initial: Word[] = []): void {
  mockStore = [...initial]
  callLog.add = 0
  callLog.delete = 0
  callLog.update = 0
  callLog.bulkDelete = 0
  callLog.bulkAdd = 0
  callLog.patches = []

  wordRepository.getById = async (id: string) =>
    mockStore.find((w) => w.id === id)

  // 本地优先读取（SWR 模式）：与 getById 行为一致（测试中不触发后台刷新）
  // enrichWord 使用 getByIdLocalFirst，必须 mock 否则会访问真实 Dexie（IndexedDB 不可用）
  wordRepository.getByIdLocalFirst = async (id: string) =>
    mockStore.find((w) => w.id === id)

  wordRepository.getAll = async () => [...mockStore]

  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  wordRepository.getAllLocalFirst = async () => [...mockStore]

  wordRepository.add = async (entity) => {
    callLog.add += 1
    const item = { ...entity, updated_at: Date.now() } as Word
    mockStore.push(item)
    return item
  }

  wordRepository.update = async (id, patch) => {
    callLog.update += 1
    callLog.patches.push({ id, patch: patch as Record<string, unknown> })
    const idx = mockStore.findIndex((w) => w.id === id)
    if (idx >= 0) {
      mockStore[idx] = { ...mockStore[idx], ...patch, updated_at: Date.now() } as Word
      return mockStore[idx]
    }
    throw new Error(`Word not found: ${id}`)
  }

  wordRepository.delete = async (id: string) => {
    callLog.delete += 1
    const idx = mockStore.findIndex((w) => w.id === id)
    if (idx >= 0) mockStore.splice(idx, 1)
  }

  wordRepository.bulkDelete = async (ids: string[]) => {
    callLog.bulkDelete += 1
    const idSet = new Set(ids)
    mockStore = mockStore.filter((w) => !idSet.has(w.id))
  }

  // bulkAdd 模拟 server 端 INSERT OR IGNORE 行为：
  // - 已存在（id 重复）的记录跳过，不覆盖
  // - 新记录插入并累加 added 计数
  wordRepository.bulkAdd = async (items) => {
    callLog.bulkAdd += 1
    let added = 0
    let skipped = 0
    for (const item of items) {
      const exists = mockStore.some((w) => w.id === item.id)
      if (exists) {
        skipped += 1
      } else {
        mockStore.push({ ...item, updated_at: item.updated_at ?? Date.now() } as Word)
        added += 1
      }
    }
    return { added, skipped }
  }

  wordRepository.count = async () => mockStore.length

  wordRepository.countWhereAbove = async (field, value) =>
    mockStore.filter((w) => (w[field] as unknown as number) > (value as unknown as number)).length

  wordRepository.countWhereBelowOrEqual = async (field, value) =>
    mockStore.filter((w) => (w[field] as unknown as number) <= (value as unknown as number)).length
}

// 恢复原始方法
function restoreWordMock(): void {
  wordRepository.getById = originalGetById
  wordRepository.getByIdLocalFirst = originalGetByIdLocalFirst
  wordRepository.getAll = originalGetAll
  wordRepository.getAllLocalFirst = originalGetAllLocalFirst
  wordRepository.add = originalAdd
  wordRepository.update = originalUpdate
  wordRepository.delete = originalDelete
  wordRepository.bulkDelete = originalBulkDelete
  wordRepository.bulkAdd = originalBulkAdd
  wordRepository.count = originalCount
  wordRepository.countWhereAbove = originalCountWhereAbove
  wordRepository.countWhereBelowOrEqual = originalCountWhereBelowOrEqual
}

// ---------- aiProvider Mock ----------

// 使用 vi.fn 便于断言调用次数
const mockEnrichSingleWord = vi.fn()

// 保存原始方法引用，便于恢复
const originalEnrichSingleWord = aiProvider.enrichSingleWord

// 安装 aiProvider mock：重写 enrichSingleWord 方法
function installAIMock(
  impl: (word: string) => Promise<VocabularyItem>,
): void {
  mockEnrichSingleWord.mockReset()
  mockEnrichSingleWord.mockImplementation(impl)
  aiProvider.enrichSingleWord =
    mockEnrichSingleWord as typeof aiProvider.enrichSingleWord
}

// 恢复原始方法
function restoreAIMock(): void {
  aiProvider.enrichSingleWord = originalEnrichSingleWord
}

// 构造 Word 对象（提供合理默认值）
function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('wordbookService', () => {
  // 1. addToWordbook 新增生词 → 返回值正确且持久化
  it('addToWordbook 新增生词 → 返回值正确且持久化', async () => {
    installWordMock([])
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        note: 'first note',
      })

      // 验证返回值：id 为小写形式
      expect(result.id).toBe('brave')
      expect(result.word).toBe('Brave')
      expect(result.definition).toBe('勇敢的')
      // 验证新词初始化字段
      expect(result.mastery).toBe(0)
      expect(result.easeFactor).toBe(2.5)
      expect(result.reviewCount).toBe(0)
      expect(result.interval).toBe(0)
      // 验证 note 已写入
      expect(result.note).toBe('first note')
      // 验证已持久化：wordRepository.add 被调用一次
      expect(callLog.add).toBe(1)
      // 验证内存存储包含该词
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].id).toBe('brave')
    } finally {
      restoreWordMock()
    }
  })

  // 2. addToWordbook 已存在词 → 合并笔记而非新增（边界：重复词）
  it('addToWordbook 已存在词 → 合并笔记而非新增', async () => {
    const existing = makeWord('brave', {
      word: 'Brave',
      note: 'old note',
      mastery: 2,
    })
    installWordMock([existing])
    try {
      const result = await addToWordbook({
        word: 'brave',
        note: 'new note',
      })

      // 验证返回的 id 仍为小写
      expect(result.id).toBe('brave')
      // 验证笔记已合并（旧笔记 + 新笔记，换行分隔）
      expect(result.note).toBe('old note\nnew note')
      // 验证未新增（add 未被调用，update 被调用）
      expect(callLog.add).toBe(0)
      expect(callLog.update).toBe(1)
      // 验证内存存储仍为 1 条
      expect(mockStore.length).toBe(1)
      // 验证 mastery 保持原值（未重置）
      expect(result.mastery).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 3. removeFromWordbook 删除生词 → wordRepository.delete 被调用
  it('removeFromWordbook 删除生词 → 调用 delete 并从存储移除', async () => {
    const word = makeWord('brave', { word: 'Brave' })
    installWordMock([word])
    try {
      await removeFromWordbook('brave')

      // 验证 delete 被调用
      expect(callLog.delete).toBe(1)
      // 验证已从存储移除
      expect(mockStore.length).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 4. removeFromWordbook 删除不存在的 id → 不抛错（边界）
  it('removeFromWordbook 删除不存在的 id → 不抛错', async () => {
    installWordMock([])
    try {
      // 删除不存在的 id 不应抛错
      await expect(removeFromWordbook('nonexistent')).resolves.toBeUndefined()
      // 验证 delete 仍被调用（由底层 repository 处理）
      expect(callLog.delete).toBe(1)
      // 存储仍为空
      expect(mockStore.length).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 5. updateNote 更新生词笔记
  it('updateNote 更新生词笔记 → 调用 update 写入', async () => {
    const word = makeWord('brave', { word: 'Brave', note: 'old' })
    installWordMock([word])
    try {
      await updateNote('brave', 'updated note')

      // 验证 update 被调用
      expect(callLog.update).toBe(1)
      // 验证内存存储中笔记已更新
      expect(mockStore[0].note).toBe('updated note')
    } finally {
      restoreWordMock()
    }
  })

  // 6. updateNote 传入空字符串 → note 被清除（设为 undefined）
  it('updateNote 传入空字符串 → note 被清除', async () => {
    const word = makeWord('brave', { word: 'Brave', note: 'old' })
    installWordMock([word])
    try {
      await updateNote('brave', '   ')

      expect(callLog.update).toBe(1)
      // 空白字符串 trim 后为空 → note 设为 undefined
      expect(mockStore[0].note).toBeUndefined()
    } finally {
      restoreWordMock()
    }
  })

  // 7. getWordbookStats 统计 → 按 mastery/nextReview 过滤计数（byDifficulty 语义）
  it('getWordbookStats 统计 → 正确返回 total/mastered/pendingReview', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('w1', { mastery: 0, nextReview: now - 1000 }), // 未掌握，待复习
      makeWord('w2', { mastery: 5, nextReview: now + 9999 }), // 已掌握，未到期
      makeWord('w3', { mastery: 6, nextReview: now - 2000 }), // 已掌握，待复习
      makeWord('w4', { mastery: 3, nextReview: now + 5000 }), // 未掌握，未到期
    ]
    installWordMock(words)
    try {
      const stats = await getWordbookStats()

      // total: 全部 4 条
      expect(stats.total).toBe(4)
      // mastered: mastery >= 5 → w2, w3 共 2 条
      expect(stats.mastered).toBe(2)
      // pendingReview: nextReview <= now → w1, w3 共 2 条
      expect(stats.pendingReview).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 8. bulkAddToWordbook 批量新增 → 返回成功/失败计数
  it('bulkAddToWordbook 批量新增 → 返回正确计数', async () => {
    installWordMock([])
    try {
      const result = await bulkAddToWordbook(['apple', 'banana', 'cherry'])

      // 全部成功
      expect(result.added).toBe(3)
      expect(result.failed).toBe(0)
      // 验证存储包含 3 条
      expect(mockStore.length).toBe(3)
      // 验证 id 均为小写
      expect(mockStore.map((w) => w.id).sort()).toEqual(['apple', 'banana', 'cherry'])
    } finally {
      restoreWordMock()
    }
  })

  // 9. bulkAddToWordbook 空数组 → 返回 0/0
  it('bulkAddToWordbook 空数组 → 返回 0/0', async () => {
    installWordMock([])
    try {
      const result = await bulkAddToWordbook([])
      expect(result.added).toBe(0)
      expect(result.failed).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 9b. bulkAddToWordbook 已存在词被跳过（INSERT OR IGNORE 语义）
  it('bulkAddToWordbook 已存在词被跳过 → 返回 added/skipped 计数', async () => {
    // 预置 apple 已存在，导入 ['apple', 'banana'] 应 added=1, failed=1
    const existing = makeWord('apple', { word: 'Apple', mastery: 3 })
    installWordMock([existing])
    try {
      const result = await bulkAddToWordbook(['apple', 'banana'])

      // 新增 banana，跳过 apple
      expect(result.added).toBe(1)
      expect(result.failed).toBe(1)
      // 验证 bulkAdd 被调用一次（单次批量请求）
      expect(callLog.bulkAdd).toBe(1)
      // 验证 apple 复习进度未被覆盖（mastery 仍为 3）
      const apple = mockStore.find((w) => w.id === 'apple')
      expect(apple?.mastery).toBe(3)
      // 验证 banana 已插入
      const banana = mockStore.find((w) => w.id === 'banana')
      expect(banana).toBeDefined()
      expect(banana?.word).toBe('banana')
    } finally {
      restoreWordMock()
    }
  })

  // 10. bulkRemove 批量删除
  it('bulkRemove 批量删除 → 调用 bulkDelete 并移除', async () => {
    const words: Word[] = [
      makeWord('apple'),
      makeWord('banana'),
      makeWord('cherry'),
    ]
    installWordMock(words)
    try {
      await bulkRemove(['apple', 'cherry'])

      // 验证 bulkDelete 被调用
      expect(callLog.bulkDelete).toBe(1)
      // 验证仅剩 banana
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].id).toBe('banana')
    } finally {
      restoreWordMock()
    }
  })

  // 11. enrichWord 字段已完整 → 不调用 AI，直接返回原 word
  it('enrichWord 字段已完整 → 不调用 AI，直接返回原 word', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
    })
    installWordMock([word])
    installAIMock(async () => ({ word: 'Brave', phonetic: '', pos: '', definition: '', example: '', importance: 'low' }))
    try {
      const result = await enrichWord('brave')

      // 验证未调用 AI
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证返回原 word（字段未变）
      expect(result.id).toBe('brave')
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      // 验证未写入（update 未被调用）
      expect(callLog.update).toBe(0)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 12. enrichWord 缺失字段 → 调用 aiProvider.enrichSingleWord 并写回 repository
  it('enrichWord 缺失字段 → 调用 AI 并写回 repository', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      importance: 'high',
    }))
    try {
      const result = await enrichWord('brave')

      // 验证调用了 AI
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证写回了缺失字段
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      expect(result.example).toBe('a brave boy')
      // 验证 update 被调用
      expect(callLog.update).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 13. enrichWord AI 失败 → 抛出 Error
  it('enrichWord AI 失败 → 抛出 Error', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '',
      pos: '',
      definition: '',
    })
    installWordMock([word])
    installAIMock(async () => {
      throw new Error('AI service unavailable')
    })
    try {
      await expect(enrichWord('brave')).rejects.toThrow('AI service unavailable')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 14. enrichWord 占位值检测 → 视为缺失并触发 AI 补全
  // 对应用户场景：选词加入生词本时 lookupWord 未命中本地字典返回占位数据
  it('enrichWord 字段为占位值（/-/、未知、暂未收录）→ 触发 AI 补全', async () => {
    const word = makeWord('ocean', {
      word: 'Ocean',
      // 占位值：来自 lookupWord 未命中时的返回
      phonetic: '/-/',
      pos: '未知',
      definition: '（暂未收录该词，可手动加入生词本后续学习）',
      example: '',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Ocean',
      phonetic: '/ˈəʊʃn/',
      pos: 'n.',
      definition: '海洋',
      example: 'the Pacific Ocean',
      importance: 'high',
    }))
    try {
      const result = await enrichWord('ocean')

      // 验证调用了 AI（占位值应触发补全）
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证占位字段已被真实值覆盖
      expect(result.phonetic).toBe('/ˈəʊʃn/')
      expect(result.pos).toBe('n.')
      expect(result.definition).toBe('海洋')
      expect(result.example).toBe('the Pacific Ocean')
      // 验证 update 被调用
      expect(callLog.update).toBeGreaterThanOrEqual(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 15. addToWordbook enrichIfMissing=true 且字段缺失 → 写入后自动调用 enrichWord 补全
  it('addToWordbook enrichIfMissing=true 且字段缺失 → 写入后自动补全', async () => {
    installWordMock([])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      importance: 'high',
    }))
    try {
      const result = await addToWordbook({
        word: 'Brave',
        // 字段缺失，触发 AI 补全
        phonetic: '',
        pos: '',
        definition: '',
        example: '',
        enrichIfMissing: true,
      })

      // 验证调用了 AI（enrichIfMissing 触发 enrichWord）
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证返回的是补全后的实体
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      expect(result.example).toBe('a brave boy')
      // 验证已持久化（add 被调用）
      expect(callLog.add).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 16. addToWordbook enrichIfMissing=true 且字段完整 → 不调用 AI
  it('addToWordbook enrichIfMissing=true 且字段完整 → 不调用 AI', async () => {
    installWordMock([])
    installAIMock(async () => ({ word: 'Brave', phonetic: '', pos: '', definition: '', example: '', importance: 'low' }))
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        enrichIfMissing: true,
      })

      // 验证未调用 AI（字段已完整，enrichWord 直接返回）
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证返回值字段保持原样
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.definition).toBe('勇敢的')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 17. addToWordbook enrichIfMissing=true 且 enrichWord 失败 → 不抛错，返回基础实体
  // 对应 best-effort 语义：AI 补全失败不阻塞加入生词本主流程
  it('addToWordbook enrichIfMissing=true 且 AI 补全失败 → 不抛错返回基础实体', async () => {
    installWordMock([])
    installAIMock(async () => {
      throw new Error('AI service unavailable')
    })
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '',
        pos: '',
        definition: '',
        enrichIfMissing: true,
      })

      // 验证不抛错，返回已写入的基础实体（字段为空但 id 正确）
      expect(result.id).toBe('brave')
      expect(result.word).toBe('Brave')
      // 字段仍为空（AI 补全失败）
      expect(result.phonetic).toBe('')
      // 验证已持久化（add 被调用，主流程未被阻塞）
      expect(callLog.add).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 18. addToWordbook enrichIfMissing=false（默认）→ 不调用 enrichWord
  it('addToWordbook 默认不触发 enrichWord（enrichIfMissing 默认 false）', async () => {
    installWordMock([])
    installAIMock(async () => ({ word: 'Brave', phonetic: '', pos: '', definition: '', example: '', importance: 'low' }))
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '',
        pos: '',
        definition: '',
        // 未传 enrichIfMissing，默认 false
      })

      // 验证未调用 AI
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证返回基础实体（字段为空）
      expect(result.id).toBe('brave')
      expect(result.phonetic).toBe('')
      expect(result.definition).toBe('')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 19. enrichWord 仅 phonetic 缺失 → patch 仅包含 phonetic 字段（SubTask 7.3）
  // 验证 enrichWord 仅写回缺失字段，已存在字段不被覆盖
  it('enrichWord 仅 phonetic 缺失 → patch 仅包含 phonetic，返回更新后的 word', async () => {
    const word = makeWord('test', {
      word: 'test',
      // phonetic 缺失，其余字段完整
      phonetic: '',
      pos: 'n.',
      definition: '测试',
      example: 'This is a test.',
    })
    installWordMock([word])
    // AI 返回完整数据（含所有字段）
    installAIMock(async () => ({
      word: 'test',
      phonetic: '/test/',
      pos: 'n.',
      definition: '测试（AI）',
      example: 'This is a test.（AI）',
      importance: 'high',
    }))
    try {
      const result = await enrichWord('test')

      // 验证调用了 AI
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证 update 被调用一次
      expect(callLog.update).toBe(1)
      // 验证 patch 仅包含 phonetic（pos/definition/example 已存在，不应被覆盖）
      expect(callLog.patches.length).toBe(1)
      expect(Object.keys(callLog.patches[0].patch)).toEqual(['phonetic'])
      expect(callLog.patches[0].patch.phonetic).toBe('/test/')
      // 验证返回的是更新后的 word
      expect(result.id).toBe('test')
      expect(result.phonetic).toBe('/test/')
      // 已有字段保持不变（未被 AI 返回值覆盖）
      expect(result.pos).toBe('n.')
      expect(result.definition).toBe('测试')
      expect(result.example).toBe('This is a test.')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 20. enrichWord 所有字段完整（含 example）→ 直接返回不调用 AI（SubTask 7.3）
  // 验证 isMissingField 全为 false 时短路返回，不触发 AI 调用与 update 写入
  it('enrichWord 所有字段完整（含 example）→ 不调用 AI，直接返回', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/should-not-be-used/',
      pos: 'v.',
      definition: '不应被使用',
      example: 'should not be used',
      importance: 'low',
    }))
    try {
      const result = await enrichWord('brave')

      // 验证未调用 AI（所有字段完整，短路返回）
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证未写入（update 未被调用）
      expect(callLog.update).toBe(0)
      // 验证返回原 word（所有字段保持原值）
      expect(result.id).toBe('brave')
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      expect(result.example).toBe('a brave boy')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // ============ Task 6.5: getWordbook 分页/搜索/排序测试 ============

  // 21. getWordbook 不传参 → 返回全部未掌握单词（向后兼容）
  it('getWordbook 不传参 → 返回全部未掌握单词（含 mastery < 5）', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple', { word: 'apple', mastery: 0, createdAt: now - 3000 }),
      makeWord('banana', { word: 'banana', mastery: 3, createdAt: now - 2000 }),
      // 已掌握单词应被过滤掉
      makeWord('cherry', { word: 'cherry', mastery: 5, createdAt: now - 1000 }),
      makeWord('date', { word: 'date', mastery: 6, createdAt: now }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook()

      // 验证仅返回未掌握单词（mastery < 5）
      expect(result.items.map((w) => w.id)).toEqual(['banana', 'apple'])
      // total 为过滤后的数量
      expect(result.total).toBe(2)
      // 不传 limit 时 limit 等于 total
      expect(result.limit).toBe(2)
      expect(result.offset).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 22. getWordbook limit/offset 分页 → 返回指定页的 items
  it('getWordbook limit/offset 分页 → 返回指定页的 items', async () => {
    const now = Date.now()
    // 5 个未掌握单词，按 createdAt 降序（默认）：e5, e4, e3, e2, e1
    const words: Word[] = [
      makeWord('e1', { word: 'e1', createdAt: now - 4000 }),
      makeWord('e2', { word: 'e2', createdAt: now - 3000 }),
      makeWord('e3', { word: 'e3', createdAt: now - 2000 }),
      makeWord('e4', { word: 'e4', createdAt: now - 1000 }),
      makeWord('e5', { word: 'e5', createdAt: now }),
    ]
    installWordMock(words)
    try {
      // 第一页：limit=2, offset=0 → e5, e4
      const page1 = await getWordbook({ limit: 2, offset: 0 })
      expect(page1.items.map((w) => w.id)).toEqual(['e5', 'e4'])
      expect(page1.total).toBe(5)
      expect(page1.limit).toBe(2)
      expect(page1.offset).toBe(0)

      // 第二页：limit=2, offset=2 → e3, e2
      const page2 = await getWordbook({ limit: 2, offset: 2 })
      expect(page2.items.map((w) => w.id)).toEqual(['e3', 'e2'])
      expect(page2.total).toBe(5)

      // 第三页：limit=2, offset=4 → e1
      const page3 = await getWordbook({ limit: 2, offset: 4 })
      expect(page3.items.map((w) => w.id)).toEqual(['e1'])
      expect(page3.total).toBe(5)
    } finally {
      restoreWordMock()
    }
  })

  // 23. getWordbook keyword 搜索 → 在 word 字段中大小写不敏感模糊匹配
  it('getWordbook keyword 搜索 → word 字段大小写不敏感模糊匹配', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('application', { word: 'application' }),
      makeWord('banana', { word: 'banana' }),
      makeWord('pineapple', { word: 'pineapple' }),
    ]
    installWordMock(words)
    try {
      // 搜索 "app" → 匹配 apple, application, pineapple（includes 匹配）
      const result = await getWordbook({ keyword: 'app' })
      // 默认按 createdAt 降序，但 createdAt 相同（makeWord 默认 now），保持稳定
      // 验证匹配的 id 集合
      expect(new Set(result.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'application', 'pineapple']),
      )
      expect(result.total).toBe(3)

      // 大小写不敏感：搜索 "APP" 应得到相同结果
      const resultUpper = await getWordbook({ keyword: 'APP' })
      expect(new Set(resultUpper.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'application', 'pineapple']),
      )
      expect(resultUpper.total).toBe(3)
    } finally {
      restoreWordMock()
    }
  })

  // 24. getWordbook keyword 为空白 → 不筛选，返回全部
  it('getWordbook keyword 为空白 → 不筛选返回全部', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ keyword: '   ' })
      expect(result.total).toBe(2)
      expect(result.items.length).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 25. getWordbook sortBy='alphabet' → 按字母升序排序
  it("getWordbook sortBy='alphabet' → 按字母升序排序", async () => {
    const words: Word[] = [
      makeWord('cherry', { word: 'cherry' }),
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ sortBy: 'alphabet' })
      expect(result.items.map((w) => w.word)).toEqual(['apple', 'banana', 'cherry'])
    } finally {
      restoreWordMock()
    }
  })

  // 26. getWordbook sortBy='createdAt-desc'（默认）→ 按添加时间降序
  it("getWordbook sortBy='createdAt-desc' → 按添加时间降序", async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('old', { word: 'old', createdAt: now - 3000 }),
      makeWord('new', { word: 'new', createdAt: now }),
      makeWord('mid', { word: 'mid', createdAt: now - 1000 }),
    ]
    installWordMock(words)
    try {
      // 显式传 sortBy
      const result = await getWordbook({ sortBy: 'createdAt-desc' })
      expect(result.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])

      // 不传 sortBy 应使用默认值 'createdAt-desc'
      const defaultResult = await getWordbook()
      expect(defaultResult.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])
    } finally {
      restoreWordMock()
    }
  })

  // 27. getWordbook sortBy='nextReview-asc' → 按下次复习时间升序
  it("getWordbook sortBy='nextReview-asc' → 按下次复习时间升序", async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('late', { word: 'late', nextReview: now + 3000 }),
      makeWord('soon', { word: 'soon', nextReview: now + 500 }),
      makeWord('mid', { word: 'mid', nextReview: now + 1500 }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ sortBy: 'nextReview-asc' })
      expect(result.items.map((w) => w.id)).toEqual(['soon', 'mid', 'late'])
    } finally {
      restoreWordMock()
    }
  })

  // 28. getWordbook onlyFavorite=true → 仅返回 favorite === 1 的单词
  it('getWordbook onlyFavorite=true → 仅返回 favorite === 1 的单词', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple', favorite: 0 }),
      makeWord('banana', { word: 'banana', favorite: 1 }),
      makeWord('cherry', { word: 'cherry' }), // favorite 为 undefined
      makeWord('date', { word: 'date', favorite: 1 }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ onlyFavorite: true })
      expect(new Set(result.items.map((w) => w.id))).toEqual(new Set(['banana', 'date']))
      expect(result.total).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 29. getWordbook 空库 → 返回空 items 和 total=0
  it('getWordbook 空库 → 返回空 items 和 total=0', async () => {
    installWordMock([])
    try {
      const result = await getWordbook({ limit: 20, offset: 0 })
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 30. getWordbook 组合参数：keyword + sortBy + limit + offset
  it('getWordbook 组合参数：keyword + sortBy + limit + offset → 正确分页与排序', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple1', { word: 'apple1', createdAt: now - 5000 }),
      makeWord('banana', { word: 'banana', createdAt: now - 4000 }),
      makeWord('apple2', { word: 'apple2', createdAt: now - 3000 }),
      makeWord('cherry', { word: 'cherry', createdAt: now - 2000 }),
      makeWord('apple3', { word: 'apple3', createdAt: now - 1000 }),
    ]
    installWordMock(words)
    try {
      // 搜索 "apple" + 字母升序 + limit=2 + offset=0
      // 匹配 apple1, apple2, apple3 → 字母升序：apple1, apple2, apple3
      // 分页：第一页 apple1, apple2
      const result = await getWordbook({
        keyword: 'apple',
        sortBy: 'alphabet',
        limit: 2,
        offset: 0,
      })
      expect(result.items.map((w) => w.id)).toEqual(['apple1', 'apple2'])
      expect(result.total).toBe(3)
      expect(result.limit).toBe(2)
      expect(result.offset).toBe(0)

      // 第二页：offset=2 → apple3
      const page2 = await getWordbook({
        keyword: 'apple',
        sortBy: 'alphabet',
        limit: 2,
        offset: 2,
      })
      expect(page2.items.map((w) => w.id)).toEqual(['apple3'])
      expect(page2.total).toBe(3)
    } finally {
      restoreWordMock()
    }
  })

  // 31. getWordbook limit <= 0 → 返回全部（不限制分页）
  it('getWordbook limit <= 0 → 返回全部（不限制分页）', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
      makeWord('cherry', { word: 'cherry' }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ limit: 0 })
      expect(result.items.length).toBe(3)
      expect(result.total).toBe(3)
      // limit <= 0 时 limit 字段等于 total
      expect(result.limit).toBe(3)

      // limit 为负数也应返回全部
      const resultNeg = await getWordbook({ limit: -5 })
      expect(resultNeg.items.length).toBe(3)
      expect(resultNeg.limit).toBe(3)
    } finally {
      restoreWordMock()
    }
  })
})
