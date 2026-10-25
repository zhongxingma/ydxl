// E2E 用户完整流程 · 文章与题目
//
// 覆盖：
// 1. articleService.generateArticle 调用 AIProvider 并通过 contentHash 去重
// 2. articleService.markAsRead 更新 readAt
// 3. questionService.getQuestionsForArticle 调用 AI 生成题目并写入本地
//
// 由 e2e-flow.test.ts 按流程阶段拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateArticle, markAsRead } from '@/features/reading/services/articleService'
import { getQuestionsForArticle } from '@/features/reading/services/questionService'
import { aiProvider } from '@/shared/services/ai'
import { installMock, restoreMock, makeAIResult, mockArticles, mockQuestions } from './e2eFlowTestMocks'

describe('E2E 用户完整流程 · 文章与题目', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 1. 生成文章 → 调用 AIProvider 并通过 contentHash 去重
  it('生成文章：调用 AIProvider 并写入 articleRepository，含 contentHash 去重', async () => {
    const aiResult = makeAIResult({
      title: '校园生活',
      content: 'Campus life is full of joy.',
    })
    aiProvider.generateArticle = async () => aiResult

    const article = await generateArticle({ date: '2024-01-01' })

    // 验证 AI 生成的文章被保存
    expect(article.id).toBe('2024-01-01')
    expect(article.title).toBe('校园生活')
    expect(article.contentHash).toBeDefined()
    expect(article.contentHash!.length).toBe(16)
    expect(article.readAt).toBeNull()
    // 验证 articleRepository 中有 1 篇文章
    expect(mockArticles.length).toBe(1)
    expect(mockArticles[0].contentHash).toBe(article.contentHash)
  })

  // 2. 标记已读 → readAt 写入
  it('标记已读：markAsRead 更新 readAt 时间戳', async () => {
    const aiResult = makeAIResult()
    aiProvider.generateArticle = async () => aiResult

    const article = await generateArticle({ date: '2024-02-02' })
    expect(article.readAt).toBeNull()

    // 标记为已读
    await markAsRead('2024-02-02')

    // 验证 readAt 已写入
    const updated = mockArticles.find((a) => a.id === '2024-02-02')
    expect(updated).toBeDefined()
    expect(updated!.readAt).not.toBeNull()
    expect(typeof updated!.readAt).toBe('number')
  })

  // 3. 答题：调用 AI 生成题目并写入 questionRepository
  it('答题：getQuestionsForArticle 调用 AI 生成题目并写入本地', async () => {
    // 先生成文章
    const aiResult = makeAIResult({ title: '校园生活 2', content: 'Unique content 2' })
    aiProvider.generateArticle = async () => aiResult
    const article = await generateArticle({ date: '2024-03-03' })

    // 模拟 AI 生成题目
    aiProvider.generateQuestions = async () => [
      {
        id: '2024-03-03-1',
        type: 'main_idea',
        stem: 'What is the main idea?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Explanation',
        locationClue: 'paragraph 1',
      },
      {
        id: '2024-03-03-2',
        type: 'detail',
        stem: 'What does the author say about campus?',
        options: ['Big', 'Small', 'Old', 'New'],
        correctIndex: 0,
        explanation: 'Detail explanation',
        locationClue: 'paragraph 2',
      },
    ]

    const questions = await getQuestionsForArticle(article)

    // 验证题目已生成并写入
    expect(questions.length).toBe(2)
    expect(mockQuestions.length).toBe(2)
    expect(questions[0].articleId).toBe('2024-03-03')
    expect(questions[1].articleId).toBe('2024-03-03')
    // 验证 id 排序
    expect(questions[0].id).toBe('2024-03-03-1')
    expect(questions[1].id).toBe('2024-03-03-2')
  })
})
