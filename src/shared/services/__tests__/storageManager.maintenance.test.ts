// storageManager 维护编排与异常兜底
//
// 覆盖场景：
// 1. 存储不紧张：仅检查数量上限，不清理派生数据
// 2. 存储紧张：清理派生数据 + 数量上限 + 紧急清空 AI 缓存
// 3. 紧急清空 AI 缓存失败不抛出
// 4. cleanupDerivedData 内 AI 缓存 / wordLookup 上限清理失败与成功计数
// 5. enforceQuestionLimit / enforceArticleLimit 查询失败返回 0
//
// Mock 策略：mock repositories 与 responseCache，聚焦编排分支。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

vi.mock('../ai/responseCache', () => ({
  cleanupExpired: vi.fn(),
  enforceScenarioLimit: vi.fn(),
  clearCache: vi.fn(),
}))

import {
  cleanupDerivedData,
  enforceArticleLimit,
  enforceQuestionLimit,
  runStorageMaintenance,
} from '../storageManager'
import { localQuestionRepo, localArticleRepo } from '../repositories'
import { cleanupExpired, enforceScenarioLimit, clearCache } from '../ai/responseCache'
import { setupNavigatorStorage, removeNavigatorStorage } from './storageManagerTestHarness'

const questionGetAllMock = vi.mocked(localQuestionRepo.getAll)
const articleGetAllMock = vi.mocked(localArticleRepo.getAll)
const cleanupExpiredMock = vi.mocked(cleanupExpired)
const enforceScenarioLimitMock = vi.mocked(enforceScenarioLimit)
const clearCacheMock = vi.mocked(clearCache)

describe('storageManager 维护编排', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    removeNavigatorStorage()
    questionGetAllMock.mockResolvedValue([])
    articleGetAllMock.mockResolvedValue([])
    cleanupExpiredMock.mockResolvedValue(0)
    enforceScenarioLimitMock.mockResolvedValue(0)
    clearCacheMock.mockResolvedValue(undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    removeNavigatorStorage()
    localStorage.clear()
  })

  it('存储不紧张时仅检查数量上限，不清理派生数据', async () => {
    setupNavigatorStorage({ estimate: { usage: 500, quota: 1000 } })

    await runStorageMaintenance()

    expect(questionGetAllMock).toHaveBeenCalledTimes(1)
    expect(articleGetAllMock).toHaveBeenCalledTimes(1)
    expect(cleanupExpiredMock).not.toHaveBeenCalled()
    expect(enforceScenarioLimitMock).not.toHaveBeenCalled()
    expect(clearCacheMock).not.toHaveBeenCalled()
  })

  it('存储紧张时清理派生数据、检查上限并紧急清空 AI 缓存', async () => {
    setupNavigatorStorage({ estimate: { usage: 900, quota: 1000 } })

    await runStorageMaintenance()

    expect(cleanupExpiredMock).toHaveBeenCalledTimes(1)
    expect(enforceScenarioLimitMock).toHaveBeenCalledWith('wordLookup', 500)
    // cleanupDerivedData 与 enforceQuestionLimit 各查询一次
    expect(questionGetAllMock).toHaveBeenCalledTimes(2)
    expect(articleGetAllMock).toHaveBeenCalledTimes(1)
    expect(clearCacheMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('紧急清空 AI 缓存失败时记录告警且不抛出', async () => {
    setupNavigatorStorage({ estimate: { usage: 900, quota: 1000 } })
    clearCacheMock.mockRejectedValue(new Error('idb failed'))

    await expect(runStorageMaintenance()).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('紧急清空 AI 缓存失败'),
      expect.any(Error)
    )
  })

  it('AI 缓存清理失败时计 0 并告警，其余清理继续', async () => {
    cleanupExpiredMock.mockRejectedValue(new Error('cache failed'))
    enforceScenarioLimitMock.mockResolvedValue(4)

    const result = await cleanupDerivedData()

    expect(result.cleanedAiCache).toBe(0)
    expect(result.cleanedWordLookupOverflow).toBe(4)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AI 缓存清理失败'),
      expect.any(Error)
    )
  })

  it('wordLookup 上限清理失败时计 0 并告警', async () => {
    enforceScenarioLimitMock.mockRejectedValue(new Error('limit failed'))

    const result = await cleanupDerivedData()

    expect(result.cleanedWordLookupOverflow).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('wordLookup 上限清理失败'),
      expect.any(Error)
    )
  })

  it('wordLookup 上限清理成功时返回淘汰数量', async () => {
    enforceScenarioLimitMock.mockResolvedValue(3)

    const result = await cleanupDerivedData()

    expect(result.cleanedWordLookupOverflow).toBe(3)
  })

  it('questions 查询失败时数量上限返回 0 并告警', async () => {
    questionGetAllMock.mockRejectedValue(new Error('query failed'))

    const deleted = await enforceQuestionLimit()

    expect(deleted).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('enforceQuestionLimit 失败'),
      expect.any(Error)
    )
  })

  it('articles 查询失败时数量上限返回 0 并告警', async () => {
    articleGetAllMock.mockRejectedValue(new Error('query failed'))

    const deleted = await enforceArticleLimit()

    expect(deleted).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('enforceArticleLimit 失败'),
      expect.any(Error)
    )
  })

  it('存储估算失败时按不紧张处理并继续检查上限', async () => {
    const storage = setupNavigatorStorage({})
    storage.estimate.mockRejectedValue(new Error('estimate failed'))

    await runStorageMaintenance()

    expect(questionGetAllMock).toHaveBeenCalledTimes(1)
    expect(articleGetAllMock).toHaveBeenCalledTimes(1)
    expect(clearCacheMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getStorageEstimate 失败'),
      expect.any(Error)
    )
  })
})
