// articleService 去重机制
//
// AI 生成文章的 contentHash 与标题去重、已读日期复用与重复生成抑制。
// 由 articleDedup.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Article } from '@/shared/types'
import { generateArticle, markAsRead, getReadHistory } from '../articleService'
import { articleRepository } from '@/shared/services'
import { computeContentHash } from '@/shared/utils/contentHash'
import {
  mockStore,
  installArticleMock,
  restoreArticleMock,
  installAIProviderMock,
  restoreAIProviderMock,
  makeAIResult,
  makeArticle,
} from './articleDedupTestMocks'

describe('articleService 去重机制', () => {
describe('articleService 去重机制', () => {
  // 1. 首次生成文章（contentHash 不存在）→ 保存并返回
  it('首次生成文章（contentHash 不存在）→ 保存并返回', async () => {
    installArticleMock([]) // 空历史，不会命中重复
    const aiResult = makeAIResult({
      title: '全新文章标题',
      content: '全新文章内容',
    })
    installAIProviderMock(async () => aiResult)

    try {
      const article = await generateArticle({ date: '2024-01-01' })

      // 验证返回的 Article 由 AI 结果构造
      expect(article.id).toBe('2024-01-01')
      expect(article.title).toBe('全新文章标题')
      // 验证 contentHash 已计算并写入
      expect(article.contentHash).toBeDefined()
      expect(typeof article.contentHash).toBe('string')
      expect(article.contentHash!.length).toBe(16)
      // 验证 readAt 初始为 null
      expect(article.readAt).toBeNull()
      // 验证重点词汇已随文章保存基础版（由高亮生词转换，与重点短语同一时机持久化）
      expect(article.vocabulary).toBeDefined()
      expect(article.vocabulary!).toHaveLength(1)
      expect(article.vocabulary![0].word).toBe('campus')
      expect(article.vocabulary![0].importance).toBe('high')
      // 验证文章已保存到 repository
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].contentHash).toBe(article.contentHash)
      expect(mockStore[0].readAt).toBeNull()
      expect(mockStore[0].vocabulary).toEqual(article.vocabulary)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 2. 生成重复文章（contentHash 命中）→ 重试，第二次生成不重复则保存
  it('生成重复文章（contentHash 命中）→ 重试，第二次不重复则保存', async () => {
    // 第一篇 AI 结果（将与历史文章重复）
    const dupResult = makeAIResult({
      title: '重复文章标题',
      content: '重复文章内容',
    })
    // 第二篇 AI 结果（不重复）
    const uniqueResult = makeAIResult({
      title: '独特文章标题',
      content: '独特文章内容',
    })
    // 历史文章与第一篇 AI 结果内容相同 → contentHash 相同
    const dupHash = await computeContentHash(
      dupResult.title,
      dupResult.content,
    )
    const existingArticle = makeArticle({
      id: '2023-12-31',
      title: '重复文章标题',
      content: '重复文章内容',
      contentHash: dupHash,
    })
    installArticleMock([existingArticle])

    // AI 第一次返回重复结果，第二次返回不重复结果
    let callCount = 0
    installAIProviderMock(async () => {
      callCount++
      return callCount === 1 ? dupResult : uniqueResult
    })

    try {
      const article = await generateArticle({ date: '2024-02-02' })

      // 验证 AI 被调用 2 次（第一次重复，第二次不重复）
      expect(callCount).toBe(2)
      // 验证返回的是不重复的文章
      expect(article.title).toBe('独特文章标题')
      expect(article.id).toBe('2024-02-02')
      // 验证 contentHash 为第二篇结果的指纹
      const expectedHash = await computeContentHash(
        uniqueResult.title,
        uniqueResult.content,
      )
      expect(article.contentHash).toBe(expectedHash)
      // 验证历史文章 + 新文章共 2 条
      expect(mockStore.length).toBe(2)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 3. 3 次重试仍重复 → 返回最新历史文章
  it('3 次重试仍重复 → 返回最新历史文章', async () => {
    // AI 始终返回相同结果（每次都重复）
    const dupResult = makeAIResult({
      title: '总是重复的文章',
      content: '总是重复的内容',
    })
    const dupHash = await computeContentHash(
      dupResult.title,
      dupResult.content,
    )
    // 历史文章：一篇与 AI 结果重复（较早），一篇不重复（最新）
    const olderDupArticle = makeArticle({
      id: '2023-01-01',
      title: '总是重复的文章',
      content: '总是重复的内容',
      contentHash: dupHash,
      createdAt: 1000,
    })
    const latestArticle = makeArticle({
      id: '2024-01-01',
      title: '最新历史文章',
      content: '最新历史内容',
      contentHash: 'other-hash-12345',
      createdAt: 2000,
    })
    installArticleMock([olderDupArticle, latestArticle])

    let callCount = 0
    installAIProviderMock(async () => {
      callCount++
      return dupResult
    })

    try {
      const article = await generateArticle({ date: '2024-03-03' })

      // 验证 AI 被调用 3 次（全部重复）
      expect(callCount).toBe(3)
      // 验证返回的是最新历史文章（按 createdAt 倒序）
      expect(article.id).toBe('2024-01-01')
      expect(article.title).toBe('最新历史文章')
      // 验证未新增文章（3 次重试均未保存）
      expect(mockStore.length).toBe(2)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 4. markAsRead → readAt 写入
  it('markAsRead → readAt 写入', async () => {
    const article = makeArticle({
      id: '2024-01-01',
      title: '待标记文章',
      readAt: null,
    })
    installArticleMock([article])

    try {
      await markAsRead('2024-01-01')

      // 验证 readAt 已写入
      expect(mockStore[0].readAt).not.toBeNull()
      expect(typeof mockStore[0].readAt).toBe('number')
      // 验证 readAt 是合理的时间戳（接近当前时间）
      expect(mockStore[0].readAt!).toBeGreaterThan(Date.now() - 5000)
    } finally {
      restoreArticleMock()
    }
  })

  // 5. markAsRead 写入失败 → 返回 false（调用方可提示保存失败）
  it('markAsRead 写入失败 → 返回 false', async () => {
    installArticleMock([makeArticle({ id: '2024-01-01' })])
    articleRepository.update = async () => {
      throw new Error('network down')
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await expect(markAsRead('2024-01-01')).resolves.toBe(false)
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
      restoreArticleMock()
    }
  })

  // 6. getReadHistory → 按 readAt 倒序返回
  it('getReadHistory → 按 readAt 倒序返回', async () => {
    const a1 = makeArticle({ id: '2024-01-01', readAt: 1000 })
    const a2 = makeArticle({ id: '2024-02-02', readAt: 3000 })
    const a3 = makeArticle({ id: '2024-03-03', readAt: null }) // 未读，应排除
    const a4 = makeArticle({ id: '2024-04-04', readAt: 2000 })
    installArticleMock([a1, a2, a3, a4])

    try {
      const history = await getReadHistory()

      // 验证排除未读文章
      expect(history.length).toBe(3)
      // 验证按 readAt 倒序
      expect(history[0].id).toBe('2024-02-02') // readAt 3000
      expect(history[1].id).toBe('2024-04-04') // readAt 2000
      expect(history[2].id).toBe('2024-01-01') // readAt 1000
    } finally {
      restoreArticleMock()
    }
  })

  // 补充：getReadHistory 支持 limit 参数
  it('getReadHistory 支持 limit 参数限制返回条数', async () => {
    const articles: Article[] = Array.from({ length: 5 }, (_, i) =>
      makeArticle({
        id: `2024-0${i + 1}-01`,
        readAt: 1000 + i,
      }),
    )
    installArticleMock(articles)

    try {
      const history = await getReadHistory(2)
      expect(history.length).toBe(2)
      // 验证取 readAt 最大的两条
      expect(history[0].id).toBe('2024-05-01') // readAt 1004
      expect(history[1].id).toBe('2024-04-01') // readAt 1003
    } finally {
      restoreArticleMock()
    }
  })

  // 6. 标题规范化去重：标题仅大小写/标点不同 → 视为重复，重试
  // 旧逻辑仅比对 contentHash，同标题不同正文的文章会被误判为新文章
  it('标题规范化去重（大小写/标点差异视为重复）→ 重试生成', async () => {
    // 历史文章标题 "Hello, World!"
    const existing = makeArticle({
      id: '2023-12-01',
      title: 'Hello, World!',
      content: '历史文章正文',
      contentHash: 'history-hash-000001',
    })
    installArticleMock([existing])

    // AI 第一次返回 "hello world"（规范化后相同，正文不同 → contentHash 不同）
    const dupTitleResult = makeAIResult({
      title: 'hello world',
      content: '同标题不同正文',
    })
    // AI 第二次返回完全不同的标题
    const uniqueResult = makeAIResult({
      title: 'A Brand New Topic',
      content: '全新正文',
    })
    let callCount = 0
    installAIProviderMock(async () => {
      callCount++
      return callCount === 1 ? dupTitleResult : uniqueResult
    })

    try {
      const article = await generateArticle({ date: '2024-04-04' })

      // 验证 AI 被调用 2 次（第一次标题重复被拒绝）
      expect(callCount).toBe(2)
      // 验证保存的是第二篇（不同标题）
      expect(article.title).toBe('A Brand New Topic')
      expect(mockStore.length).toBe(2)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })
})
})
