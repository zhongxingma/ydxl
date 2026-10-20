// 复习服务（reviewService）单元测试
//
// 测试范围：
// - getStubbornWords 返回 stubbornCount >= 3 的词并按 desc 排序
// - getStubbornWords 不返回 stubbornCount < 3 的词
// - getTodayReviewQueueInfo 中顽固词排在前面（stubbornCount desc）
// - isOverdue 判断逻辑（nextReview 早于 1 天前 → true；今天 → false；未来 → false）
//
// 已迁移到 vitest 风格（globals 模式）
// vitest.config.ts 中通过 define: { 'import.meta.env': '{}' } 注入空 env，
// supabase.ts 等模块访问 VITE_X 变量时返回 undefined（降级为未配置），无需 ESM loader 拦截
//
// Mock 策略：
// 1. import.meta.env 由 vitest.config.ts 的 define 替换为 {}（不读取 .env 文件）
// 2. 直接重写 wordRepository / reviewRepository 单例上的方法，使用内存数组作为存储
// 3. 业务代码采用静态 import 加载（vitest 已处理 import.meta.env polyfill）

import type { Review, Word } from '@/shared/types'
import {
  getStubbornWords,
  getTodayReviewQueueInfo,
  isOverdue,
  applyWeightedReviewResult,
} from '../reviewService'
import { wordRepository, reviewRepository } from '@/shared/services'

// 一天的毫秒数（与业务代码保持一致，用于 isOverdue 测试）
const DAY_MS = 24 * 60 * 60 * 1000

// ---------- wordRepository / reviewRepository 内存 Mock ----------

// 内存存储：模拟 words 表
let mockWords: Word[] = []

// 保存原始方法引用，便于恢复
const originalWordGetAll = wordRepository.getAll
const originalWordGetAllLocalFirst = wordRepository.getAllLocalFirst
const originalWordGetById = wordRepository.getById
const originalWordGetByIdLocalFirst = wordRepository.getByIdLocalFirst
const originalWordUpdate = wordRepository.update
const originalWordWhereBelowOrEqual = wordRepository.whereBelowOrEqual
const originalWordTriggerRefresh = wordRepository.triggerRefresh
const originalReviewAdd = reviewRepository.add

// 安装 word mock：重写 wordRepository 上的方法
function installWordMock(words: Word[] = []): void {
  mockWords = [...words]
  wordRepository.getAll = async () => [...mockWords]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  wordRepository.getAllLocalFirst = async () => [...mockWords]
  wordRepository.whereBelowOrEqual = async (field, value) =>
    mockWords.filter((w) => (w[field] as unknown as number) <= (value as unknown as number))
  wordRepository.getById = async (id: string) =>
    mockWords.find((w) => w.id === id)
  // 本地优先读取（SWR 模式）：与 getById 行为一致（测试中不触发后台刷新）
  // applyWeightedReviewResult 使用 getByIdLocalFirst，必须 mock 否则会访问真实 Dexie（IndexedDB 不可用）
  wordRepository.getByIdLocalFirst = async (id: string) =>
    mockWords.find((w) => w.id === id)
  // triggerRefresh 在测试中为 no-op（避免触发后台刷新与 cacheEvents）
  wordRepository.triggerRefresh = () => {}
  wordRepository.update = async (id: string, patch: Partial<Omit<Word, 'updated_at'>>) => {
    const idx = mockWords.findIndex((w) => w.id === id)
    if (idx >= 0) {
      mockWords[idx] = { ...mockWords[idx], ...patch, updated_at: Date.now() } as Word
      return mockWords[idx]
    }
    return { id, updated_at: Date.now(), ...patch } as Word
  }
}

// 安装 review mock：重写 reviewRepository.add（applyWeightedReviewResult 会调用）
function installReviewMock(): void {
  reviewRepository.add = async (entity) => ({ ...entity, updated_at: Date.now() }) as Review
}

// 恢复原始方法
function restoreMock(): void {
  wordRepository.getAll = originalWordGetAll
  wordRepository.getAllLocalFirst = originalWordGetAllLocalFirst
  wordRepository.whereBelowOrEqual = originalWordWhereBelowOrEqual
  wordRepository.getById = originalWordGetById
  wordRepository.getByIdLocalFirst = originalWordGetByIdLocalFirst
  wordRepository.update = originalWordUpdate
  wordRepository.triggerRefresh = originalWordTriggerRefresh
  reviewRepository.add = originalReviewAdd
}

