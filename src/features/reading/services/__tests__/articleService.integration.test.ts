//
// 验证 articleService → aiProvider → articleRepository 端到端流程：
// 1. 本地缓存命中：articleRepository.getById 返回缓存文章时直接返回，不调用 AI
// 2. AI 生成路径：本地未命中时调用 aiProvider.generateArticle，结果写入本地并返回
// 3. AI 异常降级：aiProvider.generateArticle 抛错时使用兜底素材库返回文章，不抛出错误
// 4. 兜底文章写入本地：AI 失败时兜底文章也会写入 articleRepository（避免下次仍走兜底）
//
// 已迁移到 vitest 风格（globals 模式）
// vitest.config.ts 中通过 define: { 'import.meta.env': '{}' } 注入空 env，
// 各模块访问 VITE_X 变量时返回 undefined（降级为未配置），无需 ESM loader 拦截
//
// Mock 策略：
// 1. import.meta.env 由 vitest.config.ts 的 define 替换为 {}（不读取 .env 文件）
// 2. 直接重写 articleRepository 单例上的 getById / add 方法，使用内存数组作为存储
// 3. 直接重写 aiProvider 单例上的 generateArticle 方法，返回预设结果或抛错
// 4. 业务代码采用静态 import 加载（vitest 已处理 import.meta.env polyfill）

import type { Article } from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'
import { getDailyArticle } from '../articleService'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import { fallbackArticles } from '../../data/fallback-articles'

// ---------- articleRepository 内存 Mock ----------

// 内存存储：模拟 articles 表
let mockStore: Article[] = []

// 保存原始方法引用，便于恢复
const originalGetById = articleRepository.getById
const originalGetByIdLocalFirst = articleRepository.getByIdLocalFirst
const originalAdd = articleRepository.add

// 安装 articleRepository mock：重写 getById / getByIdLocalFirst / add 方法
function installArticleMock(initial: Article[] = []): void {
  mockStore = [...initial]
  articleRepository.getById = async (id: string) =>
    mockStore.find((a) => a.id === id)
  // SWR 模式：getByIdLocalFirst 与 getById 行为一致（测试中不触发后台刷新）
  articleRepository.getByIdLocalFirst = async (id: string) =>
    mockStore.find((a) => a.id === id)
  articleRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Article
    mockStore.push(item)
    return item
  }
}

// 恢复原始方法
function restoreArticleMock(): void {
  articleRepository.getById = originalGetById
  articleRepository.getByIdLocalFirst = originalGetByIdLocalFirst
  articleRepository.add = originalAdd
}

// ---------- aiProvider Mock ----------

// 保存原始方法引用，便于恢复
const originalGenerateArticle = aiProvider.generateArticle

// 安装 aiProvider mock：重写 generateArticle 方法
function installAIProviderMock(
  impl: (date: string, genre?: unknown, topic?: unknown, difficulty?: unknown) =>
    Promise<ArticleGenerationResult>
): void {
  aiProvider.generateArticle = impl as typeof aiProvider.generateArticle
}

// 恢复原始方法
function restoreAIProviderMock(): void {
  aiProvider.generateArticle = originalGenerateArticle
}

