// 跨模块流程 3：阅读→生词流转（词汇缓存→生词本→复习）
//
// 验证词汇提取缓存命中、加入生词本与加权复习结果的端到端流转。
// 由 crossModuleFlow.test.ts 按流程拆分而来，用例内容与断言未改动。

import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'
import { aiProvider } from '@/shared/services/ai'
import { extractAndCacheVocabulary } from '@/features/reading/services/vocabularyService'
import { addToWordbook, getWordbook } from '@/features/wordbook/services/wordbookService'
import { applyWeightedReviewResult } from '@/features/review/services/reviewService'
import { mockWords, mockReviews, mockStats, installMock, restoreMock, todayStr, makeArticle, clearVocabCache, VOCAB_CACHE_KEY_PREFIX } from './crossModuleFlowTestMocks'

describe('跨模块流程 3：阅读→生词流转（词汇缓存→生词本→复习）', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
    // 清理本次测试可能写入的词汇缓存
    clearVocabCache('vocab-article-1')
  })

  // 主流程：阅读文章 → 提取并缓存词汇 → 缓存可读 → 加入生词本 → 复习可练习
  it('阅读文章 → extractAndCacheVocabulary 缓存词汇 → 缓存命中 → addToWordbook → applyWeightedReviewResult', async () => {
    // === 步骤 1：准备文章 ===
    const article = makeArticle({
      id: 'vocab-article-1',
      content: 'The brave soldier fought in the battle.',
    })

    // === 步骤 2：mock AI 提取词汇并调用 extractAndCacheVocabulary ===
    const baseItems: AIVocabularyItem[] = [
      {
        word: 'brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        importance: 'high',
        exampleTranslation: '一个勇敢的男孩',
      },
      {
        word: 'soldier',
        phonetic: '/ˈsəʊldʒə(r)/',
        pos: 'n.',
        definition: '士兵',
        example: 'a brave soldier',
        importance: 'medium',
      },
    ]
    aiProvider.extractVocabulary = async () => baseItems
    aiProvider.generateExampleSentence = async () => 'The brave soldier fought.'
    aiProvider.generateEmojiHint = async () => ['💪']

    const vocabItems = await extractAndCacheVocabulary(article)

    // 验证词汇已提取并增强
    expect(vocabItems).toHaveLength(2)
    expect(vocabItems[0].word).toBe('brave')
    expect(vocabItems[0].exampleSentence).toBe('The brave soldier fought.')
    expect(vocabItems[0].emojiHint).toEqual(['💪'])

    // === 步骤 3：验证缓存已写入且可读（第二次调用应命中缓存，不调用 AI） ===
    // 重写 extractVocabulary 为抛错版本，确保缓存命中时不被调用
    aiProvider.extractVocabulary = async () => {
      throw new Error('缓存命中时不应调用 AI extractVocabulary')
    }
    const cachedItems = await extractAndCacheVocabulary(article)
    expect(cachedItems).toHaveLength(2)
    expect(cachedItems[0].word).toBe('brave')
    // 缓存数据应保留增强字段
    expect(cachedItems[0].exampleSentence).toBe('The brave soldier fought.')

    // === 步骤 4：从词汇缓存中取词加入生词本 ===
    const targetVocab = vocabItems[0]
    const addedWord = await addToWordbook({
      word: targetVocab.word,
      phonetic: targetVocab.phonetic,
      pos: targetVocab.pos,
      definition: targetVocab.definition,
      example: targetVocab.example,
      sourceArticleId: article.id,
    })

    // 验证生词已加入
    expect(addedWord.id).toBe('brave')
    expect(addedWord.word).toBe('brave')
    expect(addedWord.definition).toBe('勇敢的')
    expect(addedWord.mastery).toBe(0)
    expect(addedWord.reviewCount).toBe(0)
    expect(addedWord.sourceArticleId).toBe('vocab-article-1')

    // 验证生词本包含该词
    const wordbook = await getWordbook()
    expect(wordbook.items.map((w) => w.id)).toContain('brave')
    expect(wordbook.total).toBe(1)

    // === 步骤 5：复习该生词（应用复习结果） ===
    await applyWeightedReviewResult('brave', {
      practiceCorrect: 9,
      practiceTotal: 10,
      spellCorrect: 8,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    // 验证复习后 word 字段已更新
    const reviewedWord = mockWords.find((w) => w.id === 'brave')
    expect(reviewedWord).toBeDefined()
    expect(reviewedWord!.reviewCount).toBe(1)
    // 加权率 = (0.9*0.3 + 0.8*0.3 + 1.0*0.4) = 0.27 + 0.24 + 0.4 = 0.91 → quality=5 → masteryDelta=+1
    expect(reviewedWord!.mastery).toBe(1)
    // nextReview 推到未来
    expect(reviewedWord!.nextReview).toBeGreaterThan(Date.now())
    // 汇总 Review 记录已写入
    expect(mockReviews.length).toBe(1)
    expect(mockReviews[0].wordId).toBe('brave')

    // === 步骤 6：验证统计：今日学习单词=1，今日复习=1 ===
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats).toBeDefined()
    expect(todayStats!.wordsLearned).toBe(1)
    expect(todayStats!.wordsReviewed).toBe(1)
  })

  // 边界场景：AI 提取词汇失败 → 返回空数组，不阻塞后续流程
  it('AI 提取词汇失败 → 返回空数组，不抛错（best-effort）', async () => {
    const article = makeArticle({ id: 'vocab-article-1' })
    aiProvider.extractVocabulary = async () => {
      throw new Error('AI 服务不可用')
    }

    const vocabItems = await extractAndCacheVocabulary(article)
    expect(vocabItems).toEqual([])
    // 不应写入缓存
    expect(localStorage.getItem(VOCAB_CACHE_KEY_PREFIX + 'vocab-article-1')).toBeNull()
  })
})
