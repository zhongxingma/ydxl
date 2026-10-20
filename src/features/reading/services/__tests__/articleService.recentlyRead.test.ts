//
// 覆盖场景：
// 1. 仅返回 readAt != null 的已读文章（排除未读与 startedAt 仅有的文章）
// 2. 按 readAt 降序排列（最近阅读的在前）
// 3. limit 参数限制返回条数
// 4. 返回精简字段（id/title/readAt/topic/difficulty/wordCount），不含 content/translation 等大字段
// 5. 查询失败时返回空数组（best-effort，不抛错）
// 6. 无已读文章时返回空数组
//
// Mock 策略：重写 articleRepository 单例上的 getAll 方法，使用内存数组作为存储

import type { Article } from '@/shared/types'
import { getRecentlyReadArticles } from '../articleService'
import { articleRepository } from '@/shared/services'

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

// 构造合法的 Article（提供合理默认值）
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'default-id',
    title: '默认文章标题',
    content: '默认文章内容',
    translation: '默认文章翻译',
    genre: 'narrative',
    wordCount: 250,
    createdAt: 1000,
    updated_at: 1000,
    topic: 'campus',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [],
    contentHash: undefined,
    readAt: null,
    ...overrides,
  }
}

describe('getRecentlyReadArticles 最近已读文章查询', () => {
  // 1. 仅返回 readAt != null 的已读文章
  it('仅返回 readAt != null 的已读文章，排除未读与仅 startedAt 的文章', async () => {
    const read = makeArticle({ id: 'read-1', readAt: 1000 })
    const unread = makeArticle({ id: 'unread-1', readAt: null })
    const startedOnly = makeArticle({ id: 'started-1', readAt: null, startedAt: 500 })
    installArticleMock([read, unread, startedOnly])

    try {
      const result = await getRecentlyReadArticles(10)
      // 仅返回已读完的文章
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('read-1')
    } finally {
      restoreArticleMock()
    }
  })

  // 2. 按 readAt 降序排列
  it('按 readAt 降序排列（最近阅读的在前）', async () => {
    const a1 = makeArticle({ id: 'a1', readAt: 1000 })
    const a2 = makeArticle({ id: 'a2', readAt: 3000 })
    const a3 = makeArticle({ id: 'a3', readAt: 2000 })
    installArticleMock([a1, a2, a3])

    try {
      const result = await getRecentlyReadArticles(10)
      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('a2') // readAt 3000
      expect(result[1].id).toBe('a3') // readAt 2000
      expect(result[2].id).toBe('a1') // readAt 1000
    } finally {
      restoreArticleMock()
    }
  })

  // 3. limit 参数限制返回条数
  it('limit 参数限制返回条数（取 readAt 最大的 N 条）', async () => {
    const articles: Article[] = Array.from({ length: 5 }, (_, i) =>
      makeArticle({
        id: `a${i + 1}`,
        readAt: 1000 + i,
      }),
    )
    installArticleMock(articles)

    try {
      const result = await getRecentlyReadArticles(2)
      expect(result).toHaveLength(2)
      // 取 readAt 最大的两条
      expect(result[0].id).toBe('a5') // readAt 1004
      expect(result[1].id).toBe('a4') // readAt 1003
    } finally {
      restoreArticleMock()
    }
  })

  // 4. 返回精简字段，不含 content/translation 等大字段
  it('返回精简字段（id/title/readAt/topic/difficulty/wordCount），不含 content/translation', async () => {
    const article = makeArticle({
      id: 'full-article',
      title: '完整文章',
      content: '很长的正文内容...',
      translation: '很长的翻译内容...',
      readAt: 5000,
      topic: 'science',
      difficulty: 'hard',
      wordCount: 280,
      lexileRange: { min: 800, max: 900 },
      highlightedWords: [{ word: 'test', phonetic: '', pos: '', definition: '', example: '' }],
      phrases: [{ phrase: 'test phrase', meaning: '测试' }],
    })
    installArticleMock([article])

    try {
      const result = await getRecentlyReadArticles(10)
      expect(result).toHaveLength(1)
      const item = result[0]
      // 验证精简字段存在
      expect(item.id).toBe('full-article')
      expect(item.title).toBe('完整文章')
      expect(item.readAt).toBe(5000)
      expect(item.topic).toBe('science')
      expect(item.difficulty).toBe('hard')
      expect(item.wordCount).toBe(280)
      // 验证大字段不存在于返回对象中
      expect(item).not.toHaveProperty('content')
      expect(item).not.toHaveProperty('translation')
      expect(item).not.toHaveProperty('highlightedWords')
      expect(item).not.toHaveProperty('phrases')
      expect(item).not.toHaveProperty('lexileRange')
    } finally {
      restoreArticleMock()
    }
  })

  // 5. 查询失败时返回空数组（best-effort）
  it('查询失败时返回空数组，不抛出错误', async () => {
    articleRepository.getAll = async () => {
      throw new Error('数据库不可用')
    }

    try {
      const result = await getRecentlyReadArticles(10)
      expect(result).toEqual([])
    } finally {
      restoreArticleMock()
    }
  })

  // 6. 无已读文章时返回空数组
  it('无已读文章时返回空数组', async () => {
    const unread = makeArticle({ id: 'unread-1', readAt: null })
    installArticleMock([unread])

    try {
      const result = await getRecentlyReadArticles(10)
      expect(result).toEqual([])
    } finally {
      restoreArticleMock()
    }
  })

  // 7. topic/difficulty 可选字段缺失时仍能正常返回（兼容历史数据）
  it('topic/difficulty 缺失时仍能正常返回（兼容历史数据）', async () => {
    const article = makeArticle({
      id: 'legacy-article',
      readAt: 1000,
      topic: undefined,
      difficulty: undefined,
    })
    installArticleMock([article])

    try {
      const result = await getRecentlyReadArticles(10)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('legacy-article')
      expect(result[0].topic).toBeUndefined()
      expect(result[0].difficulty).toBeUndefined()
    } finally {
      restoreArticleMock()
    }
  })
})
