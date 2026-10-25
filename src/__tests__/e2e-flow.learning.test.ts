// E2E 用户完整流程 · 生词本与统计
//
// 覆盖：
// 4. wordbookService.addToWordbook 添加生词
// 5. reviewService.applyWeightedReviewResult 应用复习结果更新 word
// 6. statsService.recordArticleRead 与 recordWordLearned 更新统计
//
// 由 e2e-flow.test.ts 按流程阶段拆分而来，用例内容与断言未改动。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateArticle } from '@/features/reading/services/articleService'
import { addToWordbook } from '@/features/wordbook/services/wordbookService'
import { applyWeightedReviewResult } from '@/features/review/services/reviewService'
import { recordArticleRead, recordWordLearned } from '@/features/stats/services/statsService'
import { aiProvider } from '@/shared/services/ai'
import {
  installMock,
  restoreMock,
  makeAIResult,
  todayStr,
  mockWords,
  mockReviews,
  mockStats,
} from './e2eFlowTestMocks'

describe('E2E 用户完整流程 · 生词本与统计', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 4. 加入生词本：从高亮生词中添加新词
  it('加入生词本：addToWordbook 添加新词到 wordRepository', async () => {
    // 先生成带高亮词的文章
    const aiResult = makeAIResult({
      title: '校园生活 3',
      content: 'Unique content 3',
      highlightedWords: [
        {
          word: 'Campus',
          phonetic: '/ˈkæmpəs/',
          pos: 'n.',
          definition: '校园',
          example: 'I love our campus.',
        },
      ],
    })
    aiProvider.generateArticle = async () => aiResult
    const article = await generateArticle({ date: '2024-04-04' })

    // 从高亮词中取第一个加入生词本
    const highlighted = article.highlightedWords![0]
    const word = await addToWordbook({
      word: highlighted.word,
      phonetic: highlighted.phonetic,
      pos: highlighted.pos,
      definition: highlighted.definition,
      example: highlighted.example,
      sourceArticleId: article.id,
    })

    // 验证生词已加入
    expect(word.id).toBe('campus')
    expect(word.word).toBe('Campus')
    expect(word.definition).toBe('校园')
    expect(word.mastery).toBe(0)
    expect(word.sourceArticleId).toBe('2024-04-04')
    expect(mockWords.length).toBe(1)
  })

  // 5. 应用复习结果：applyWeightedReviewResult 更新 word 字段
  it('应用复习结果：复习后 word 字段被更新（mastery/reviewCount）', async () => {
    // 先添加一个生词
    const word = await addToWordbook({
      word: 'Library',
      phonetic: '/ˈlaɪbrəri/',
      pos: 'n.',
      definition: '图书馆',
      example: 'She is in the library.',
    })

    // 初始 mastery=0, reviewCount=0
    expect(word.mastery).toBe(0)
    expect(word.reviewCount).toBe(0)

    // 应用三环节全对的复习结果
    await applyWeightedReviewResult(word.id, {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    // 验证 word 已被更新
    const updated = mockWords.find((w) => w.id === word.id)
    expect(updated).toBeDefined()
    expect(updated!.reviewCount).toBe(1)
    // 全对 → mastery 提升（+1）
    expect(updated!.mastery).toBeGreaterThan(0)
    // 验证 nextReview 已更新（往后推迟）
    expect(updated!.nextReview).toBeGreaterThan(word.nextReview)
    // 验证汇总 Review 记录已写入
    expect(mockReviews.length).toBe(1)
  })

  // 6. 更新统计：recordArticleRead 与 recordWordLearned 累加今日 stats
  it('更新统计：recordArticleRead 与 recordWordLearned 累加今日 stats', async () => {
    const today = todayStr()

    // 初始无 stats
    expect(mockStats.length).toBe(0)

    // 记录阅读一篇文章
    await recordArticleRead(today)
    // 记录学习一个新单词
    await recordWordLearned(today)
    // 记录学习第二个新单词
    await recordWordLearned(today)

    // 验证 stats 已创建并累加
    const stats = mockStats.find((s) => s.id === today)
    expect(stats).toBeDefined()
    expect(stats!.articlesRead).toBe(1)
    expect(stats!.wordsLearned).toBe(2)
    // streak 应被维护（updateStreak 被调用）
    expect(stats!.streak).toBeGreaterThanOrEqual(1)
  })
})
