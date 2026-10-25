// wordbookService 测试共享内存 Mock
//
// 重写 wordRepository / aiProvider 单例上的方法，使用内存数组作为存储；
// 由 wordbookService.test.ts 拆分时抽出，供新增 / 补全 / 查询三组测试复用。
import type { Word } from '@/shared/types'
import type { VocabularyItem } from '@/shared/services/ai'
import { wordRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- wordRepository 内存 Mock ----------

// 内存存储：模拟 words 表
export let mockStore: Word[] = []

// 记录方法调用情况，便于断言持久化行为
export const callLog: {
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
export function installWordMock(initial: Word[] = []): void {
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
export function restoreWordMock(): void {
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
export const mockEnrichSingleWord = vi.fn()

// 保存原始方法引用，便于恢复
const originalEnrichSingleWord = aiProvider.enrichSingleWord

// 安装 aiProvider mock：重写 enrichSingleWord 方法
export function installAIMock(
  impl: (word: string) => Promise<VocabularyItem>,
): void {
  mockEnrichSingleWord.mockReset()
  mockEnrichSingleWord.mockImplementation(impl)
  aiProvider.enrichSingleWord =
    mockEnrichSingleWord as typeof aiProvider.enrichSingleWord
}

// 恢复原始方法
export function restoreAIMock(): void {
  aiProvider.enrichSingleWord = originalEnrichSingleWord
}

// 构造 Word 对象（提供合理默认值）
export function makeWord(id: string, overrides: Partial<Word> = {}): Word {
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
