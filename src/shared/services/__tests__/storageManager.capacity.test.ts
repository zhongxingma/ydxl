// storageManager 容量检测
//
// requestPersistentStorage、getStorageEstimate 与 isStorageLow 的支持 / 不支持分支与阈值边界。
// 由 storageManager.test.ts 按职责拆分而来，用例内容与断言未改动。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock repositories 模块（vi.mock 会被提升，同时拦截静态与动态 import）
vi.mock('../repositories', () => ({
  localQuestionRepo: {
    getAll: vi.fn(),
    bulkDelete: vi.fn(),
    delete: vi.fn(),
  },
  localArticleRepo: {
    getAll: vi.fn(),
    bulkDelete: vi.fn(),
    delete: vi.fn(),
  },
}))
import { requestPersistentStorage, getStorageEstimate, isStorageLow } from '../storageManager'
import { setupNavigatorStorage, removeNavigatorStorage, resetStorageTestEnv } from './storageManagerTestHarness'

beforeEach(() => {
  resetStorageTestEnv()
})

afterEach(() => {
  resetStorageTestEnv()
})

// ============ requestPersistentStorage 测试 ============

describe('requestPersistentStorage', () => {
  // 1. 不支持 navigator.storage 时返回 null
  it('不支持 navigator.storage 时返回 null', async () => {
    removeNavigatorStorage()
    const result = await requestPersistentStorage()
    expect(result).toBeNull()
  })

  // 2. 支持时调用 navigator.storage.persist() 并返回其结果
  it('支持时调用 navigator.storage.persist() 并返回其结果', async () => {
    const storage = setupNavigatorStorage({ persist: true })
    const result = await requestPersistentStorage()
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  // 补充：persist 返回 false 时透传
  it('persist 返回 false 时透传 false', async () => {
    const storage = setupNavigatorStorage({ persist: false })
    const result = await requestPersistentStorage()
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(result).toBe(false)
  })
})

// ============ getStorageEstimate 测试 ============

describe('getStorageEstimate', () => {
  // 3. 支持时返回正确 { usage, quota, usageRatio }
  it('支持时返回正确 { usage, quota, usageRatio }', async () => {
    setupNavigatorStorage({
      estimate: { usage: 300, quota: 1000 },
    })
    const result = await getStorageEstimate()
    expect(result).toEqual({
      usage: 300,
      quota: 1000,
      usageRatio: 0.3,
    })
  })

  // 4. 不支持时返回 null
  it('不支持时返回 null', async () => {
    removeNavigatorStorage()
    const result = await getStorageEstimate()
    expect(result).toBeNull()
  })

  // 补充：quota 为 0 时 usageRatio 为 0（避免除零）
  it('quota 为 0 时 usageRatio 为 0', async () => {
    setupNavigatorStorage({
      estimate: { usage: 100, quota: 0 },
    })
    const result = await getStorageEstimate()
    expect(result).toEqual({
      usage: 100,
      quota: 0,
      usageRatio: 0,
    })
  })
})

// ============ isStorageLow 测试 ============

describe('isStorageLow', () => {
  // 5. usageRatio > 0.85 时返回 true
  it('usageRatio > 0.85 时返回 true', async () => {
    setupNavigatorStorage({
      estimate: { usage: 900, quota: 1000 },
    })
    const result = await isStorageLow()
    expect(result).toBe(true)
  })

  // 6. usageRatio <= 0.85 时返回 false
  it('usageRatio <= 0.85 时返回 false', async () => {
    setupNavigatorStorage({
      estimate: { usage: 850, quota: 1000 },
    })
    const result = await isStorageLow()
    expect(result).toBe(false)
  })

  // 7. 不支持时返回 false（不触发清理）
  it('不支持时返回 false', async () => {
    removeNavigatorStorage()
    const result = await isStorageLow()
    expect(result).toBe(false)
  })
})
