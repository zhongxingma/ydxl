// 跨模块流程 1：复习→掌握流转（生词本⇄已掌握模块）
//
// 验证 mastery 字段在 review / wordbook / mastered 三个模块间的数据一致性。
// 由 crossModuleFlow.test.ts 按流程拆分而来，用例内容与断言未改动。

import { addToWordbook, getWordbook } from '@/features/wordbook/services/wordbookService'
import { getMasteredWords } from '@/features/mastered/services/masteredService'
import { applyWeightedReviewResult } from '@/features/review/services/reviewService'
import { mockWords, mockReviews, mockStats, installMock, restoreMock, todayStr } from './crossModuleFlowTestMocks'

describe('跨模块流程 1：复习→掌握流转（生词本⇄已掌握模块）', () => {
  beforeEach(() => {
    installMock()
  })

  afterEach(() => {
    restoreMock()
  })

  // 主流程：添加生词 → 复习 5 次全对达到掌握 → 生词本不再显示 → 已掌握模块显示
  it('添加生词 → 复习 5 次全对达到 mastery=5 → 生词本不再返回 → 已掌握模块返回', async () => {
    // === 步骤 1：添加生词（mastery=0） ===
    const word = await addToWordbook({
      word: 'Master',
      phonetic: '/ˈmɑːstə(r)/',
      pos: 'v.',
      definition: '掌握',
      example: 'I master English.',
    })

    // 验证初始状态：mastery=0，在生词本中，不在已掌握中
    expect(word.id).toBe('master')
    expect(word.mastery).toBe(0)
    expect(word.reviewCount).toBe(0)

    // 初始：生词本包含该词
    const wordbookBefore = await getWordbook()
    expect(wordbookBefore.items.map((w) => w.id)).toContain('master')
    expect(wordbookBefore.total).toBe(1)

    // 初始：已掌握模块不包含该词
    const masteredBefore = await getMasteredWords()
    expect(masteredBefore.items.map((w) => w.id)).not.toContain('master')
    expect(masteredBefore.total).toBe(0)

    // === 步骤 2：复习 5 次，每次三环节全对 → mastery 每次提升 +1 直至 5 ===
    // 全对 → 加权率=1.0 → quality=5 → masteryDelta=+1
    // 起始 mastery=0，5 次复习后 mastery=5
    for (let i = 1; i <= 5; i++) {
      await applyWeightedReviewResult('master', {
        practiceCorrect: 10,
        practiceTotal: 10,
        spellCorrect: 10,
        spellTotal: 10,
        writeCorrect: 10,
        writeTotal: 10,
      })
      const current = mockWords.find((w) => w.id === 'master')
      expect(current).toBeDefined()
      // 验证 mastery 按预期递增（clamp 在 [0,5]）
      expect(current!.mastery).toBe(Math.min(5, i))
      expect(current!.reviewCount).toBe(i)
    }

    // 验证复习完成后 word 字段
    const mastered = mockWords.find((w) => w.id === 'master')
    expect(mastered!.mastery).toBe(5)
    expect(mastered!.reviewCount).toBe(5)
    // nextReview 应被推到未来
    expect(mastered!.nextReview).toBeGreaterThan(Date.now())
    // 汇总 Review 记录应写入 5 条
    expect(mockReviews.length).toBe(5)

    // === 步骤 3：验证生词本不再返回该词（mastery >= 5 被过滤） ===
    const wordbookAfter = await getWordbook()
    expect(wordbookAfter.items.map((w) => w.id)).not.toContain('master')
    expect(wordbookAfter.total).toBe(0)

    // === 步骤 4：验证已掌握模块返回该词 ===
    const masteredAfter = await getMasteredWords()
    expect(masteredAfter.items.map((w) => w.id)).toContain('master')
    expect(masteredAfter.total).toBe(1)
    expect(masteredAfter.items[0].mastery).toBe(5)

    // === 步骤 5：验证统计：今日复习数=5，今日掌握数=1（首次达到 mastery=5） ===
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats).toBeDefined()
    expect(todayStats!.wordsReviewed).toBe(5)
    // recordWordMastered 仅在首次达到 mastery >= 5 时调用一次
    expect(todayStats!.wordsMastered).toBe(1)
  })

  // 边界场景：复习中答错不会让 mastery 达到 5，仍在生词本中
  it('复习中答错（quality=0）→ mastery 不增反减，仍在生词本中，不在已掌握中', async () => {
    // 添加生词
    await addToWordbook({ word: 'Hard', definition: '困难' })

    // 复习 3 次全错 → quality=0 → masteryDelta=-1，mastery 从 0 减到 0（clamp 下限）
    for (let i = 0; i < 3; i++) {
      await applyWeightedReviewResult('hard', {
        practiceCorrect: 0,
        practiceTotal: 10,
        spellCorrect: 0,
        spellTotal: 10,
        writeCorrect: 0,
        writeTotal: 10,
      })
    }

    const word = mockWords.find((w) => w.id === 'hard')
    expect(word!.mastery).toBe(0) // clamp 下限 0
    expect(word!.reviewCount).toBe(3)

    // 仍在生词本中（mastery < 5）
    const wordbook = await getWordbook()
    expect(wordbook.items.map((w) => w.id)).toContain('hard')
    expect(wordbook.total).toBe(1)

    // 不在已掌握中
    const mastered = await getMasteredWords()
    expect(mastered.items.map((w) => w.id)).not.toContain('hard')
    expect(mastered.total).toBe(0)

    // 统计：复习 3 次但未掌握
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats!.wordsReviewed).toBe(3)
    expect(todayStats!.wordsMastered).toBe(0)
  })

  // 边界场景：mastery=4 时复习全对 → 首次达到 5 触发 recordWordMastered
  it('mastery=4 时复习全对 → 首次达到 5 触发 recordWordMastered（仅记录一次）', async () => {
    // 直接预置一个 mastery=4 的单词到 mock 存储
    const now = Date.now()
    mockWords.push({
      id: 'near-master',
      word: 'near-master',
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
      mastery: 4,
      nextReview: now,
      lastReview: now,
      reviewCount: 4,
      interval: 7,
      easeFactor: 2.8,
      createdAt: now,
      updated_at: now,
    })

    // 复习一次全对 → mastery 4 → 5，触发 recordWordMastered
    await applyWeightedReviewResult('near-master', {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    const word = mockWords.find((w) => w.id === 'near-master')
    expect(word!.mastery).toBe(5)

    // 验证首次掌握被记录
    const today = todayStr()
    const todayStats = mockStats.find((s) => s.id === today)
    expect(todayStats!.wordsMastered).toBe(1)

    // 再次复习全对 → mastery 保持 5（clamp 上限），不应再次记录掌握
    await applyWeightedReviewResult('near-master', {
      practiceCorrect: 10,
      practiceTotal: 10,
      spellCorrect: 10,
      spellTotal: 10,
      writeCorrect: 10,
      writeTotal: 10,
    })

    const todayStats2 = mockStats.find((s) => s.id === today)!
    // wordsMastered 仍为 1（不重复计数）
    expect(todayStats2.wordsMastered).toBe(1)
    // wordsReviewed 应为 2
    expect(todayStats2.wordsReviewed).toBe(2)
  })
})

// ====================================================================
// 验证 articleService 与 statsService 间的数据流转
// ====================================================================

