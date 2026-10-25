// storageManager 清理策略
//
// cleanupDerivedData 超期清理、enforceQuestionLimit 数量上限与 enforceArticleLimit 未读重复文章清理。
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
import { cleanupDerivedData, enforceArticleLimit, enforceQuestionLimit } from '../storageManager'
import { localQuestionRepo, localArticleRepo } from '../repositories'
import { THIRTY_DAYS_MS, VOCAB_CACHE_PREFIX, makeQuestion, makeArticle, resetStorageTestEnv } from './storageManagerTestHarness'

beforeEach(() => {
  resetStorageTestEnv()
})

afterEach(() => {
  resetStorageTestEnv()
})

// ============ cleanupDerivedData 测试 ============

describe('cleanupDerivedData', () => {
  // 8. 仅清理超期 questions（updated_at < 30 天前），保留未超期的
  it('仅清理超期 questions，保留未超期的', async () => {
    const now = Date.now()
    const expiredTime = now - THIRTY_DAYS_MS - 1000 // 超 30 天
    const recentTime = now - 1000 // 1 秒前
    const questions = [
      makeQuestion({ id: 'q-old-1', updated_at: expiredTime }),
      makeQuestion({ id: 'q-old-2', updated_at: expiredTime }),
      makeQuestion({ id: 'q-recent-1', updated_at: recentTime }),
      makeQuestion({ id: 'q-recent-2', updated_at: now }),
    ]
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      questions,
    )

    const result = await cleanupDerivedData()

    // 验证清理了 2 条超期记录
    expect(result.cleanedQuestions).toBe(2)
    // 验证 bulkDelete 被调用，且参数仅包含超期 ID
    expect(localQuestionRepo.bulkDelete).toHaveBeenCalledTimes(1)
    const deletedIds = (localQuestionRepo.bulkDelete as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string[]
    expect(deletedIds).toEqual(expect.arrayContaining(['q-old-1', 'q-old-2']))
    expect(deletedIds).not.toContain('q-recent-1')
    expect(deletedIds).not.toContain('q-recent-2')
    expect(deletedIds).toHaveLength(2)
  })

  // 9. 不影响 articles/words（localArticleRepo.delete 未被调用）
  it('不影响 articles/words（localArticleRepo 未被调用）', async () => {
    const now = Date.now()
    const questions = [
      makeQuestion({ id: 'q-old', updated_at: now - THIRTY_DAYS_MS - 1000 }),
    ]
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      questions,
    )

    await cleanupDerivedData()

    // 验证 localArticleRepo 的任何方法均未被调用
    expect(localArticleRepo.getAll).not.toHaveBeenCalled()
    expect(localArticleRepo.bulkDelete).not.toHaveBeenCalled()
    expect(localArticleRepo.delete).not.toHaveBeenCalled()
  })

  // 10. 失败时不抛错（mock 抛错，验证函数仍正常返回）
  it('questions 清理失败时不抛错，仍正常返回', async () => {
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('IndexedDB error'),
    )

    // 不应抛错
    const result = await cleanupDerivedData()

    // 验证返回了默认值（0 清理）
    expect(result.cleanedQuestions).toBe(0)
    // vocab 清理仍可独立执行（无 localStorage 数据时为 0）
    expect(result.cleanedVocab).toBe(0)
  })

  // 补充：清理 localStorage 中 ydxl-vocab-* 缓存
  it('清理 localStorage 中 ydxl-vocab-* 缓存', async () => {
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([])
    // 准备 vocab 缓存数据
    localStorage.setItem(VOCAB_CACHE_PREFIX + 'art-1', JSON.stringify([]))
    localStorage.setItem(VOCAB_CACHE_PREFIX + 'art-2', JSON.stringify([]))
    // 非 vocab 缓存，不应被清理
    localStorage.setItem('ydxl-other-key', 'value')

    const result = await cleanupDerivedData()

    expect(result.cleanedVocab).toBe(2)
    expect(localStorage.getItem(VOCAB_CACHE_PREFIX + 'art-1')).toBeNull()
    expect(localStorage.getItem(VOCAB_CACHE_PREFIX + 'art-2')).toBeNull()
    // 非 vocab 缓存保留
    expect(localStorage.getItem('ydxl-other-key')).toBe('value')
  })

  // 补充：无超期数据时返回 0
  it('无超期数据时返回 0', async () => {
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const result = await cleanupDerivedData()
    expect(result.cleanedQuestions).toBe(0)
    expect(result.cleanedVocab).toBe(0)
    // 无数据时不应调用 bulkDelete
    expect(localQuestionRepo.bulkDelete).not.toHaveBeenCalled()
  })

  // 补充：清理 AI 响应缓存中超期项（cleanupExpired 接入）
  it('清理 AI 响应缓存中超期项', async () => {
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([])
    // 写入一条已过期的 AI 缓存（IndexedDB aiCache 表，经 responseCache.setCached）
    const { setCached, computeCacheKey, getCached } = await import('../ai/responseCache')
    const key = await computeCacheKey('test', 'm', 'sys', 'user')
    await setCached(key, 'value', -1, 'test') // ttlMs=-1 使 expiresAt 立即过期

    const result = await cleanupDerivedData()
    // cleanedAiCache 至少为 1（cleanupExpired 清理了 IndexedDB 中的过期项）
    expect(result.cleanedAiCache).toBeGreaterThanOrEqual(1)
    // 过期项应已被清理，读取返回 null
    expect(await getCached(key)).toBeNull()
  })
})