// 构造 Word 对象的工厂函数（提供合理默认值，便于测试覆盖）
function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id,
    word: id,
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    stubbornCount: 0,
    stabilityScore: 0,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('reviewService', () => {
  // 1. getStubbornWords 返回 stubbornCount >= 3 的词（按 desc 排序）
  it('getStubbornWords 返回 stubbornCount >= 3 的词并按 desc 排序', async () => {
    const words: Word[] = [
      makeWord('word1', { stubbornCount: 5 }),
      makeWord('word2', { stubbornCount: 3 }),
      makeWord('word3', { stubbornCount: 10 }),
      makeWord('word4', { stubbornCount: 2 }), // 应被排除
      makeWord('word5', { stubbornCount: 1 }), // 应被排除
      makeWord('word6'), // stubbornCount 默认 0，应被排除
    ]
    installWordMock(words)
    try {
      const result = await getStubbornWords()
      expect(result.length).toBe(3)
      expect(result[0].id).toBe('word3')
      expect(result[1].id).toBe('word1')
      expect(result[2].id).toBe('word2')
    } finally {
      restoreMock()
    }
  })

  // 2. getStubbornWords 不返回 stubbornCount < 3 的词
  it('getStubbornWords 不返回 stubbornCount < 3 的词', async () => {
    const words: Word[] = [
      makeWord('word1', { stubbornCount: 0 }),
      makeWord('word2', { stubbornCount: 1 }),
      makeWord('word3', { stubbornCount: 2 }),
      makeWord('word4'), // stubbornCount 默认 0
    ]
    installWordMock(words)
    try {
      const result = await getStubbornWords()
      expect(result.length).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 3. getTodayReviewQueueInfo 中顽固词排在前面（stubbornCount desc）
  it('getTodayReviewQueueInfo 中顽固词排在前面（stubbornCount desc）', async () => {
    const now = Date.now()
    const words: Word[] = [
      // 普通词 1：nextReview 已到期
      makeWord('normal1', { stubbornCount: 0, nextReview: now - 1000, reviewCount: 3 }),
      // 顽固词 1：stubbornCount=5
      makeWord('stubborn1', { stubbornCount: 5, nextReview: now - 1000, reviewCount: 3 }),
      // 普通词 2：nextReview 更早到期
      makeWord('normal2', { stubbornCount: 0, nextReview: now - 500, reviewCount: 3 }),
      // 顽固词 2：stubbornCount=3
      makeWord('stubborn2', { stubbornCount: 3, nextReview: now - 2000, reviewCount: 3 }),
      // 未到期的词：应被排除
      makeWord('future', { stubbornCount: 10, nextReview: now + DAY_MS, reviewCount: 3 }),
    ]
    installWordMock(words)
    try {
      const info = await getTodayReviewQueueInfo()
      // 4 个到期词，1 个未来词被排除
      expect(info.words.length).toBe(4)
      expect(info.total).toBe(4)
      // 顽固词排在前面，按 stubbornCount 降序
      expect(info.words[0].id).toBe('stubborn1')
      expect(info.words[1].id).toBe('stubborn2')
      // 然后是普通词，按 nextReview 升序（更早到期优先）
      expect(info.words[2].id).toBe('normal1')
      expect(info.words[3].id).toBe('normal2')
    } finally {
      restoreMock()
    }
  })

  // 3.5 reachedLimit 语义：超过每日上限时截断并标记；limit<=0（不限制）时不标记
  it('getTodayReviewQueueInfo 超过每日上限时截断 words 并 reachedLimit=true', async () => {
    const now = Date.now()
    const words: Word[] = Array.from({ length: 5 }, (_, i) =>
      makeWord(`w${i}`, { nextReview: now - 1000 })
    )
    window.localStorage.setItem(
      'ydxl-settings',
      JSON.stringify({ dailyReviewLimit: 3 })
    )
    installWordMock(words)
    try {
      const info = await getTodayReviewQueueInfo()
      // 截断为上限 3 个，总数仍为 5
      expect(info.words.length).toBe(3)
      expect(info.total).toBe(5)
      expect(info.limit).toBe(3)
      expect(info.reachedLimit).toBe(true)
    } finally {
      window.localStorage.removeItem('ydxl-settings')
      restoreMock()
    }
  })

  it('getTodayReviewQueueInfo limit<=0（不限制）时返回全部且 reachedLimit=false', async () => {
    const now = Date.now()
    const words: Word[] = Array.from({ length: 5 }, (_, i) =>
      makeWord(`w${i}`, { nextReview: now - 1000 })
    )
    // limit=0 语义为不限制（历史数据或手动修改 localStorage 可能出现）
    window.localStorage.setItem(
      'ydxl-settings',
      JSON.stringify({ dailyReviewLimit: 0 })
    )
    installWordMock(words)
    try {
      const info = await getTodayReviewQueueInfo()
      expect(info.words.length).toBe(5)
      expect(info.total).toBe(5)
      expect(info.limit).toBe(0)
      // 不限制时不应误报"已达上限"
      expect(info.reachedLimit).toBe(false)
    } finally {
      window.localStorage.removeItem('ydxl-settings')
      restoreMock()
    }
  })

  it('getTodayReviewQueueInfo 未超上限时 reachedLimit=false', async () => {
    const now = Date.now()
    const words: Word[] = Array.from({ length: 2 }, (_, i) =>
      makeWord(`w${i}`, { nextReview: now - 1000 })
    )
    window.localStorage.setItem(
      'ydxl-settings',
      JSON.stringify({ dailyReviewLimit: 3 })
    )
    installWordMock(words)
    try {
      const info = await getTodayReviewQueueInfo()
      expect(info.words.length).toBe(2)
      expect(info.reachedLimit).toBe(false)
    } finally {
      window.localStorage.removeItem('ydxl-settings')
      restoreMock()
    }
  })

  // 4. isOverdue 判断逻辑
  it('isOverdue 判断逻辑正确', () => {
    // 使用固定时间戳传入 isOverdue，避免内部再次调用 Date.now() 造成时间漂移
    const fixedNow = 1700000000000

    // nextReview 比 1 天前更早 → true（逾期）
    const overdue = makeWord('overdue', { nextReview: fixedNow - DAY_MS - 1000 })
    expect(isOverdue(overdue, fixedNow)).toBe(true)

    // nextReview 恰好等于 1 天前 → false（严格 <，边界不逾期）
    const exactlyOneDayAgo = makeWord('boundary', { nextReview: fixedNow - DAY_MS })
    expect(isOverdue(exactlyOneDayAgo, fixedNow)).toBe(false)

    // nextReview = now（今天）→ false
    const today = makeWord('today', { nextReview: fixedNow })
    expect(isOverdue(today, fixedNow)).toBe(false)

    // nextReview 在未来 → false
    const future = makeWord('future', { nextReview: fixedNow + DAY_MS })
    expect(isOverdue(future, fixedNow)).toBe(false)
  })

  // 5. applyWeightedReviewResult 调用后 word.stabilityScore 被更新
  it('applyWeightedReviewResult 调用后 word.stabilityScore 被更新', async () => {
    const now = Date.now()
    // 初始 word：reviewCount=2, interval=4, easeFactor=2.5, mastery=3
    const word: Word = makeWord('test-word', {
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
      mastery: 3,
      nextReview: now - 1000,
      stabilityScore: 30, // 初始值较低
    })
    installWordMock([word])
    installReviewMock()
    try {
      // 三环节全对 → 加权率=1.0 → q=5
      await applyWeightedReviewResult('test-word', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      // 从 mock 存储中读取更新后的 word
      const updated = mockWords.find((w) => w.id === 'test-word')
      expect(updated).toBeDefined()

      // 验证 stabilityScore 已被写入（不为初始值 30）
      expect(updated!.stabilityScore).toBeDefined()
      expect(updated!.stabilityScore !== 30).toBe(true)
      expect(
        updated!.stabilityScore! >= 0 && updated!.stabilityScore! <= 100
      ).toBe(true)

      // 精确值验证：
      // - reviewCount 由 2 增至 3（word.reviewCount + 1）
      // - easeFactor 由 2.5 提升至 2.6（q=5 → easeDelta=0.1）
      // - interval: reviewCount=3 (非首次/第二次)，raw=round(4*2.6)=10，snap(10)=15
      // - stabilityScore = 3*5 + (2.6-1.3)*20 + (15/30)*30 = 15 + 26 + 15 = 56
      expect(updated!.stabilityScore).toBe(56)

      // 顺带验证其他字段也被更新
      expect(updated!.reviewCount).toBe(3)
      expect(updated!.interval).toBe(15)
      expect(updated!.easeFactor).toBe(2.6)
      expect(updated!.mastery).toBe(4)
    } finally {
      restoreMock()
    }
  })

  // 6. 复习完成后再次查询今日队列不包含该单词（验证复习流程闭环）
  it('applyWeightedReviewResult 后该单词不再出现在今日复习队列（已掌握）', async () => {
    const now = Date.now()
    // 两个到期单词
    const words: Word[] = [
      makeWord('word-a', {
        nextReview: now - 1000,
        reviewCount: 2,
        interval: 4,
        easeFactor: 2.5,
      }),
      makeWord('word-b', {
        nextReview: now - 500,
        reviewCount: 2,
        interval: 4,
        easeFactor: 2.5,
      }),
    ]
    installWordMock(words)
    installReviewMock()
    try {
      // 复习前：队列包含两个到期单词
      const before = await getTodayReviewQueueInfo()
      expect(before.total).toBe(2)
      expect(before.words.map((w) => w.id)).toContain('word-a')

      // 复习 word-a：三环节全对 → quality=5 → nextReview 推到未来
      await applyWeightedReviewResult('word-a', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      // 复习后：word-a 不应再出现在今日队列（nextReview 已推到未来）
      const after = await getTodayReviewQueueInfo()
      expect(after.words.map((w) => w.id)).not.toContain('word-a')
      // word-b 仍在队列
      expect(after.words.map((w) => w.id)).toContain('word-b')
      // 总数减一
      expect(after.total).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 7. "还需复习"（全错）场景：nextInterval=1，下次复习在明天，今日队列同样闭合
  it('applyWeightedReviewResult 后该单词不再出现在今日复习队列（还需复习）', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('word-c', {
        nextReview: now - 1000,
        reviewCount: 2,
        interval: 4,
        easeFactor: 2.5,
      }),
    ]
    installWordMock(words)
    installReviewMock()
    try {
      // 复习 word-c：全错 → quality=0 → nextInterval=1（明天）
      await applyWeightedReviewResult('word-c', {
        practiceCorrect: 0, practiceTotal: 10,
        spellCorrect: 0, spellTotal: 10,
        writeCorrect: 0, writeTotal: 10,
      })

      // 验证 nextReview 已推到未来（>= now + 1 天）
      const updated = mockWords.find((w) => w.id === 'word-c')
      expect(updated!.nextReview).toBeGreaterThan(now)

      // 今日队列不应再包含 word-c
      const after = await getTodayReviewQueueInfo()
      expect(after.words.map((w) => w.id)).not.toContain('word-c')
      expect(after.total).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 8. 达到掌握（mastery >= 5）时重置 stubbornCount 为 0
  // 记忆逻辑合理性：已掌握的单词不再需要强化，顽固词计数应清零
  it('applyWeightedReviewResult 达到掌握时重置 stubbornCount 为 0', async () => {
    // 初始 mastery=4，三环节全对 → masteryDelta=+1 → newMastery=5（达到掌握）
    // stubbornCount=5（顽固词），掌握后应重置为 0
    const word = makeWord('test', {
      mastery: 4,
      stubbornCount: 5,
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
    })
    installWordMock([word])
    installReviewMock()
    try {
      await applyWeightedReviewResult('test', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      const updated = mockWords.find((w) => w.id === 'test')
      expect(updated).toBeDefined()
      // 达到掌握
      expect(updated!.mastery).toBe(5)
      // stubbornCount 被重置为 0
      expect(updated!.stubbornCount).toBe(0)
    } finally {
      restoreMock()
    }
  })

  // 9. 未达到掌握时 stubbornCount 保持不变
  // 验证：仅当 mastery >= 5 时才重置 stubbornCount，未掌握时保留顽固词计数
  it('applyWeightedReviewResult 未达到掌握时 stubbornCount 保持不变', async () => {
    // 初始 mastery=3，三环节全对 → newMastery=4（未达到掌握）
    // stubbornCount=5 应保持不变
    const word = makeWord('test', {
      mastery: 3,
      stubbornCount: 5,
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
    })
    installWordMock([word])
    installReviewMock()
    try {
      await applyWeightedReviewResult('test', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      const updated = mockWords.find((w) => w.id === 'test')
      expect(updated).toBeDefined()
      // 未达到掌握
      expect(updated!.mastery).toBe(4)
      // stubbornCount 保持不变
      expect(updated!.stubbornCount).toBe(5)
    } finally {
      restoreMock()
    }
  })

  // 10. 逾期单词复习后逾期状态消除（验证修复：学习后 nextReview 被推到未来，isOverdue 返回 false）
  it('applyWeightedReviewResult 逾期单词复习后逾期状态消除', async () => {
    const now = Date.now()
    // 逾期 2 天的单词
    const word = makeWord('overdue-word', {
      nextReview: now - 2 * DAY_MS,
      reviewCount: 2,
      interval: 4,
      easeFactor: 2.5,
    })
    installWordMock([word])
    installReviewMock()
    try {
      // 复习前：单词逾期
      expect(isOverdue(mockWords[0], now)).toBe(true)

      // 复习：三环节全对 → nextInterval 推到未来
      await applyWeightedReviewResult('overdue-word', {
        practiceCorrect: 10, practiceTotal: 10,
        spellCorrect: 10, spellTotal: 10,
        writeCorrect: 10, writeTotal: 10,
      })

      // 复习后：nextReview 被推到未来
      const updated = mockWords.find((w) => w.id === 'overdue-word')
      expect(updated).toBeDefined()
      expect(updated!.nextReview).toBeGreaterThan(now)
      // 逾期状态已消除
      expect(isOverdue(updated!, now)).toBe(false)
    } finally {
      restoreMock()
    }
  })
})
