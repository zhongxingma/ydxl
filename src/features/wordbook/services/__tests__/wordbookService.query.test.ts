// wordbookService 列表查询
//
// getWordbook 的未掌握过滤、分页、关键字搜索、排序、收藏筛选与空库边界。
// 由 wordbookService.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Word } from '@/shared/types'
import { getWordbook } from '../wordbookService'
import { installWordMock, restoreWordMock, makeWord } from './wordbookServiceTestMocks'

describe('wordbookService 列表查询', () => {

  // 21. getWordbook 不传参 → 返回全部未掌握单词（向后兼容）
  it('getWordbook 不传参 → 返回全部未掌握单词（含 mastery < 5）', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple', { word: 'apple', mastery: 0, createdAt: now - 3000 }),
      makeWord('banana', { word: 'banana', mastery: 3, createdAt: now - 2000 }),
      // 已掌握单词应被过滤掉
      makeWord('cherry', { word: 'cherry', mastery: 5, createdAt: now - 1000 }),
      makeWord('date', { word: 'date', mastery: 6, createdAt: now }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook()

      // 验证仅返回未掌握单词（mastery < 5）
      expect(result.items.map((w) => w.id)).toEqual(['banana', 'apple'])
      // total 为过滤后的数量
      expect(result.total).toBe(2)
      // 不传 limit 时 limit 等于 total
      expect(result.limit).toBe(2)
      expect(result.offset).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 22. getWordbook limit/offset 分页 → 返回指定页的 items
  it('getWordbook limit/offset 分页 → 返回指定页的 items', async () => {
    const now = Date.now()
    // 5 个未掌握单词，按 createdAt 降序（默认）：e5, e4, e3, e2, e1
    const words: Word[] = [
      makeWord('e1', { word: 'e1', createdAt: now - 4000 }),
      makeWord('e2', { word: 'e2', createdAt: now - 3000 }),
      makeWord('e3', { word: 'e3', createdAt: now - 2000 }),
      makeWord('e4', { word: 'e4', createdAt: now - 1000 }),
      makeWord('e5', { word: 'e5', createdAt: now }),
    ]
    installWordMock(words)
    try {
      // 第一页：limit=2, offset=0 → e5, e4
      const page1 = await getWordbook({ limit: 2, offset: 0 })
      expect(page1.items.map((w) => w.id)).toEqual(['e5', 'e4'])
      expect(page1.total).toBe(5)
      expect(page1.limit).toBe(2)
      expect(page1.offset).toBe(0)

      // 第二页：limit=2, offset=2 → e3, e2
      const page2 = await getWordbook({ limit: 2, offset: 2 })
      expect(page2.items.map((w) => w.id)).toEqual(['e3', 'e2'])
      expect(page2.total).toBe(5)

      // 第三页：limit=2, offset=4 → e1
      const page3 = await getWordbook({ limit: 2, offset: 4 })
      expect(page3.items.map((w) => w.id)).toEqual(['e1'])
      expect(page3.total).toBe(5)
    } finally {
      restoreWordMock()
    }
  })

  // 23. getWordbook keyword 搜索 → 在 word 字段中大小写不敏感模糊匹配
  it('getWordbook keyword 搜索 → word 字段大小写不敏感模糊匹配', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('application', { word: 'application' }),
      makeWord('banana', { word: 'banana' }),
      makeWord('pineapple', { word: 'pineapple' }),
    ]
    installWordMock(words)
    try {
      // 搜索 "app" → 匹配 apple, application, pineapple（includes 匹配）
      const result = await getWordbook({ keyword: 'app' })
      // 默认按 createdAt 降序，但 createdAt 相同（makeWord 默认 now），保持稳定
      // 验证匹配的 id 集合
      expect(new Set(result.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'application', 'pineapple']),
      )
      expect(result.total).toBe(3)

      // 大小写不敏感：搜索 "APP" 应得到相同结果
      const resultUpper = await getWordbook({ keyword: 'APP' })
      expect(new Set(resultUpper.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'application', 'pineapple']),
      )
      expect(resultUpper.total).toBe(3)
    } finally {
      restoreWordMock()
    }
  })

  // 24. getWordbook keyword 为空白 → 不筛选，返回全部
  it('getWordbook keyword 为空白 → 不筛选返回全部', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ keyword: '   ' })
      expect(result.total).toBe(2)
      expect(result.items.length).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 25. getWordbook sortBy='alphabet' → 按字母升序排序
  it("getWordbook sortBy='alphabet' → 按字母升序排序", async () => {
    const words: Word[] = [
      makeWord('cherry', { word: 'cherry' }),
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ sortBy: 'alphabet' })
      expect(result.items.map((w) => w.word)).toEqual(['apple', 'banana', 'cherry'])
    } finally {
      restoreWordMock()
    }
  })

  // 26. getWordbook sortBy='createdAt-desc'（默认）→ 按添加时间降序
  it("getWordbook sortBy='createdAt-desc' → 按添加时间降序", async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('old', { word: 'old', createdAt: now - 3000 }),
      makeWord('new', { word: 'new', createdAt: now }),
      makeWord('mid', { word: 'mid', createdAt: now - 1000 }),
    ]
    installWordMock(words)
    try {
      // 显式传 sortBy
      const result = await getWordbook({ sortBy: 'createdAt-desc' })
      expect(result.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])

      // 不传 sortBy 应使用默认值 'createdAt-desc'
      const defaultResult = await getWordbook()
      expect(defaultResult.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])
    } finally {
      restoreWordMock()
    }
  })

  // 27. getWordbook sortBy='nextReview-asc' → 按下次复习时间升序
  it("getWordbook sortBy='nextReview-asc' → 按下次复习时间升序", async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('late', { word: 'late', nextReview: now + 3000 }),
      makeWord('soon', { word: 'soon', nextReview: now + 500 }),
      makeWord('mid', { word: 'mid', nextReview: now + 1500 }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ sortBy: 'nextReview-asc' })
      expect(result.items.map((w) => w.id)).toEqual(['soon', 'mid', 'late'])
    } finally {
      restoreWordMock()
    }
  })

  // 28. getWordbook onlyFavorite=true → 仅返回 favorite === 1 的单词
  it('getWordbook onlyFavorite=true → 仅返回 favorite === 1 的单词', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple', favorite: 0 }),
      makeWord('banana', { word: 'banana', favorite: 1 }),
      makeWord('cherry', { word: 'cherry' }), // favorite 为 undefined
      makeWord('date', { word: 'date', favorite: 1 }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ onlyFavorite: true })
      expect(new Set(result.items.map((w) => w.id))).toEqual(new Set(['banana', 'date']))
      expect(result.total).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 29. getWordbook 空库 → 返回空 items 和 total=0
  it('getWordbook 空库 → 返回空 items 和 total=0', async () => {
    installWordMock([])
    try {
      const result = await getWordbook({ limit: 20, offset: 0 })
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 30. getWordbook 组合参数：keyword + sortBy + limit + offset
  it('getWordbook 组合参数：keyword + sortBy + limit + offset → 正确分页与排序', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple1', { word: 'apple1', createdAt: now - 5000 }),
      makeWord('banana', { word: 'banana', createdAt: now - 4000 }),
      makeWord('apple2', { word: 'apple2', createdAt: now - 3000 }),
      makeWord('cherry', { word: 'cherry', createdAt: now - 2000 }),
      makeWord('apple3', { word: 'apple3', createdAt: now - 1000 }),
    ]
    installWordMock(words)
    try {
      // 搜索 "apple" + 字母升序 + limit=2 + offset=0
      // 匹配 apple1, apple2, apple3 → 字母升序：apple1, apple2, apple3
      // 分页：第一页 apple1, apple2
      const result = await getWordbook({
        keyword: 'apple',
        sortBy: 'alphabet',
        limit: 2,
        offset: 0,
      })
      expect(result.items.map((w) => w.id)).toEqual(['apple1', 'apple2'])
      expect(result.total).toBe(3)
      expect(result.limit).toBe(2)
      expect(result.offset).toBe(0)

      // 第二页：offset=2 → apple3
      const page2 = await getWordbook({
        keyword: 'apple',
        sortBy: 'alphabet',
        limit: 2,
        offset: 2,
      })
      expect(page2.items.map((w) => w.id)).toEqual(['apple3'])
      expect(page2.total).toBe(3)
    } finally {
      restoreWordMock()
    }
  })

  // 31. getWordbook limit <= 0 → 返回全部（不限制分页）
  it('getWordbook limit <= 0 → 返回全部（不限制分页）', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple' }),
      makeWord('banana', { word: 'banana' }),
      makeWord('cherry', { word: 'cherry' }),
    ]
    installWordMock(words)
    try {
      const result = await getWordbook({ limit: 0 })
      expect(result.items.length).toBe(3)
      expect(result.total).toBe(3)
      // limit <= 0 时 limit 字段等于 total
      expect(result.limit).toBe(3)

      // limit 为负数也应返回全部
      const resultNeg = await getWordbook({ limit: -5 })
      expect(resultNeg.items.length).toBe(3)
      expect(resultNeg.limit).toBe(3)
    } finally {
      restoreWordMock()
    }
  })
})
