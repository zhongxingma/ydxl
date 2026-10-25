// reviewService 复习队列与顽固词
//
// getStubbornWords、getTodayReviewQueueInfo 排序 / 上限与 isOverdue 判断。
// 由 reviewService.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Word } from '@/shared/types'
import { getStubbornWords, getTodayReviewQueueInfo, isOverdue } from '../reviewService'
import { DAY_MS, installWordMock, restoreMock, makeWord } from './reviewServiceTestMocks'

describe('reviewService 复习队列与顽固词', () => {
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
})
