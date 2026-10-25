// articleService 兜底素材库去重
//
// AI 失败时选用兜底文章并与本地已读文章去重。
// 由 articleDedup.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Article } from '@/shared/types'
import { getDailyArticle } from '../articleService'
import { getAllFallbackArticles } from '../../data/fallback-articles'
import {
  mockStore,
  installArticleMock,
  installAIProviderMock,
  restoreArticleMock,
  restoreAIProviderMock,
  makeArticle,
  buildFallbackHashes,
  buildAllFallbackSavedArticles,
} from './articleDedupTestMocks'

describe('articleService 兜底素材库去重', () => {
// 1. AI 失败 + 本地为空 → 保存并返回一篇兜底文章（不重复）
it('AI 失败且本地为空 → 保存并返回一篇兜底文章', async () => {
  installArticleMock([])
  installAIProviderMock(async () => {
    throw new Error('AI 服务不可用')
  })

  try {
    const article = await getDailyArticle('2024-05-05')

    // 验证返回的是兜底素材库中的文章
    const fallbackTitles = new Set(getAllFallbackArticles().map((f) => f.title))
    expect(fallbackTitles.has(article.title)).toBe(true)
    // 验证兜底文章的重点词汇已保存基础版（由高亮生词转换，与重点短语同一时机持久化）
    expect(article.vocabulary).toBeDefined()
    expect(article.vocabulary!.length).toBeGreaterThan(0)
    expect(article.vocabulary![0].word).toBeDefined()
    // 验证已保存到本地（contentHash 已计算）
    expect(mockStore.length).toBe(1)
    expect(mockStore[0].contentHash).toBe(article.contentHash)
    expect(mockStore[0].vocabulary).toEqual(article.vocabulary)
  } finally {
    restoreArticleMock()
    restoreAIProviderMock()
  }
})

// 2. AI 失败 + 全部兜底已保存且已读 → 回退最新历史文章，不重复保存
it('全部兜底文章已保存且已读 → 回退最新历史文章', async () => {
  const fallbackArticles = await buildAllFallbackSavedArticles(1000)
  // 一篇最新的普通历史文章（createdAt 最大）
  const latest = makeArticle({
    id: '2024-06-01',
    title: '最新历史文章',
    content: '最新历史内容',
    contentHash: 'latest-hash-0000001',
    createdAt: 2000,
    readAt: 2500,
  })
  installArticleMock([...fallbackArticles, latest])
  installAIProviderMock(async () => {
    throw new Error('AI 服务不可用')
  })

  try {
    const article = await getDailyArticle('2024-06-06')

    // 验证回退到最新历史文章（而非重复保存兜底文章）
    expect(article.id).toBe('2024-06-01')
    expect(article.title).toBe('最新历史文章')
    // 验证未新增文章
    expect(mockStore.length).toBe(fallbackArticles.length + 1)
  } finally {
    restoreArticleMock()
    restoreAIProviderMock()
  }
})

// 3. AI 失败 + 全部兜底已保存但存在未读 → 复用未读的本地兜底文章
it('全部兜底已保存且存在未读 → 复用未读文章（不重复保存）', async () => {
  const allRead = await buildAllFallbackSavedArticles(1000)
  // 将第一篇兜底文章标记为未读
  const unread = { ...allRead[0]!, readAt: null } as Article
  const localArticles = [unread, ...allRead.slice(1)]
  installArticleMock(localArticles)
  installAIProviderMock(async () => {
    throw new Error('AI 服务不可用')
  })

  try {
    const article = await getDailyArticle('2024-07-07')

    // 验证复用的是未读的本地兜底文章
    expect(article.id).toBe(unread.id)
    expect(article.title).toBe(unread.title)
    // 验证未新增文章（不重复保存兜底篇目）
    expect(mockStore.length).toBe(localArticles.length)
  } finally {
    restoreArticleMock()
    restoreAIProviderMock()
  }
})

// 4. AI 失败 + 本地已保存部分兜底 → 只从未保存过的篇目中挑选
it('本地已保存部分兜底 → 只从未保存过的篇目中挑选', async () => {
  // 保存前 3 篇兜底文章（已读），剩余 6 篇未保存
  const saved = (await buildAllFallbackSavedArticles(1000)).slice(0, 3)
  installArticleMock(saved)
  installAIProviderMock(async () => {
    throw new Error('AI 服务不可用')
  })

  try {
    const article = await getDailyArticle('2024-08-08')

    // 验证返回的不是已保存的 3 篇
    const savedHashes = new Set(saved.map((a) => a.contentHash))
    expect(savedHashes.has(article.contentHash)).toBe(false)
    // 验证返回的是兜底素材库中的文章且已保存
    const fallbackHashes = await buildFallbackHashes()
    expect(fallbackHashes.has(article.contentHash!)).toBe(true)
    expect(mockStore.length).toBe(saved.length + 1)
  } finally {
    restoreArticleMock()
    restoreAIProviderMock()
  }
})
})
