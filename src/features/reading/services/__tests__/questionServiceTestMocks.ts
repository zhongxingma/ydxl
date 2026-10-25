// questionService 测试共享 Mock
//
// 重写 questionRepository 读写与 aiProvider 的题目 / 语法填空生成方法，
// 由 questionService.test.ts 拆分时抽出。
import type { Article, Question } from '@/shared/types'
import type { QuestionGenerationResult } from '@/shared/services/ai'
import { questionRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- questionRepository 内存 Mock ----------

let mockStore: Question[] = []
export let addCallCount = 0

const originalWhereEquals = questionRepository.whereEquals
const originalAdd = questionRepository.add

export function installRepoMock(initial: Question[] = []): void {
  mockStore = [...initial]
  addCallCount = 0
  questionRepository.whereEquals = async (_field, value) =>
    mockStore.filter((q) => q.articleId === (value as string))
  questionRepository.add = async (entity) => {
    addCallCount += 1
    const item = { ...entity, updated_at: Date.now() } as Question
    mockStore.push(item)
    return item
  }
}

export function restoreRepoMock(): void {
  questionRepository.whereEquals = originalWhereEquals
  questionRepository.add = originalAdd
}

// ---------- aiProvider Mock ----------

const originalGenerateQuestions = aiProvider.generateQuestions
const originalGenerateGrammarFill = aiProvider.generateGrammarFillQuestions

export function installAIMock(
  impl: (articleId: string, content: string) => Promise<QuestionGenerationResult[]>,
): void {
  aiProvider.generateQuestions = impl as typeof aiProvider.generateQuestions
}

export function installGrammarAIMock(
  impl: (articleId: string, content: string) => Promise<QuestionGenerationResult[]>,
): void {
  aiProvider.generateGrammarFillQuestions = impl as typeof aiProvider.generateGrammarFillQuestions
}

export function restoreAIMock(): void {
  aiProvider.generateQuestions = originalGenerateQuestions
  aiProvider.generateGrammarFillQuestions = originalGenerateGrammarFill
}

// 构造合法的 Article
export function makeArticle(overrides: Partial<Article> = {}): Article {
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

// 构造合法的 QuestionGenerationResult
export function makeAIQuestion(
  id: string,
  overrides: Partial<QuestionGenerationResult> = {},
): QuestionGenerationResult {
  return {
    id,
    type: 'main_idea',
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Explanation here',
    locationClue: 'paragraph 1',
    ...overrides,
  }
}

// 构造合法的 Question（已持久化形式）
export function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  const now = Date.now()
  return {
    id,
    articleId: '2024-01-01',
    type: 'main_idea',
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Explanation',
    locationClue: 'paragraph 1',
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

