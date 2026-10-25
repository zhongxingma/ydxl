// articleService 去重测试共享 Mock
//
// 重写 articleRepository 读写与 aiProvider.generateArticle，
// 并提供兜底素材库哈希 / 已保存场景构造；由 articleDedup.test.ts 拆分时抽出。
import type { Article } from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import { computeContentHash } from '@/shared/utils/contentHash'
import { getAllFallbackArticles } from '../../data/fallback-articles'

// ---------- articleRepository 内存 Mock ----------

// 内存存储：模拟 articles 表
export let mockStore: Article[] = []

// 保存原始方法引用，便于恢复
const originalGetAll = articleRepository.getAll
const originalGetAllLocalFirst = articleRepository.getAllLocalFirst
const originalAdd = articleRepository.add
const originalUpdate = articleRepository.update
const originalWhereEquals = articleRepository.whereEquals
const originalGetByIdLocalFirst = articleRepository.getByIdLocalFirst

// 安装 articleRepository mock：重写 getAll / getAllLocalFirst / add / update / whereEquals / getByIdLocalFirst 方法
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
  articleRepository.update = async (id, patch) => {
    const idx = mockStore.findIndex((a) => a.id === id)
    if (idx >= 0) {
      mockStore[idx] = { ...mockStore[idx], ...patch, updated_at: Date.now() }
      return mockStore[idx]
    }
    return {} as Article
  }
  // whereEquals 返回空数组：强制去重查询走慢速路径（getAllLocalFirst 全量比对）
  articleRepository.whereEquals = async () => []
  articleRepository.getByIdLocalFirst = async (id: string) =>
    mockStore.find((a) => a.id === id)
}

// 恢复原始方法
export function restoreArticleMock(): void {
  articleRepository.getAll = originalGetAll
  articleRepository.getAllLocalFirst = originalGetAllLocalFirst
  articleRepository.add = originalAdd
  articleRepository.update = originalUpdate
  articleRepository.whereEquals = originalWhereEquals
  articleRepository.getByIdLocalFirst = originalGetByIdLocalFirst
}

// ---------- aiProvider Mock ----------

// 保存原始方法引用，便于恢复
const originalGenerateArticle = aiProvider.generateArticle

// 安装 aiProvider mock：重写 generateArticle 方法
export function installAIProviderMock(
  impl: (
    date: string,
    genre?: unknown,
    topic?: unknown,
    difficulty?: unknown,
  ) => Promise<ArticleGenerationResult>,
): void {
  aiProvider.generateArticle = impl as typeof aiProvider.generateArticle
}

// 恢复原始方法
export function restoreAIProviderMock(): void {
  aiProvider.generateArticle = originalGenerateArticle
}

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

// 为全部兜底文章计算 contentHash（与 saveArticle 相同规则：标题+正文）
export async function buildFallbackHashes(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const f of getAllFallbackArticles()) {
    map.set(await computeContentHash(f.title, f.content), f.title)
  }
  return map
}

// 构造"本地已保存全部兜底文章"的场景（含真实 contentHash）
export async function buildAllFallbackSavedArticles(readAt: number | null): Promise<Article[]> {
  const articles: Article[] = []
  for (const f of getAllFallbackArticles()) {
    const hash = await computeContentHash(f.title, f.content)
    articles.push(
      makeArticle({
        id: `fallback-${hash}`,
        title: f.title,
        content: f.content,
        contentHash: hash,
        readAt,
        createdAt: 1000,
      }),
    )
  }
  return articles
}
