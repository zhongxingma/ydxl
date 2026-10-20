// masteredService 单元测试（Task 5.6）
//
// 测试范围：
// 1. getMasteredWords 不传参 → 返回全部已掌握单词（mastery >= 5）
// 2. getMasteredWords limit/offset 分页 → 返回指定页的 items
// 3. getMasteredWords keyword 搜索 → word 字段大小写不敏感模糊匹配
// 4. getMasteredWords keyword 为空白 → 不筛选返回全部
// 5. getMasteredWords sortBy='alphabet' → 按字母升序
// 6. getMasteredWords sortBy='masteredAt-desc'（默认）→ 按 lastReview 降序
// 7. getMasteredWords sortBy='createdAt-desc' → 按添加时间降序
// 8. getMasteredWords 空库 → 返回空 items 和 total=0
// 9. getMasteredWords limit <= 0 → 返回全部（不限制分页）
// 10. getMasteredWords 组合参数：keyword + sortBy + limit + offset
// 11. getMasteredWords 仅返回 mastery >= 5 的单词（未掌握被过滤）
//
// Mock 策略：重写 wordRepository 单例上的方法，使用内存数组作为存储
// 参考 wordbookService.test.ts 的 mock 模式

import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import { getMasteredWords } from '../masteredService'

// ---------- wordRepository 内存 Mock ----------

// 内存存储：模拟 words 表
let mockStore: Word[] = []

// 保存原始方法引用，便于恢复
const originalGetAll = wordRepository.getAll
const originalGetAllLocalFirst = wordRepository.getAllLocalFirst

// 安装 wordRepository mock：重写 getAll / getAllLocalFirst 方法，使用内存数组作为存储
function installWordMock(initial: Word[] = []): void {
  mockStore = [...initial]

  wordRepository.getAll = async () => [...mockStore]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  wordRepository.getAllLocalFirst = async () => [...mockStore]
}

// 恢复原始方法
function restoreWordMock(): void {
  wordRepository.getAll = originalGetAll
  wordRepository.getAllLocalFirst = originalGetAllLocalFirst
}

