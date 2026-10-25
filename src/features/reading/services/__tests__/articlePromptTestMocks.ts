// articlePrompt 注入测试共享 Mock
//
// 重写 articleRepository 读写与 aiProvider.generateArticle，
// 并提供文章 / AI 结果构造器；由 articlePromptInjection.test.ts 拆分时抽出。
import type { Article } from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- articleRepository 内存 Mock ----------

// 内存存储：模拟 articles 表
export let mockStore: Article[] = []

// 保存原始方法引用，便于恢复
const originalGetAll = articleRepository.getAll
const originalGetAllLocalFirst = articleRepository.getAllLocalFirst
const originalAdd = articleRepository.add

// 安装 articleRepository mock：重写 getAll / getAllLocalFirst / add 方法
export function installArticleMock(initial: Article[] = []): void {
  mockStore = [...initial]
  articleRepository.getAll = async () => [...mockStore]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  articleRepository.getAllLocalFirst = async () => [...mockStore]
  articleRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Article
    mockStore.push(item)
    return item
  }
}

// 恢复原始方法
export function restoreArticleMock(): void {
  articleRepository.getAll = originalGetAll
  articleRepository.getAllLocalFirst = originalGetAllLocalFirst
  articleRepository.add = originalAdd
}

// ---------- aiProvider Mock ----------

// 保存原始方法引用，便于恢复
const originalGenerateArticle = aiProvider.generateArticle

// 捕获 generateArticle 调用参数
export interface CapturedCall {
  date: string
  genre?: unknown
  topic?: unknown
  difficulty?: unknown
  avoidTopics?: string[]
}

// 安装 aiProvider mock：记录每次调用的参数，返回预设结果
export function installAIProviderMock(
  result: ArticleGenerationResult,
  captured: CapturedCall[],
): void {
  aiProvider.generateArticle = (async (
    date: string,
    genre?: unknown,
    topic?: unknown,
    difficulty?: unknown,
    avoidTopics?: string[],
  ) => {
    captured.push({ date, genre, topic, difficulty, avoidTopics })
    return result
  }) as typeof aiProvider.generateArticle
}

// 恢复原始方法
export function restoreAIProviderMock(): void {
  aiProvider.generateArticle = originalGenerateArticle
}

// ---------- 工厂函数 ----------

// 构造合法的 ArticleGenerationResult（提供合理默认值）
export function makeAIResult(
  overrides: Partial<ArticleGenerationResult> = {},
): ArticleGenerationResult {
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

// 构造合法的 Article（提供合理默认值）
export function makeArticle(overrides: Partial<Article> = {}): Article {
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