// ============ enforceQuestionLimit 测试 ============

describe('enforceQuestionLimit', () => {
  // 11. 数量超过上限时按 updated_at 升序清理最旧的
  it('数量超过上限时按 updated_at 升序清理最旧的', async () => {
    const now = Date.now()
    // 5 条记录，上限 3，应清理 2 条最旧的
    const questions = [
      makeQuestion({ id: 'q-1', updated_at: 1000 }), // 最旧
      makeQuestion({ id: 'q-2', updated_at: 2000 }), // 次旧
      makeQuestion({ id: 'q-3', updated_at: 3000 }),
      makeQuestion({ id: 'q-4', updated_at: 4000 }),
      makeQuestion({ id: 'q-5', updated_at: now }),
    ]
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      questions,
    )

    const deleted = await enforceQuestionLimit(3)

    // 验证清理了 2 条
    expect(deleted).toBe(2)
    expect(localQuestionRepo.bulkDelete).toHaveBeenCalledTimes(1)
    const deletedIds = (localQuestionRepo.bulkDelete as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string[]
    // 应清理最旧的 q-1 和 q-2
    expect(deletedIds).toEqual(expect.arrayContaining(['q-1', 'q-2']))
    expect(deletedIds).toHaveLength(2)
    // 不应清理较新的
    expect(deletedIds).not.toContain('q-4')
    expect(deletedIds).not.toContain('q-5')
  })

  // 补充：数量未超过上限时不清理
  it('数量未超过上限时不清理', async () => {
    const questions = [makeQuestion({ id: 'q-1' }), makeQuestion({ id: 'q-2' })]
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      questions,
    )

    const deleted = await enforceQuestionLimit(100)

    expect(deleted).toBe(0)
    expect(localQuestionRepo.bulkDelete).not.toHaveBeenCalled()
  })

  // 补充：刚好等于上限时不清理
  it('数量刚好等于上限时不清理', async () => {
    const questions = [
      makeQuestion({ id: 'q-1' }),
      makeQuestion({ id: 'q-2' }),
      makeQuestion({ id: 'q-3' }),
    ]
    ;(localQuestionRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      questions,
    )

    const deleted = await enforceQuestionLimit(3)

    expect(deleted).toBe(0)
    expect(localQuestionRepo.bulkDelete).not.toHaveBeenCalled()
  })
})

// ============ enforceArticleLimit 测试 ============

