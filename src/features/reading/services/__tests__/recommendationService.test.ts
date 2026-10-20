//
// 测试范围：
// 1. 无历史时返回最近未读文章（按 createdAt 倒序）
// 2. 有历史时按相关度排序（同 topic +3 优先于同 genre +2 优先于同 difficulty +1）
// 3. 全部已读时返回空数组
// 4. 同分时按 createdAt 倒序
// 5. 推荐池不足 limit 时返回实际数量
// 6. 过滤已读文章（readAt != null 的不出现在推荐中）
// 7. limit 默认为 6
//
// Mock 策略：重写 articleRepository 单例上的 getAll 方法，使用内存数组作为存储
// 参考 articleDedup.test.ts / wordbookService.test.ts 的 mock 模式

import type { Article } from '@/shared/types'
import { articleRepository } from '@/shared/services'
import { getRecommendedArticles } from '../recommendationService'

// ---------- articleRepository 内存 Mock ----------

// 内存存储：模拟 articles 表
let mockStore: Article[] = []

// 保存原始方法引用，便于恢复
const originalGetAll = articleRepository.getAll
const originalGetAllLocalFirst = articleRepository.getAllLocalFirst

// 安装 articleRepository mock：重写 getAll / getAllLocalFirst 方法
function installArticleMock(initial: Article[] = []): void {
  mockStore = [...initial]
  articleRepository.getAll = async () => [...mockStore]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  articleRepository.getAllLocalFirst = async () => [...mockStore]
}

// 恢复原始方法
function restoreArticleMock(): void {
  articleRepository.getAll = originalGetAll
  articleRepository.getAllLocalFirst = originalGetAllLocalFirst
}

