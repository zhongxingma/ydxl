// storageManager 测试共享环境
//
// 注入 fake IndexedDB、navigator.storage mock 与实体构造器；
// 由 storageManager.test.ts 拆分时抽出，供「容量检测」与「清理策略」复用。
import { vi } from 'vitest'
import { indexedDB as fakeIndexedDB, IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb'
import type { Article, Question } from '@/shared/types'
import { localQuestionRepo, localArticleRepo } from '../repositories'

// 注入 fake IndexedDB，使 storageManager 接入的 responseCache（IndexedDB）在 jsdom 下可用
// 需同时注入 indexedDB 与 IDBKeyRange（Dexie 范围查询依赖 IDBKeyRange）
if (!('indexedDB' in globalThis)) {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
}
if (!('IDBKeyRange' in globalThis)) {
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: fakeIDBKeyRange,
    configurable: true,
    writable: true,
  })
}

// 30 天毫秒数（与 storageManager 内部常量一致）
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
// vocab 缓存 key 前缀（与 vocabularyService 一致）
export const VOCAB_CACHE_PREFIX = 'ydxl-vocab-'

/**
 * 设置 navigator.storage mock（模拟支持持久化存储的环境）
 */
export function setupNavigatorStorage(opts: {
  persist?: boolean
  estimate?: { usage?: number; quota?: number }
}) {
  const storage = {
    persist: vi.fn().mockResolvedValue(opts.persist ?? true),
    estimate: vi
      .fn()
      .mockResolvedValue(opts.estimate ?? { usage: 0, quota: 0 }),
  }
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
    writable: true,
  })
  return storage
}

/**
 * 移除 navigator.storage（模拟不支持持久化存储的环境）
 */
export function removeNavigatorStorage() {
  Object.defineProperty(navigator, 'storage', {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

/**
 * 构造测试用 Question 实体
 */
export function makeQuestion(overrides: Partial<Question> & { id: string }): Question {
  return {
    articleId: 'art-1',
    type: 'detail',
    stem: 'test stem',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'test',
    locationClue: 'clue',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

/**
 * 构造测试用 Article 实体
 */
export function makeArticle(overrides: Partial<Article> & { id: string }): Article {
  return {
    title: 'test article',
    content: 'content',
    translation: '翻译',
    genre: 'narrative',
    wordCount: 100,
    createdAt: Date.now(),
    updated_at: Date.now(),
    readAt: null,
    contentHash: undefined,
    ...overrides,
  }
}

// 重置所有 mock 的调用记录与返回值，并清空 localStorage
export function resetStorageTestEnv(): void {
  vi.clearAllMocks()
  ;(localQuestionRepo.bulkDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(localArticleRepo.bulkDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  localStorage.clear()
  removeNavigatorStorage()
}