// 构造合法的 ArticleGenerationResult（提供合理默认值）
function makeAIResult(overrides: Partial<ArticleGenerationResult> = {}): ArticleGenerationResult {
  return {
    title: 'AI 生成文章标题',
    content: 'AI 生成文章内容 200-300 词',
    translation: 'AI 生成文章翻译',
    genre: 'narrative',
    wordCount: 250,
    topic: 'campus',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [
      {
        word: 'campus',
        phonetic: '/ˈkæmpəs/',
        pos: 'n.',
        definition: '校园',
        example: 'AI 生成例句',
      },
    ],
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('articleService 集成测试', () => {
  // 1. 本地缓存命中：getDailyArticle 直接返回缓存，不调用 AI
  it('本地缓存命中：articleRepository.getById 返回缓存文章时直接返回，不调用 AI', async () => {
    const now = Date.now()
    const cachedArticle: Article = {
      id: '2024-01-15',
      title: '已缓存的文章标题',
      content: '已缓存的文章内容',
      translation: '已缓存的翻译',
      genre: 'narrative',
      wordCount: 200,
      createdAt: now - 86400000,
      updated_at: now - 86400000,
      topic: 'campus',
      difficulty: 'easy',
      lexileRange: { min: 600, max: 700 },
      highlightedWords: [],
    }
    installArticleMock([cachedArticle])
    // 安装 AI mock，若被调用则抛错（缓存命中时不应调用 AI）
    installAIProviderMock(() => {
      throw new Error('缓存命中时不应调用 AI')
    })

    try {
      const result = await getDailyArticle('2024-01-15')
      // 验证返回的是缓存文章
      expect(result.id).toBe('2024-01-15')
      expect(result.title).toBe('已缓存的文章标题')
      expect(result.content).toBe('已缓存的文章内容')
      // 验证本地存储未被修改（未触发 add）
      expect(mockStore.length).toBe(1)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 2. AI 生成路径：本地未命中时调用 AI，结果写入本地并返回
  it('AI 生成路径：本地未命中时调用 aiProvider.generateArticle，结果写入本地并返回', async () => {
    installArticleMock([])
    const aiResult = makeAIResult({
      title: 'AI 生成：校园生活',
      content: 'AI 生成的英文文章内容',
      translation: 'AI 生成的中文翻译',
      genre: 'narrative',
      wordCount: 250,
      topic: 'campus',
      difficulty: 'medium',
      lexileRange: { min: 700, max: 800 },
    })
    installAIProviderMock(async () => aiResult)

    try {
      const result = await getDailyArticle('2024-02-20', {
        topic: 'campus',
        difficulty: 'medium',
      })

      // 验证返回的 Article 由 AI 结果构造
      expect(result.id).toBe('2024-02-20')
      expect(result.title).toBe('AI 生成：校园生活')
      expect(result.content).toBe('AI 生成的英文文章内容')
      expect(result.translation).toBe('AI 生成的中文翻译')
      expect(result.genre).toBe('narrative')
      expect(result.wordCount).toBe(250)
      expect(result.topic).toBe('campus')
      expect(result.difficulty).toBe('medium')
      expect(result.lexileRange).toEqual({ min: 700, max: 800 })
      // 验证 created_at 与 updated_at 被设置（非 undefined）
      expect(typeof result.createdAt).toBe('number')
      expect(typeof result.updated_at).toBe('number')

      // 验证文章已写入本地 articleRepository
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].id).toBe('2024-02-20')
      expect(mockStore[0].title).toBe('AI 生成：校园生活')
      // 写入本地后再次调用应命中缓存
      const cached = await articleRepository.getById('2024-02-20')
      expect(cached).toBeDefined()
      expect(cached!.title).toBe('AI 生成：校园生活')
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 3. AI 异常降级：aiProvider.generateArticle 抛错时使用兜底素材库返回文章
  it('AI 异常降级：aiProvider.generateArticle 抛错时使用兜底素材库返回文章，不抛出错误', async () => {
    installArticleMock([])
    // 安装 AI mock：模拟 AI 接口异常
    installAIProviderMock(() => {
      throw new Error('AI 服务不可用')
    })

    try {
      const result = await getDailyArticle('2024-03-10')

      // 验证返回的是兜底素材库中的文章（标题应匹配 fallbackArticles 中的某篇）
      const fallbackTitles = fallbackArticles.map((a) => a.title)
      expect(fallbackTitles.includes(result.title)).toBe(true)

      // 验证兜底文章的 id 为请求的 date
      expect(result.id).toBe('2024-03-10')
      // 验证兜底文章包含完整字段（topic / difficulty / lexileRange / highlightedWords）
      expect(result.topic).toBeDefined()
      expect(result.difficulty).toBeDefined()
      expect(result.lexileRange).toBeDefined()
      expect(result.highlightedWords).toBeDefined()
      expect(result.highlightedWords!.length).toBeGreaterThan(0)
      // 验证兜底文章字数在 200-300 范围（与硬约束一致）
      expect(result.wordCount).toBeGreaterThanOrEqual(200)
      expect(result.wordCount).toBeLessThanOrEqual(300)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 4. 兜底文章写入本地：AI 失败时兜底文章也写入 articleRepository
  it('兜底文章写入本地：AI 失败时兜底文章也写入 articleRepository，避免下次仍走兜底', async () => {
    installArticleMock([])
    installAIProviderMock(() => {
      throw new Error('AI 服务不可用')
    })

    try {
      const result = await getDailyArticle('2024-04-05')

      // 验证兜底文章已写入本地存储
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].id).toBe('2024-04-05')
      expect(mockStore[0].title).toBe(result.title)

      // 验证写入后再次调用应命中缓存（不再调用 AI）
      // 注意：此时 AI mock 仍会抛错，若被调用则测试失败
      const cached = await getDailyArticle('2024-04-05')
      expect(cached.id).toBe('2024-04-05')
      expect(cached.title).toBe(result.title)
      // 验证本地存储仍只有 1 条记录（缓存命中未触发再次 add）
      expect(mockStore.length).toBe(1)
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })
})
