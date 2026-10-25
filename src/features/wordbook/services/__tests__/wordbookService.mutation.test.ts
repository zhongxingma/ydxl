// wordbookService 新增 / 删除 / 笔记 / 统计
//
// addToWordbook 新增与合并笔记、removeFromWordbook、updateNote、getWordbookStats、bulkAdd / bulkRemove。
// 由 wordbookService.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { Word } from '@/shared/types'
import { addToWordbook, removeFromWordbook, updateNote, getWordbookStats, bulkAddToWordbook, bulkRemove } from '../wordbookService'
import { mockStore, callLog, installWordMock, restoreWordMock, makeWord } from './wordbookServiceTestMocks'

describe('wordbookService 新增 / 删除 / 笔记 / 统计', () => {
  it('addToWordbook 新增生词 → 返回值正确且持久化', async () => {
    installWordMock([])
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        note: 'first note',
      })

      // 验证返回值：id 为小写形式
      expect(result.id).toBe('brave')
      expect(result.word).toBe('Brave')
      expect(result.definition).toBe('勇敢的')
      // 验证新词初始化字段
      expect(result.mastery).toBe(0)
      expect(result.easeFactor).toBe(2.5)
      expect(result.reviewCount).toBe(0)
      expect(result.interval).toBe(0)
      // 验证 note 已写入
      expect(result.note).toBe('first note')
      // 验证已持久化：wordRepository.add 被调用一次
      expect(callLog.add).toBe(1)
      // 验证内存存储包含该词
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].id).toBe('brave')
    } finally {
      restoreWordMock()
    }
  })

  // 2. addToWordbook 已存在词 → 合并笔记而非新增（边界：重复词）
  it('addToWordbook 已存在词 → 合并笔记而非新增', async () => {
    const existing = makeWord('brave', {
      word: 'Brave',
      note: 'old note',
      mastery: 2,
    })
    installWordMock([existing])
    try {
      const result = await addToWordbook({
        word: 'brave',
        note: 'new note',
      })

      // 验证返回的 id 仍为小写
      expect(result.id).toBe('brave')
      // 验证笔记已合并（旧笔记 + 新笔记，换行分隔）
      expect(result.note).toBe('old note\nnew note')
      // 验证未新增（add 未被调用，update 被调用）
      expect(callLog.add).toBe(0)
      expect(callLog.update).toBe(1)
      // 验证内存存储仍为 1 条
      expect(mockStore.length).toBe(1)
      // 验证 mastery 保持原值（未重置）
      expect(result.mastery).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 3. removeFromWordbook 删除生词 → wordRepository.delete 被调用
  it('removeFromWordbook 删除生词 → 调用 delete 并从存储移除', async () => {
    const word = makeWord('brave', { word: 'Brave' })
    installWordMock([word])
    try {
      await removeFromWordbook('brave')

      // 验证 delete 被调用
      expect(callLog.delete).toBe(1)
      // 验证已从存储移除
      expect(mockStore.length).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 4. removeFromWordbook 删除不存在的 id → 不抛错（边界）
  it('removeFromWordbook 删除不存在的 id → 不抛错', async () => {
    installWordMock([])
    try {
      // 删除不存在的 id 不应抛错
      await expect(removeFromWordbook('nonexistent')).resolves.toBeUndefined()
      // 验证 delete 仍被调用（由底层 repository 处理）
      expect(callLog.delete).toBe(1)
      // 存储仍为空
      expect(mockStore.length).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 5. updateNote 更新生词笔记
  it('updateNote 更新生词笔记 → 调用 update 写入', async () => {
    const word = makeWord('brave', { word: 'Brave', note: 'old' })
    installWordMock([word])
    try {
      await updateNote('brave', 'updated note')

      // 验证 update 被调用
      expect(callLog.update).toBe(1)
      // 验证内存存储中笔记已更新
      expect(mockStore[0].note).toBe('updated note')
    } finally {
      restoreWordMock()
    }
  })

  // 6. updateNote 传入空字符串 → note 被清除（设为 undefined）
  it('updateNote 传入空字符串 → note 被清除', async () => {
    const word = makeWord('brave', { word: 'Brave', note: 'old' })
    installWordMock([word])
    try {
      await updateNote('brave', '   ')

      expect(callLog.update).toBe(1)
      // 空白字符串 trim 后为空 → note 设为 undefined
      expect(mockStore[0].note).toBeUndefined()
    } finally {
      restoreWordMock()
    }
  })

  // 7. getWordbookStats 统计 → 按 mastery/nextReview 过滤计数（byDifficulty 语义）
  it('getWordbookStats 统计 → 正确返回 total/mastered/pendingReview', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('w1', { mastery: 0, nextReview: now - 1000 }), // 未掌握，待复习
      makeWord('w2', { mastery: 5, nextReview: now + 9999 }), // 已掌握，未到期
      makeWord('w3', { mastery: 6, nextReview: now - 2000 }), // 已掌握，待复习
      makeWord('w4', { mastery: 3, nextReview: now + 5000 }), // 未掌握，未到期
    ]
    installWordMock(words)
    try {
      const stats = await getWordbookStats()

      // total: 全部 4 条
      expect(stats.total).toBe(4)
      // mastered: mastery >= 5 → w2, w3 共 2 条
      expect(stats.mastered).toBe(2)
      // pendingReview: nextReview <= now → w1, w3 共 2 条
      expect(stats.pendingReview).toBe(2)
    } finally {
      restoreWordMock()
    }
  })

  // 8. bulkAddToWordbook 批量新增 → 返回成功/失败计数
  it('bulkAddToWordbook 批量新增 → 返回正确计数', async () => {
    installWordMock([])
    try {
      const result = await bulkAddToWordbook(['apple', 'banana', 'cherry'])

      // 全部成功
      expect(result.added).toBe(3)
      expect(result.failed).toBe(0)
      // 验证存储包含 3 条
      expect(mockStore.length).toBe(3)
      // 验证 id 均为小写
      expect(mockStore.map((w) => w.id).sort()).toEqual(['apple', 'banana', 'cherry'])
    } finally {
      restoreWordMock()
    }
  })

  // 9. bulkAddToWordbook 空数组 → 返回 0/0
  it('bulkAddToWordbook 空数组 → 返回 0/0', async () => {
    installWordMock([])
    try {
      const result = await bulkAddToWordbook([])
      expect(result.added).toBe(0)
      expect(result.failed).toBe(0)
    } finally {
      restoreWordMock()
    }
  })

  // 9b. bulkAddToWordbook 已存在词被跳过（INSERT OR IGNORE 语义）
  it('bulkAddToWordbook 已存在词被跳过 → 返回 added/skipped 计数', async () => {
    // 预置 apple 已存在，导入 ['apple', 'banana'] 应 added=1, failed=1
    const existing = makeWord('apple', { word: 'Apple', mastery: 3 })
    installWordMock([existing])
    try {
      const result = await bulkAddToWordbook(['apple', 'banana'])

      // 新增 banana，跳过 apple
      expect(result.added).toBe(1)
      expect(result.failed).toBe(1)
      // 验证 bulkAdd 被调用一次（单次批量请求）
      expect(callLog.bulkAdd).toBe(1)
      // 验证 apple 复习进度未被覆盖（mastery 仍为 3）
      const apple = mockStore.find((w) => w.id === 'apple')
      expect(apple?.mastery).toBe(3)
      // 验证 banana 已插入
      const banana = mockStore.find((w) => w.id === 'banana')
      expect(banana).toBeDefined()
      expect(banana?.word).toBe('banana')
    } finally {
      restoreWordMock()
    }
  })

  // 10. bulkRemove 批量删除
  it('bulkRemove 批量删除 → 调用 bulkDelete 并移除', async () => {
    const words: Word[] = [
      makeWord('apple'),
      makeWord('banana'),
      makeWord('cherry'),
    ]
    installWordMock(words)
    try {
      await bulkRemove(['apple', 'cherry'])

      // 验证 bulkDelete 被调用
      expect(callLog.bulkDelete).toBe(1)
      // 验证仅剩 banana
      expect(mockStore.length).toBe(1)
      expect(mockStore[0].id).toBe('banana')
    } finally {
      restoreWordMock()
    }
  })
})
