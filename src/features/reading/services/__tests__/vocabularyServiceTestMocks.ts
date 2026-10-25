// vocabularyService 测试共享 Mock
//
// 重写 articleRepository.update 与 aiProvider 的词汇 / 例句 / emoji / 翻译方法，
// 并提供 localStorage 缓存的读写辅助；由 vocabularyService.cache.test.ts 拆分时抽出。
import type { Article } from '@/shared/types'
import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import { aiProvider } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'

// localStorage 缓存 key 前缀（与 vocabularyService 保持一致）
export const CACHE_KEY_PREFIX = 'ydxl-vocab-'

// ---------- articleRepository mock（记录 update 调用，验证文章实体持久化） ----------

// 记录 update(articleId, patch) 调用
export const updateCalls: Array<{ id: string; vocabulary?: unknown }> = []

// 保存原始方法引用，便于恢复
const originalUpdate = articleRepository.update

export function installArticleRepoMock(): void {
  updateCalls.length = 0
  articleRepository.update = async (id, patch) => {
    updateCalls.push({ id, vocabulary: (patch as { vocabulary?: unknown }).vocabulary })
    return {} as Article
  }
}

export function restoreArticleRepoMock(): void {
  articleRepository.update = originalUpdate
}

// 保存原始方法引用，便于恢复
const originalExtractVocabulary = aiProvider.extractVocabulary
const originalGenerateExampleSentence = aiProvider.generateExampleSentence
const originalGenerateEmojiHint = aiProvider.generateEmojiHint
const originalGenerateTranslation = aiProvider.generateTranslation

// 安装 aiProvider mock
export function installAIMock(options: {
  baseItems: AIVocabularyItem[]
  exampleSentence?: string
  emojiHint?: string[]
  exampleSentenceTranslation?: string
}): void {
  aiProvider.extractVocabulary = async () => options.baseItems
  aiProvider.generateExampleSentence = async () => options.exampleSentence ?? ''
  aiProvider.generateEmojiHint = async () => options.emojiHint ?? []
  aiProvider.generateTranslation = async () => options.exampleSentenceTranslation ?? ''
}

// 恢复原始方法
export function restoreAIMock(): void {
  aiProvider.extractVocabulary = originalExtractVocabulary
  aiProvider.generateExampleSentence = originalGenerateExampleSentence
  aiProvider.generateEmojiHint = originalGenerateEmojiHint
  aiProvider.generateTranslation = originalGenerateTranslation
}

// 清理指定 articleId 的缓存
export function clearCache(articleId: string): void {
  localStorage.removeItem(CACHE_KEY_PREFIX + articleId)
}

// 读取缓存原始 JSON（用于验证字段持久化）
export function readRawCache(articleId: string): unknown {
  const raw = localStorage.getItem(CACHE_KEY_PREFIX + articleId)
  return raw ? JSON.parse(raw) : null
}

// 构造合法 Article（仅包含 extractAndCacheVocabulary 用到的字段）
export function makeArticle(id: string): Article {
  return {
    id,
    title: '测试文章',
    content: 'This is a test article content.',
    translation: '这是一篇测试文章。',
    genre: 'narrative',
    wordCount: 100,
    createdAt: 1000,
    updated_at: 1000,
  }
}

