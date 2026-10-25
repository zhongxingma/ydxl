// articleService 历史主题注入
//
// getRecentTopics 主题列表与 generateArticle 的 avoidTopics 注入。
// 由 articlePromptInjection.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Article, Topic } from '@/shared/types'
import { articlePrompt } from '@/shared/services/ai/prompts'
import { getRecentTopics, generateArticle } from '../articleService'
import { installArticleMock, restoreArticleMock, installAIProviderMock, restoreAIProviderMock, makeAIResult, makeArticle, type CapturedCall } from './articlePromptTestMocks'

describe('articleService 历史主题注入', () => {
  // 1. getRecentTopics 返回最近 10 篇文章的 topic 列表
  it('getRecentTopics 返回最近 10 篇文章的 topic 列表（按 createdAt 倒序）', async () => {
    // 构造 12 篇文章，createdAt 递增，topic 各不相同
    const topics: Topic[] = [
      'campus',
      'science',
      'culture',
      'biography',
      'travel',
      'sports',
      'technology',
      'nature',
      'campus',
      'science',
      'culture',
      'biography',
    ]
    const articles: Article[] = topics.map((topic, i) =>
      makeArticle({
        id: `2024-01-${String(i + 1).padStart(2, '0')}`,
        topic,
        createdAt: 1000 + i,
      }),
    )
    installArticleMock(articles)

    try {
      const recentTopics = await getRecentTopics(10)

      // 验证返回 10 条（限制 limit=10，共 12 篇取最近 10 篇）
      expect(recentTopics.length).toBe(10)
      // 验证按 createdAt 倒序：最近的是第 12 篇（createdAt=1011），最早取到第 3 篇（createdAt=1002）
      // 第 12 篇 topic=biography, 第 11 篇 topic=culture, 第 10 篇 topic=science
      expect(recentTopics[0]).toBe('biography') // createdAt=1011
      expect(recentTopics[1]).toBe('culture') // createdAt=1010
      expect(recentTopics[2]).toBe('science') // createdAt=1009
      // 最早取到的是第 3 篇（createdAt=1002, topic=culture）
      expect(recentTopics[9]).toBe('culture') // createdAt=1002
    } finally {
      restoreArticleMock()
    }
  })

  // 2. getRecentTopics 在无历史文章时返回空数组
  it('getRecentTopics 在无历史文章时返回空数组', async () => {
    installArticleMock([])

    try {
      const recentTopics = await getRecentTopics(10)
      expect(recentTopics).toEqual([])
    } finally {
      restoreArticleMock()
    }
  })

  // 3. generateArticle 调用时传入 avoidTopics 参数
  it('generateArticle 调用时将历史主题列表作为 avoidTopics 传入 aiProvider', async () => {
    // 历史文章：3 篇，topic 分别为 campus / science / culture
    const historyArticles: Article[] = [
      makeArticle({
        id: '2024-01-01',
        topic: 'campus',
        createdAt: 1000,
      }),
      makeArticle({
        id: '2024-01-02',
        topic: 'science',
        createdAt: 2000,
      }),
      makeArticle({
        id: '2024-01-03',
        topic: 'culture',
        createdAt: 3000,
      }),
    ]
    installArticleMock(historyArticles)

    // AI 返回全新结果（不与历史重复）
    const aiResult = makeAIResult({
      title: '全新主题文章标题',
      content: '全新主题文章内容',
    })
    const captured: CapturedCall[] = []
    installAIProviderMock(aiResult, captured)

    try {
      await generateArticle({ date: '2024-02-02' })

      // 验证 aiProvider.generateArticle 被调用 1 次
      expect(captured.length).toBe(1)
      // 验证 avoidTopics 参数已传入，且为历史文章的 topic 列表（按 createdAt 倒序）
      expect(captured[0].avoidTopics).toBeDefined()
      expect(captured[0].avoidTopics).toEqual(['culture', 'science', 'campus'])
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 4. AI prompt 中包含「请避免...最近生成过的主题」提示文案
  // 注：avoidTopics 注入到 user message 末尾（动态部分），保持 system message 稳定
  it('articlePrompt 在传入 avoidTopics 时 user message 包含「请避免...最近生成过的主题」提示', () => {
    const avoidTopics = ['campus', 'science', 'culture']
    const { system, user } = articlePrompt(
      '2024-02-02',
      undefined,
      undefined,
      undefined,
      avoidTopics,
    )

    // 验证 user message 包含避免重复的提示文案
    expect(user).toContain('请避免以下最近生成过的主题')
    // 验证每个历史主题都被列入提示
    expect(user).toContain('- campus')
    expect(user).toContain('- science')
    expect(user).toContain('- culture')
    // 验证包含「选择不同的主题或角度进行创作」的引导文案
    expect(user).toContain('选择不同的主题或角度进行创作')
    // 验证 system message 保持稳定（不含动态内容，最大化 Context Cache 命中）
    expect(system).not.toContain('请避免以下最近生成过的主题')
    expect(system).not.toContain('- campus')
  })

  // 补充：未传入 avoidTopics 时 user message 不包含避免重复提示
  it('articlePrompt 未传入 avoidTopics 时 user message 不包含避免重复提示', () => {
    const { user } = articlePrompt('2024-02-02')
    expect(user).not.toContain('请避免以下最近生成过的主题')
  })

  // 补充：avoidTopics 为空数组时不注入提示
  it('articlePrompt 传入空 avoidTopics 时不注入避免重复提示', () => {
    const { user } = articlePrompt(
      '2024-02-02',
      undefined,
      undefined,
      undefined,
      [],
    )
    expect(user).not.toContain('请避免以下最近生成过的主题')
  })
})

// 验证 articlePrompt 返回的 user message 中 JSON schema 样例已精简：
// - 不再含枚举值字符串（如 narrative|expository|practical）
// - 字段值为空字符串或 0 占位
// - 字段名与结构保持完整