// 构造 Article 对象（提供合理默认值）
function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  const now = Date.now()
  return {
    id,
    updated_at: now,
    title: `Article ${id}`,
    content: 'This is test article content.',
    translation: '测试文章内容',
    genre: 'narrative',
    wordCount: 100,
    createdAt: now,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('recommendationService', () => {
  afterEach(() => {
    restoreArticleMock()
  })

  // 1. 无历史时返回最近未读文章（按 createdAt 倒序）
  it('无历史时返回最近未读文章（按 createdAt 倒序）', async () => {
    const articles: Article[] = [
      makeArticle('a1', { createdAt: 1000 }),
      makeArticle('a2', { createdAt: 3000 }),
      makeArticle('a3', { createdAt: 2000 }),
    ]
    installArticleMock(articles)

    const result = await getRecommendedArticles()

    // 无历史时按 createdAt 倒序返回
    expect(result.map((a) => a.id)).toEqual(['a2', 'a3', 'a1'])
  })

  // 2. 有历史时按相关度排序（同 topic +3 优先于同 genre +2 优先于同 difficulty +1）
  it('有历史时按相关度排序：topic(+3) > genre(+2) > difficulty(+1)', async () => {
    // 历史文章：topic=science, genre=expository, difficulty=medium（已读完 → readAt != null）
    const history = makeArticle('hist', {
      topic: 'science',
      genre: 'expository',
      difficulty: 'medium',
      createdAt: 5000,
      readAt: 6000,
    })
    // 候选文章（均未读，readAt 为 null）
    // +3：同 topic
    const candidateTopic = makeArticle('c-topic', {
      topic: 'science',
      genre: 'narrative',
      difficulty: 'easy',
      createdAt: 100,
    })
    // +2：同 genre（topic 不同）
    const candidateGenre = makeArticle('c-genre', {
      topic: 'campus',
      genre: 'expository',
      difficulty: 'easy',
      createdAt: 100,
    })
    // +1：同 difficulty（topic/genre 均不同）
    const candidateDifficulty = makeArticle('c-diff', {
      topic: 'campus',
      genre: 'narrative',
      difficulty: 'medium',
      createdAt: 100,
    })
    // +0：完全无关
    const candidateNone = makeArticle('c-none', {
      topic: 'campus',
      genre: 'narrative',
      difficulty: 'easy',
      createdAt: 100,
    })
    installArticleMock([
      history,
      candidateTopic,
      candidateGenre,
      candidateDifficulty,
      candidateNone,
    ])

    const result = await getRecommendedArticles()

    // 期望顺序：topic(3) > genre(2) > difficulty(1) > none(0)
    expect(result.map((a) => a.id)).toEqual([
      'c-topic',
      'c-genre',
      'c-diff',
      'c-none',
    ])
  })

  // 3. 全部已读时返回空数组
  it('全部已读时返回空数组', async () => {
    const articles: Article[] = [
      makeArticle('a1', { readAt: 1000 }),
      makeArticle('a2', { readAt: 2000 }),
    ]
    installArticleMock(articles)

    const result = await getRecommendedArticles()

    expect(result).toEqual([])
  })

  // 4. 同分时按 createdAt 倒序
  it('同分时按 createdAt 倒序', async () => {
    // 历史文章：topic=science，已读完 → 构建 historyTopics = {'science'}
    const history = makeArticle('hist', {
      topic: 'science',
      genre: 'narrative',
      difficulty: 'easy',
      createdAt: 5000,
      readAt: 6000,
    })
    // 两个同分（均为 +3 同 topic）但 createdAt 不同
    const newer = makeArticle('newer', {
      topic: 'science',
      genre: 'narrative',
      difficulty: 'easy',
      createdAt: 3000,
    })
    const older = makeArticle('older', {
      topic: 'science',
      genre: 'narrative',
      difficulty: 'easy',
      createdAt: 1000,
    })
    installArticleMock([history, newer, older])

    const result = await getRecommendedArticles()

    // 同分时 newer（createdAt=3000）排在 older（createdAt=1000）前
    expect(result.map((a) => a.id)).toEqual(['newer', 'older'])
  })

  // 5. 推荐池不足 limit 时返回实际数量
  it('推荐池不足 limit 时返回实际数量', async () => {
    const articles: Article[] = [
      makeArticle('a1', { createdAt: 1000 }),
      makeArticle('a2', { createdAt: 2000 }),
      makeArticle('a3', { createdAt: 3000 }),
    ]
    installArticleMock(articles)

    // limit=10，但只有 3 篇未读
    const result = await getRecommendedArticles(10)

    expect(result).toHaveLength(3)
    expect(result.map((a) => a.id)).toEqual(['a3', 'a2', 'a1'])
  })

  // 6. 过滤已读文章（readAt != null 的不出现在推荐中）
  it('过滤已读文章：readAt != null 的不出现在推荐中', async () => {
    const articles: Article[] = [
      makeArticle('unread1', { createdAt: 1000, readAt: null }),
      makeArticle('read1', { createdAt: 2000, readAt: 2500 }),
      makeArticle('unread2', { createdAt: 3000, readAt: null }),
      makeArticle('read2', { createdAt: 4000, readAt: 4500 }),
    ]
    installArticleMock(articles)

    const result = await getRecommendedArticles()

    // 只包含未读文章（readAt 为 null），且按 createdAt 倒序
    expect(result.map((a) => a.id)).toEqual(['unread2', 'unread1'])
  })

  // 7. limit 默认为 6
  it('limit 默认为 6', async () => {
    // 10 篇未读文章，无历史
    const articles: Article[] = Array.from({ length: 10 }, (_, i) =>
      makeArticle(`a${i}`, { createdAt: i * 1000 }),
    )
    installArticleMock(articles)

    // 不传 limit，使用默认值
    const result = await getRecommendedArticles()

    // 默认 limit=6
    expect(result).toHaveLength(6)
    // 按 createdAt 倒序，最新的在前
    expect(result[0].id).toBe('a9')
    expect(result[5].id).toBe('a4')
  })
})
