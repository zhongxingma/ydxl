// E2E 用户完整流程 · 完整学习闭环
//
// 覆盖：生成文章 → 标记已读 → 题目生成 → 加入生词 → 复习 → 阅读会话 → 统计
//
// 由 e2e-flow.test.ts 按流程阶段拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateArticle, markAsRead } from '@/features/reading/services/articleService'
import { getQuestionsForArticle } from '@/features/reading/services/questionService'
import { addToWordbook } from '@/features/wordbook/services/wordbookService'
import { applyWeightedReviewResult } from '@/features/review/services/reviewService'
import { recordWordLearned, recordReadingSession } from '@/features/stats/services/statsService'
import { aiProvider } from '@/shared/services/ai'
import { computeContentHash } from '@/shared/utils/contentHash'
import {
  installMock,
  restoreMock,
  makeAIResult,
  todayStr,
  mockArticles,
  mockWords,
  mockSessions,
  mockStats,
} from './e2eFlowTestMocks'

describe('E2E 用户完整流程 · 完整学习闭环', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 7. 完整流程串联：生成文章 → 标记已读 → 题目生成 → 加入生词 → 复习 → 统计
  it('完整流程串联：各 service 协作完成一次完整学习闭环', async () => {
    // === 步骤 1: 生成文章 ===
    const aiResult = makeAIResult({
      title: '校园日常',
      content: 'A day in the campus is wonderful.',
      highlightedWords: [
        {
          word: 'Wonderful',
          phonetic: '/ˈwʌndəfl/',
          pos: 'adj.',
          definition: '极好的',
          example: 'It is wonderful.',
        },
      ],
    })
    aiProvider.generateArticle = async () => aiResult
    const article = await generateArticle({ date: '2024-05-05' })

    // === 步骤 2: 标记已读 ===
    await markAsRead('2024-05-05')
    expect(mockArticles[0].readAt).not.toBeNull()

    // === 步骤 3: 生成题目 ===
    aiProvider.generateQuestions = async () => [
      {
        id: '2024-05-05-1',
        type: 'main_idea',
        stem: 'What is wonderful?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'explanation',
        locationClue: 'paragraph 1',
      },
    ]
    const questions = await getQuestionsForArticle(article)
    expect(questions.length).toBe(1)

    // === 步骤 4: 加入生词本 ===
    const highlighted = article.highlightedWords![0]
    const newWord = await addToWordbook({
      word: highlighted.word,
      phonetic: highlighted.phonetic,
      pos: highlighted.pos,
      definition: highlighted.definition,
      example: highlighted.example,
      sourceArticleId: article.id,
    })
    expect(mockWords.length).toBe(1)

    // === 步骤 5: 复习生词 ===
    await applyWeightedReviewResult(newWord.id, {
      practiceCorrect: 8,
      practiceTotal: 10,
      spellCorrect: 9,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })
    expect(mockWords[0].reviewCount).toBe(1)

    // === 步骤 6: 记录阅读会话 + 更新统计 ===
    await recordReadingSession(article.id, 300, article.wordCount, 1.0)
    await recordWordLearned()

    // 验证 session 已写入
    expect(mockSessions.length).toBe(1)
    expect(mockSessions[0].articleId).toBe(article.id)

    // 验证 stats 已更新（articlesRead >= 1）
    const stats = mockStats.find((s) => s.id === todayStr())
    expect(stats).toBeDefined()
    expect(stats!.articlesRead).toBeGreaterThanOrEqual(1)
    expect(stats!.wordsLearned).toBeGreaterThanOrEqual(1)

    // 验证 contentHash 去重生效：相同内容第二次生成应回退到历史最新
    const dupHash = await computeContentHash(aiResult.title, aiResult.content)
    expect(article.contentHash).toBe(dupHash)
  })
})
