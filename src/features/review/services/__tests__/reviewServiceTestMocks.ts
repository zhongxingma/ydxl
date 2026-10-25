// reviewService 测试共享 Mock
//
// 重写 wordRepository 读写与 reviewRepository.add，
// 由 reviewService.test.ts 拆分时抽出。
import type { Review, Word } from '@/shared/types'
import { wordRepository, reviewRepository } from '@/shared/services'

// 一天的毫秒数（与业务代码保持一致，用于 isOverdue 测试）
export const DAY_MS = 24 * 60 * 60 * 1000

// ---------- wordRepository / reviewRepository 内存 Mock ----------

// 内存存储：模拟 words 表
export let mockWords: Word[] = []

// 保存原始方法引用，便于恢复
const originalWordGetAll = wordRepository.getAll
const originalWordGetAllLocalFirst = wordRepository.getAllLocalFirst
const originalWordGetById = wordRepository.getById
const originalWordGetByIdLocalFirst = wordRepository.getByIdLocalFirst
const originalWordUpdate = wordRepository.update
const originalWordWhereBelowOrEqual = wordRepository.whereBelowOrEqual
const originalWordTriggerRefresh = wordRepository.triggerRefresh
const originalReviewAdd = reviewRepository.add

// 安装 word mock：重写 wordRepository 上的方法
export function installWordMock(words: Word[] = []): void {
  mockWords = [...words]
  wordRepository.getAll = async () => [...mockWords]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  wordRepository.getAllLocalFirst = async () => [...mockWords]
  wordRepository.whereBelowOrEqual = async (field, value) =>
    mockWords.filter((w) => (w[field] as unknown as number) <= (value as unknown as number))
  wordRepository.getById = async (id: string) =>
    mockWords.find((w) => w.id === id)
  // 本地优先读取（SWR 模式）：与 getById 行为一致（测试中不触发后台刷新）
  // applyWeightedReviewResult 使用 getByIdLocalFirst，必须 mock 否则会访问真实 Dexie（IndexedDB 不可用）
  wordRepository.getByIdLocalFirst = async (id: string) =>
    mockWords.find((w) => w.id === id)
  // triggerRefresh 在测试中为 no-op（避免触发后台刷新与 cacheEvents）
  wordRepository.triggerRefresh = () => {}
  wordRepository.update = async (id: string, patch: Partial<Omit<Word, 'updated_at'>>) => {
    const idx = mockWords.findIndex((w) => w.id === id)
    if (idx >= 0) {
      mockWords[idx] = { ...mockWords[idx], ...patch, updated_at: Date.now() } as Word
      return mockWords[idx]
    }
    return { id, updated_at: Date.now(), ...patch } as Word
  }
}

// 安装 review mock：重写 reviewRepository.add（applyWeightedReviewResult 会调用）
export function installReviewMock(): void {
  reviewRepository.add = async (entity) => ({ ...entity, updated_at: Date.now() }) as Review
}

// 恢复原始方法
export function restoreMock(): void {
  wordRepository.getAll = originalWordGetAll
  wordRepository.getAllLocalFirst = originalWordGetAllLocalFirst
  wordRepository.whereBelowOrEqual = originalWordWhereBelowOrEqual
  wordRepository.getById = originalWordGetById
  wordRepository.getByIdLocalFirst = originalWordGetByIdLocalFirst
  wordRepository.update = originalWordUpdate
  wordRepository.triggerRefresh = originalWordTriggerRefresh
  reviewRepository.add = originalReviewAdd
}

// 构造 Word 对象的工厂函数（提供合理默认值，便于测试覆盖）
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
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    stubbornCount: 0,
    stabilityScore: 0,
    ...overrides,
  }
}