// 构造 Word 对象（提供合理默认值）
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
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('masteredService', () => {
  // 1. getMasteredWords 不传参 → 返回全部已掌握单词（mastery >= 5）
  it('getMasteredWords 不传参 → 返回全部已掌握单词（mastery >= 5）', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple', { word: 'apple', mastery: 5, createdAt: now - 3000 }),
      makeWord('banana', { word: 'banana', mastery: 6, createdAt: now - 2000 }),
      // 未掌握单词应被过滤掉
      makeWord('cherry', { word: 'cherry', mastery: 3, createdAt: now - 1000 }),
      makeWord('date', { word: 'date', mastery: 4, createdAt: now }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords()

      // 验证仅返回已掌握单词（mastery >= 5）
      expect(new Set(result.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'banana']),
      )
      // total 为过滤后的数量
      expect(result.total).toBe(2)
      // 不传 limit 时 limit 等于 total
      expect(result.limit).toBe(2)
      expect(result.offset).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 2. getMasteredWords limit/offset 分页 → 返回指定页的 items
  it('getMasteredWords limit/offset 分页 → 返回指定页的 items', async () => {
    const now = Date.now()
    // 5 个已掌握单词，默认按 lastReview 降序：m5, m4, m3, m2, m1
    const words: Word[] = [
      makeWord('m1', { word: 'm1', mastery: 5, lastReview: now - 4000 }),
      makeWord('m2', { word: 'm2', mastery: 5, lastReview: now - 3000 }),
      makeWord('m3', { word: 'm3', mastery: 5, lastReview: now - 2000 }),
      makeWord('m4', { word: 'm4', mastery: 5, lastReview: now - 1000 }),
      makeWord('m5', { word: 'm5', mastery: 5, lastReview: now }),
    ]
    installWordMock(words)
    try {
      // 第一页：limit=2, offset=0 → m5, m4
      const page1 = await getMasteredWords({ limit: 2, offset: 0 })
      expect(page1.items.map((w) => w.id)).toEqual(['m5', 'm4'])
      expect(page1.total).toBe(5)
      expect(page1.limit).toBe(2)
      expect(page1.offset).toBe(0)

      // 第二页：limit=2, offset=2 → m3, m2
      const page2 = await getMasteredWords({ limit: 2, offset: 2 })
      expect(page2.items.map((w) => w.id)).toEqual(['m3', 'm2'])
      expect(page2.total).toBe(5)

      // 第三页：limit=2, offset=4 → m1
      const page3 = await getMasteredWords({ limit: 2, offset: 4 })
      expect(page3.items.map((w) => w.id)).toEqual(['m1'])
      expect(page3.total).toBe(5)
    } finally {
      restoreWordMock()
    }
  })

  // 3. getMasteredWords keyword 搜索 → 在 word 字段中大小写不敏感模糊匹配
  it('getMasteredWords keyword 搜索 → word 字段大小写不敏感模糊匹配', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple', mastery: 5 }),
      makeWord('application', { word: 'application', mastery: 5 }),
      makeWord('banana', { word: 'banana', mastery: 5 }),
      makeWord('pineapple', { word: 'pineapple', mastery: 5 }),
      // 未掌握的 apple 相关词应被过滤掉
      makeWord('apprentice', { word: 'apprentice', mastery: 2 }),
    ]
    installWordMock(words)
    try {
      // 搜索 "app" → 匹配 apple, application, pineapple（includes 匹配，apprentice 未掌握被过滤）
      const result = await getMasteredWords({ keyword: 'app' })
      // 验证匹配的 id 集合
      expect(new Set(result.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'application', 'pineapple']),
      )
      expect(result.total).toBe(3)

      // 大小写不敏感：搜索 "APP" 应得到相同结果
      const resultUpper = await getMasteredWords({ keyword: 'APP' })
      expect(new Set(resultUpper.items.map((w) => w.id))).toEqual(
        new Set(['apple', 'application', 'pineapple']),
      )
      expect(resultUpper.total).toBe(3)
    } finally {
      restoreWordMock()
    }
  })

  // 4. getMasteredWords keyword 为空白 → 不筛选，返回全部
  it('getMasteredWords keyword 为空白 → 不筛选返回全部', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple', mastery: 5 }),
      makeWord('banana', { word: 'banana', mastery: 5 }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords({ keyword: '   ' })
      expect(result.total).toBe(2)
      expect(result.items.length).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 5. getMasteredWords sortBy='alphabet' → 按字母升序排序
  it("getMasteredWords sortBy='alphabet' → 按字母升序排序", async () => {
    const words: Word[] = [
      makeWord('cherry', { word: 'cherry', mastery: 5 }),
      makeWord('apple', { word: 'apple', mastery: 5 }),
      makeWord('banana', { word: 'banana', mastery: 5 }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords({ sortBy: 'alphabet' })
      expect(result.items.map((w) => w.word)).toEqual(['apple', 'banana', 'cherry'])
    } finally {
      restoreWordMock()
    }
  })

  // 6. getMasteredWords sortBy='masteredAt-desc'（默认）→ 按 lastReview 降序
  it("getMasteredWords sortBy='masteredAt-desc' → 按 lastReview 降序", async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('old', { word: 'old', mastery: 5, lastReview: now - 3000 }),
      makeWord('new', { word: 'new', mastery: 5, lastReview: now }),
      makeWord('mid', { word: 'mid', mastery: 5, lastReview: now - 1000 }),
    ]
    installWordMock(words)
    try {
      // 显式传 sortBy
      const result = await getMasteredWords({ sortBy: 'masteredAt-desc' })
      expect(result.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])

      // 不传 sortBy 应使用默认值 'masteredAt-desc'
      const defaultResult = await getMasteredWords()
      expect(defaultResult.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])
    } finally {
      restoreWordMock()
    }
  })

  // 7. getMasteredWords sortBy='createdAt-desc' → 按添加时间降序
  it("getMasteredWords sortBy='createdAt-desc' → 按添加时间降序", async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('old', { word: 'old', mastery: 5, createdAt: now - 3000 }),
      makeWord('new', { word: 'new', mastery: 5, createdAt: now }),
      makeWord('mid', { word: 'mid', mastery: 5, createdAt: now - 1000 }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords({ sortBy: 'createdAt-desc' })
      expect(result.items.map((w) => w.id)).toEqual(['new', 'mid', 'old'])
    } finally {
      restoreWordMock()
    }
  })

  // 8. getMasteredWords 空库 → 返回空 items 和 total=0
  it('getMasteredWords 空库 → 返回空 items 和 total=0', async () => {
    installWordMock([])
    try {
      const result = await getMasteredWords({ limit: 20, offset: 0 })
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 9. getMasteredWords limit <= 0 → 返回全部（不限制分页）
  it('getMasteredWords limit <= 0 → 返回全部（不限制分页）', async () => {
    const words: Word[] = [
      makeWord('apple', { word: 'apple', mastery: 5 }),
      makeWord('banana', { word: 'banana', mastery: 5 }),
      makeWord('cherry', { word: 'cherry', mastery: 5 }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords({ limit: 0 })
      expect(result.items.length).toBe(3)
      expect(result.total).toBe(3)
      // limit <= 0 时 limit 字段等于 total
      expect(result.limit).toBe(3)

      // limit 为负数也应返回全部
      const resultNeg = await getMasteredWords({ limit: -5 })
      expect(resultNeg.items.length).toBe(3)
      expect(resultNeg.limit).toBe(3)
    } finally {
      restoreWordMock()
    }
  })

  // 10. getMasteredWords 组合参数：keyword + sortBy + limit + offset
  it('getMasteredWords 组合参数：keyword + sortBy + limit + offset → 正确分页与排序', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple1', { word: 'apple1', mastery: 5, createdAt: now - 5000 }),
      makeWord('banana', { word: 'banana', mastery: 5, createdAt: now - 4000 }),
      makeWord('apple2', { word: 'apple2', mastery: 5, createdAt: now - 3000 }),
      makeWord('cherry', { word: 'cherry', mastery: 5, createdAt: now - 2000 }),
      makeWord('apple3', { word: 'apple3', mastery: 5, createdAt: now - 1000 }),
    ]
    installWordMock(words)
    try {
      // 搜索 "apple" + 字母升序 + limit=2 + offset=0
      // 匹配 apple1, apple2, apple3 → 字母升序：apple1, apple2, apple3
      // 分页：第一页 apple1, apple2
      const result = await getMasteredWords({
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
      const page2 = await getMasteredWords({
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

  // 11. getMasteredWords 仅返回 mastery >= 5 的单词（未掌握被过滤）
  it('getMasteredWords 仅返回 mastery >= 5 的单词（边界：mastery=4 被过滤，mastery=5 保留）', async () => {
    const words: Word[] = [
      makeWord('m0', { word: 'm0', mastery: 0 }),
      makeWord('m4', { word: 'm4', mastery: 4 }),
      makeWord('m5', { word: 'm5', mastery: 5 }),
      makeWord('m6', { word: 'm6', mastery: 6 }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords()
      // 仅 mastery >= 5 的单词被返回
      expect(new Set(result.items.map((w) => w.id))).toEqual(new Set(['m5', 'm6']))
      expect(result.total).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 12. getMasteredWords sortBy='masteredAt-desc' lastReview 缺失 → 视为 0 排在最后
  it("getMasteredWords sortBy='masteredAt-desc' lastReview 缺失 → 视为 0 排在最后", async () => {
    const now = Date.now()
    const words: Word[] = [
      // lastReview 缺失（默认 0）的已掌握单词
      makeWord('noview', { word: 'noview', mastery: 5, lastReview: 0 }),
      makeWord('recent', { word: 'recent', mastery: 5, lastReview: now }),
      makeWord('past', { word: 'past', mastery: 5, lastReview: now - 1000 }),
    ]
    installWordMock(words)
    try {
      const result = await getMasteredWords({ sortBy: 'masteredAt-desc' })
      // lastReview 降序：recent, past, noview(0)
      expect(result.items.map((w) => w.id)).toEqual(['recent', 'past', 'noview'])
    } finally {
      restoreWordMock()
    }
  })
})
