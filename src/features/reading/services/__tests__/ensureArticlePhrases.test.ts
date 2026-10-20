// ensureArticlePhrases 单元测试（Task 6）
//
// 验证 articleService.ensureArticlePhrases 方法（Task 2 实现）：
// 1. 已有 phrases：传入非空 phrases，验证不调用 aiProvider.extractArticlePhrases，直接返回已有短语
// 2. 缺失 phrases 调用 AI 并写回：传入 undefined phrases，mock AI 返回短语，验证调用 articleRepository.update 写回
// 3. 写回失败降级：mock articleRepository.update 抛错，验证仍返回短语数组（不抛错，仅 console.warn）
// 4. AI 提取失败降级：mock aiProvider.extractArticlePhrases 抛错，验证返回空数组（不抛错）
//
// Mock 策略：参考 articleService.integration.test.ts 的 mock 模式
// - 直接重写 aiProvider 单例上的 extractArticlePhrases 方法
// - 直接重写 articleRepository 单例上的 update 方法

import type { Article, ArticlePhrase } from '@/shared/types'
import { ensureArticlePhrases } from '../articleService'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- aiProvider Mock ----------

const originalExtractArticlePhrases = aiProvider.extractArticlePhrases

function installAIProviderExtractMock(
  impl: (content: string) => Promise<ArticlePhrase[]>
): void {
  aiProvider.extractArticlePhrases = impl as typeof aiProvider.extractArticlePhrases
}

function restoreAIProviderMock(): void {
  aiProvider.extractArticlePhrases = originalExtractArticlePhrases
}

// ---------- articleRepository Mock ----------

const originalUpdate = articleRepository.update

// 安装 articleRepository.update mock，记录调用参数
// articleRepository.update 签名：update(id, patch) => Promise<Article>（返回完整实体）
function installUpdateMock(
  impl: (id: string, patch: Partial<Article>) => Promise<Article>
): { calls: Array<{ id: string; patch: Partial<Article> }> } {
  const calls: Array<{ id: string; patch: Partial<Article> }> = []
  const mockUpdate = async (id: string, patch: Partial<Article>): Promise<Article> => {
    calls.push({ id, patch })
    return impl(id, patch)
  }
  articleRepository.update = mockUpdate as typeof articleRepository.update
  return { calls }
}

function restoreArticleMock(): void {
  articleRepository.update = originalUpdate
}

// 构造合法的 Article（phrases 默认为 undefined）
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '2024-01-01',
    title: 'Test Article',
    content: 'This is a test article content for unit testing.',
    translation: '测试文章',
    genre: 'narrative',
    wordCount: 100,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// 构造合法的 ArticlePhrase
function makePhrase(overrides: Partial<ArticlePhrase> = {}): ArticlePhrase {
  return {
    phrase: 'take care of',
    meaning: '照顾',
    example: 'She takes care of her brother.',
    exampleTranslation: '她照顾她的弟弟。',
    ...overrides,
  }
}

describe('ensureArticlePhrases', () => {
  // 1. 已有 phrases：不调用 AI，直接返回
  it('已有 phrases：不调用 aiProvider.extractArticlePhrases，直接返回已有短语', async () => {
    const existingPhrases: ArticlePhrase[] = [
      makePhrase({ phrase: 'look up', meaning: '查阅' }),
      makePhrase({ phrase: 'give up', meaning: '放弃' }),
    ]
    const article = makeArticle({ phrases: existingPhrases })

    // 安装 AI mock：若被调用则抛错（已有 phrases 时不应调用 AI）
    let aiCallCount = 0
    installAIProviderExtractMock(() => {
      aiCallCount += 1
      throw new Error('已有 phrases 时不应调用 AI')
    })

    try {
      const result = await ensureArticlePhrases(article)

      expect(result).toBe(existingPhrases)
      expect(result.length).toBe(2)
      expect(result[0].phrase).toBe('look up')
      expect(result[1].phrase).toBe('give up')
      expect(aiCallCount).toBe(0)
    } finally {
      restoreAIProviderMock()
    }
  })

  // 2. 缺失 phrases：调用 AI 并写回 articleRepository
  it('缺失 phrases：调用 aiProvider.extractArticlePhrases 并通过 articleRepository.update 写回', async () => {
    const article = makeArticle({ phrases: undefined })
    const extractedPhrases: ArticlePhrase[] = [
      makePhrase({ phrase: 'take care of', meaning: '照顾' }),
      makePhrase({ phrase: 'look forward to', meaning: '期待' }),
    ]
    installAIProviderExtractMock(async () => extractedPhrases)
    // update 返回完整 Article 实体（CachedRemoteRepository.update 签名）
    const updateMock = installUpdateMock(async () => article)

    try {
      const result = await ensureArticlePhrases(article)

      // 返回 AI 提取的短语
      expect(result).toEqual(extractedPhrases)
      expect(result.length).toBe(2)

      // 验证 articleRepository.update 被调用一次，写入 phrases
      expect(updateMock.calls.length).toBe(1)
      expect(updateMock.calls[0].id).toBe(article.id)
      expect(updateMock.calls[0].patch.phrases).toEqual(extractedPhrases)
    } finally {
      restoreAIProviderMock()
      restoreArticleMock()
    }
  })

  // 3. 写回失败：仍返回短语数组（不抛错，仅 console.warn）
  it('写回失败降级：articleRepository.update 抛错时仍返回短语数组', async () => {
    const article = makeArticle({ phrases: undefined })
    const extractedPhrases: ArticlePhrase[] = [
      makePhrase({ phrase: 'take care of', meaning: '照顾' }),
    ]
    installAIProviderExtractMock(async () => extractedPhrases)
    // mock update 抛错
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installUpdateMock(() => {
      throw new Error('数据库写入失败')
    })

    try {
      const result = await ensureArticlePhrases(article)

      // 写回失败不影响返回值，仍返回 AI 提取的短语
      expect(result).toEqual(extractedPhrases)
      expect(result.length).toBe(1)
      // 验证 console.warn 被调用（best-effort 降级日志）
      expect(warnSpy).toHaveBeenCalled()
      // warn 的首个参数包含「短语写回失败」标识，便于排查
      const warnArgs = warnSpy.mock.calls[0]
      expect(warnArgs[0]).toContain('短语写回失败')
    } finally {
      warnSpy.mockRestore()
      restoreAIProviderMock()
      restoreArticleMock()
    }
  })

  // 4. AI 提取失败：返回空数组（不抛错）
  it('AI 提取失败降级：aiProvider.extractArticlePhrases 抛错时返回空数组', async () => {
    const article = makeArticle({ phrases: undefined })
    installAIProviderExtractMock(() => {
      throw new Error('AI 服务不可用')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const result = await ensureArticlePhrases(article)

      // AI 失败不抛错，返回空数组
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
      // 验证 console.warn 被调用（静默降级日志）
      expect(warnSpy).toHaveBeenCalled()
      const warnArgs = warnSpy.mock.calls[0]
      expect(warnArgs[0]).toContain('文章短语提取失败')
    } finally {
      warnSpy.mockRestore()
      restoreAIProviderMock()
    }
  })
})
