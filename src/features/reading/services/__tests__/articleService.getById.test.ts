// getArticleById 单元测试（Task 2）
//
// 覆盖场景：
// 1. 缓存命中：articleRepository.getById 返回完整 Article，验证字段完整透传
// 2. 缓存未命中走服务器：articleRepository.getById 返回服务器数据（模拟本地未命中后服务器命中），验证返回值
// 3. 服务器 404（返回 undefined）：articleRepository.getById 返回 undefined，抛出 ArticleNotFoundError
// 4. 服务器 404（抛出 404 错误）：articleRepository.getById 抛出含 404 的错误，抛出 ArticleNotFoundError
// 5. 完整字段透传：验证返回的 Article 包含 phrases[].exampleTranslation 等新字段
// 6. 非 404 错误向上抛出：articleRepository.getById 抛出 500 错误，getArticleById 原样抛出
// 7. 传入的 id 透传给 articleRepository.getById
//
// Mock 策略：重写 articleRepository 单例上的 getById 方法，使用内存数组作为存储

import type { Article } from '@/shared/types'
import {
  getArticleById,
  ArticleNotFoundError,
} from '../articleService'
import { articleRepository } from '@/shared/services'

// ---------- articleRepository 内存 Mock ----------

// 内存存储：模拟 articles 表
let mockStore: Article[] = []

// 保存原始方法引用，便于恢复
const originalGetById = articleRepository.getById
const originalGetByIdLocalFirst = articleRepository.getByIdLocalFirst

// 安装 articleRepository mock：重写 getById / getByIdLocalFirst 方法
function installArticleMock(initial: Article[] = []): void {
  mockStore = [...initial]
  articleRepository.getById = async (id: string) =>
    mockStore.find((a) => a.id === id)
  // SWR 模式：getByIdLocalFirst 与 getById 行为一致（测试中不触发后台刷新）
  articleRepository.getByIdLocalFirst = async (id: string) =>
    mockStore.find((a) => a.id === id)
}

// 恢复原始方法
function restoreArticleMock(): void {
  articleRepository.getById = originalGetById
  articleRepository.getByIdLocalFirst = originalGetByIdLocalFirst
}

// 构造合法的 Article（提供合理默认值，包含全部字段）
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