describe('enforceArticleLimit', () => {
  // 12. 仅清理未读且 contentHash 重复的旧文章，保留已读文章
  it('仅清理未读且 contentHash 重复的旧文章，保留已读文章', async () => {
    const now = Date.now()
    // 构造场景：6 篇文章，上限 4
    // - a1: 已读，hash=H1（保留）
    // - a2: 未读，hash=H1（重复，删除）
    // - a3: 未读，hash=H2（首次出现，保留）
    // - a4: 未读，hash=H2（重复，删除）
    // - a5: 已读，hash=H3（保留）
    // - a6: 未读，hash=H4（首次出现，保留）
    const articles = [
      makeArticle({ id: 'a1', updated_at: 1000, readAt: now, contentHash: 'H1' }),
      makeArticle({ id: 'a2', updated_at: 2000, readAt: null, contentHash: 'H1' }),
      makeArticle({ id: 'a3', updated_at: 3000, readAt: null, contentHash: 'H2' }),
      makeArticle({ id: 'a4', updated_at: 4000, readAt: null, contentHash: 'H2' }),
      makeArticle({ id: 'a5', updated_at: 5000, readAt: now, contentHash: 'H3' }),
      makeArticle({ id: 'a6', updated_at: 6000, readAt: null, contentHash: 'H4' }),
    ]
    ;(localArticleRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      articles,
    )

    const deleted = await enforceArticleLimit(4)

    // 应清理 a2 和 a4（未读且 contentHash 重复）
    expect(deleted).toBe(2)
    expect(localArticleRepo.bulkDelete).toHaveBeenCalledTimes(1)
    const deletedIds = (localArticleRepo.bulkDelete as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string[]
    expect(deletedIds).toEqual(expect.arrayContaining(['a2', 'a4']))
    expect(deletedIds).toHaveLength(2)
    // 已读文章 a1、a5 不应被清理
    expect(deletedIds).not.toContain('a1')
    expect(deletedIds).not.toContain('a5')
  })

  // 补充：未读文章 contentHash 与已读文章重复时，删除未读的
  it('未读文章 contentHash 与已读文章重复时，删除未读的', async () => {
    const now = Date.now()
    // - a1: 未读，hash=H1，updated_at 较早
    // - a2: 已读，hash=H1，updated_at 较晚
    // 上限 1，应删除 a1（未读且 hash 与已读 a2 重复）
    const articles = [
      makeArticle({ id: 'a1', updated_at: 1000, readAt: null, contentHash: 'H1' }),
      makeArticle({ id: 'a2', updated_at: 2000, readAt: now, contentHash: 'H1' }),
    ]
    ;(localArticleRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      articles,
    )

    const deleted = await enforceArticleLimit(1)

    expect(deleted).toBe(1)
    const deletedIds = (localArticleRepo.bulkDelete as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string[]
    expect(deletedIds).toContain('a1')
    expect(deletedIds).not.toContain('a2')
  })

  // 补充：所有文章已读时不清理（即使超过上限）
  it('所有文章已读时不清理（即使超过上限）', async () => {
    const now = Date.now()
    const articles = [
      makeArticle({ id: 'a1', readAt: now, contentHash: 'H1' }),
      makeArticle({ id: 'a2', readAt: now, contentHash: 'H1' }),
      makeArticle({ id: 'a3', readAt: now, contentHash: 'H2' }),
    ]
    ;(localArticleRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      articles,
    )

    const deleted = await enforceArticleLimit(1)

    // 已读文章一律保留，不清理
    expect(deleted).toBe(0)
    expect(localArticleRepo.bulkDelete).not.toHaveBeenCalled()
  })

  // 补充：未读且无 contentHash 的文章不参与去重，保留
  it('未读且无 contentHash 的文章不参与去重，保留', async () => {
    // 无 contentHash 的未读文章即使重复也不清理
    const articles = [
      makeArticle({ id: 'a1', updated_at: 1000, readAt: null, contentHash: undefined }),
      makeArticle({ id: 'a2', updated_at: 2000, readAt: null, contentHash: undefined }),
      makeArticle({ id: 'a3', updated_at: 3000, readAt: null, contentHash: 'H1' }),
      makeArticle({ id: 'a4', updated_at: 4000, readAt: null, contentHash: 'H1' }),
    ]
    ;(localArticleRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      articles,
    )

    // 上限 3，应仅清理 a4（a3 首次出现 H1 保留，a4 重复删除）
    const deleted = await enforceArticleLimit(3)

    expect(deleted).toBe(1)
    const deletedIds = (localArticleRepo.bulkDelete as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string[]
    expect(deletedIds).toContain('a4')
  })

  // 补充：数量未超过上限时不清理
  it('数量未超过上限时不清理', async () => {
    const articles = [
      makeArticle({ id: 'a1', readAt: null, contentHash: 'H1' }),
      makeArticle({ id: 'a2', readAt: null, contentHash: 'H1' }),
    ]
    ;(localArticleRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      articles,
    )

    const deleted = await enforceArticleLimit(100)

    expect(deleted).toBe(0)
    expect(localArticleRepo.bulkDelete).not.toHaveBeenCalled()
  })
})