describe('getArticleById 根据 id 获取文章', () => {
  // 1. 缓存命中：返回完整 Article，字段完整
  it('缓存命中时返回完整 Article 对象', async () => {
    const article = makeArticle({ id: 'cache-hit', title: '缓存命中文章' })
    installArticleMock([article])

    try {
      const result = await getArticleById('cache-hit')
      expect(result).toBeDefined()
      expect(result.id).toBe('cache-hit')
      expect(result.title).toBe('缓存命中文章')
      expect(result.content).toBe('默认文章内容')
      expect(result.translation).toBe('默认文章翻译')
    } finally {
      restoreArticleMock()
    }
  })

  // 2. 缓存未命中走服务器：articleRepository.getByIdLocalFirst 返回服务器数据后透传
  it('缓存未命中时通过 articleRepository.getByIdLocalFirst 走服务器并返回数据', async () => {
    const serverArticle = makeArticle({
      id: 'server-only',
      title: '服务器文章',
      createdAt: 2000,
    })
    // mock store 为空（本地未命中），但 getByIdLocalFirst 仍返回服务器数据
    // （模拟 CachedRemoteRepository SWR 策略：本地未命中时从服务器拉取）
    mockStore = []
    let calledId: string | undefined
    articleRepository.getByIdLocalFirst = async (id: string) => {
      calledId = id
      return serverArticle
    }

    try {
      const result = await getArticleById('server-only')
      expect(result).toBeDefined()
      expect(result.id).toBe('server-only')
      expect(result.title).toBe('服务器文章')
      // 验证 id 透传给 articleRepository.getByIdLocalFirst
      expect(calledId).toBe('server-only')
    } finally {
      restoreArticleMock()
    }
  })

  // 3. 服务器 404（返回 undefined）：抛出 ArticleNotFoundError
  it('articleRepository.getByIdLocalFirst 返回 undefined 时抛出 ArticleNotFoundError', async () => {
    installArticleMock([]) // 本地与服务器均未命中

    try {
      await expect(getArticleById('not-exist')).rejects.toThrow(
        ArticleNotFoundError,
      )
      await expect(getArticleById('not-exist')).rejects.toThrow(
        '文章 not-exist 不存在',
      )
    } finally {
      restoreArticleMock()
    }
  })

  // 4. 服务器 404（抛出含 404 的错误）：转换为 ArticleNotFoundError
  it('articleRepository.getByIdLocalFirst 抛出 404 错误时转换为 ArticleNotFoundError', async () => {
    articleRepository.getByIdLocalFirst = async () => {
      throw new Error('API /articles/missing failed: 404 Not Found')
    }

    try {
      await expect(getArticleById('missing')).rejects.toThrow(
        ArticleNotFoundError,
      )
      await expect(getArticleById('missing')).rejects.toThrow(
        '文章 missing 不存在',
      )
    } finally {
      restoreArticleMock()
    }
  })

  // 5. 完整字段透传：验证返回的 Article 包含 phrases[].exampleTranslation 等新字段
  it('完整字段透传：包含 phrases[].exampleTranslation 等全部字段', async () => {
    const fullArticle = makeArticle({
      id: 'full-fields',
      title: '完整字段文章',
      content: '完整正文内容',
      translation: '完整翻译内容',
      genre: 'expository',
      wordCount: 320,
      createdAt: 5000,
      updated_at: 5100,
      topic: 'science',
      difficulty: 'hard',
      lexileRange: { min: 800, max: 900 },
      highlightedWords: [
        {
          word: 'phenomenon',
          phonetic: '/fɪˈnɒmɪnən/',
          pos: 'n.',
          definition: '现象',
          example: 'This is a common phenomenon.',
        },
      ],
      phrases: [
        {
          phrase: 'in terms of',
          meaning: '就……而言',
          example: 'In terms of cost, this is cheap.',
          exampleTranslation: '就成本而言，这很便宜。',
        },
        {
          phrase: 'break down',
          meaning: '分解；出故障',
          // 历史数据可能缺失 example/exampleTranslation
        },
      ],
      contentHash: 'abc1234567890def',
      readAt: 6000,
      startedAt: 5500,
    })
    installArticleMock([fullArticle])

    try {
      const result = await getArticleById('full-fields')
      // 验证基础字段
      expect(result.id).toBe('full-fields')
      expect(result.title).toBe('完整字段文章')
      expect(result.content).toBe('完整正文内容')
      expect(result.translation).toBe('完整翻译内容')
      expect(result.genre).toBe('expository')
      expect(result.wordCount).toBe(320)
      expect(result.createdAt).toBe(5000)
      expect(result.updated_at).toBe(5100)
      // 验证可选分类字段
      expect(result.topic).toBe('science')
      expect(result.difficulty).toBe('hard')
      expect(result.lexileRange).toEqual({ min: 800, max: 900 })
      // 验证高亮生词字段
      expect(result.highlightedWords).toHaveLength(1)
      expect(result.highlightedWords?.[0].word).toBe('phenomenon')
      // 验证重点短语字段（含 exampleTranslation 新字段）
      expect(result.phrases).toHaveLength(2)
      expect(result.phrases?.[0].phrase).toBe('in terms of')
      expect(result.phrases?.[0].meaning).toBe('就……而言')
      expect(result.phrases?.[0].example).toBe('In terms of cost, this is cheap.')
      expect(result.phrases?.[0].exampleTranslation).toBe('就成本而言，这很便宜。')
      // 第二个短语缺失 example/exampleTranslation 也能透传
      expect(result.phrases?.[1].phrase).toBe('break down')
      expect(result.phrases?.[1].example).toBeUndefined()
      expect(result.phrases?.[1].exampleTranslation).toBeUndefined()
      // 验证其他字段
      expect(result.contentHash).toBe('abc1234567890def')
      expect(result.readAt).toBe(6000)
      expect(result.startedAt).toBe(5500)
    } finally {
      restoreArticleMock()
    }
  })

  // 6. 非 404 错误向上抛出（不静默吞错）
  it('articleRepository.getByIdLocalFirst 抛出非 404 错误时原样向上抛出', async () => {
    const serverError = new Error('API /articles/x failed: 500 Internal Server Error')
    articleRepository.getByIdLocalFirst = async () => {
      throw serverError
    }

    try {
      await expect(getArticleById('x')).rejects.toBe(serverError)
    } finally {
      restoreArticleMock()
    }
  })

  // 7. ArticleNotFoundError 为 Error 子类，name 正确
  it('ArticleNotFoundError 是 Error 子类且 name 正确', () => {
    const err = new ArticleNotFoundError('abc')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ArticleNotFoundError)
    expect(err.name).toBe('ArticleNotFoundError')
    expect(err.message).toBe('文章 abc 不存在')
  })
})
