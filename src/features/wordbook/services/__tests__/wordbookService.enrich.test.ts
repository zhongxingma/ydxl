// wordbookService AI 补全
//
// enrichWord 字段完整 / 缺失 / 失败 / 占位值场景，以及 addToWordbook 的 enrichIfMissing 行为。
// 由 wordbookService.test.ts 按职责拆分而来，用例内容与断言未改动。

import { addToWordbook, enrichWord } from '../wordbookService'
import { wordRepository } from '@/shared/services'
import { callLog, mockEnrichSingleWord, installWordMock, restoreWordMock, installAIMock, restoreAIMock, makeWord } from './wordbookServiceTestMocks'

describe('wordbookService AI 补全', () => {
  // 11. enrichWord 字段已完整 → 不调用 AI，直接返回原 word
  it('enrichWord 字段已完整 → 不调用 AI，直接返回原 word', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
    })
    installWordMock([word])
    installAIMock(async () => ({ word: 'Brave', phonetic: '', pos: '', definition: '', example: '', importance: 'low' }))
    try {
      const result = await enrichWord('brave')

      // 验证未调用 AI
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证返回原 word（字段未变）
      expect(result.id).toBe('brave')
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      // 验证未写入（update 未被调用）
      expect(callLog.update).toBe(0)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 12. enrichWord 缺失字段 → 调用 aiProvider.enrichSingleWord 并写回 repository
  it('enrichWord 缺失字段 → 调用 AI 并写回 repository', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      importance: 'high',
    }))
    try {
      const result = await enrichWord('brave')

      // 验证调用了 AI
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证写回了缺失字段
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      expect(result.example).toBe('a brave boy')
      // 验证 update 被调用
      expect(callLog.update).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 13. enrichWord AI 失败 → 抛出 Error
  it('enrichWord AI 失败 → 抛出 Error', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '',
      pos: '',
      definition: '',
    })
    installWordMock([word])
    installAIMock(async () => {
      throw new Error('AI service unavailable')
    })
    try {
      await expect(enrichWord('brave')).rejects.toThrow('AI service unavailable')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 14. enrichWord 占位值检测 → 视为缺失并触发 AI 补全
  // 对应用户场景：选词加入生词本时 lookupWord 未命中本地字典返回占位数据
  it('enrichWord 字段为占位值（/-/、未知、暂未收录）→ 触发 AI 补全', async () => {
    const word = makeWord('ocean', {
      word: 'Ocean',
      // 占位值：来自 lookupWord 未命中时的返回
      phonetic: '/-/',
      pos: '未知',
      definition: '（暂未收录该词，可手动加入生词本后续学习）',
      example: '',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Ocean',
      phonetic: '/ˈəʊʃn/',
      pos: 'n.',
      definition: '海洋',
      example: 'the Pacific Ocean',
      importance: 'high',
    }))
    try {
      const result = await enrichWord('ocean')

      // 验证调用了 AI（占位值应触发补全）
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证占位字段已被真实值覆盖
      expect(result.phonetic).toBe('/ˈəʊʃn/')
      expect(result.pos).toBe('n.')
      expect(result.definition).toBe('海洋')
      expect(result.example).toBe('the Pacific Ocean')
      // 验证 update 被调用
      expect(callLog.update).toBeGreaterThanOrEqual(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 15. addToWordbook enrichIfMissing=true 且字段缺失 → 写入后自动调用 enrichWord 补全
  it('addToWordbook enrichIfMissing=true 且字段缺失 → 写入后自动补全', async () => {
    installWordMock([])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      importance: 'high',
    }))
    try {
      const result = await addToWordbook({
        word: 'Brave',
        // 字段缺失，触发 AI 补全
        phonetic: '',
        pos: '',
        definition: '',
        example: '',
        enrichIfMissing: true,
      })

      // 验证调用了 AI（enrichIfMissing 触发 enrichWord）
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证返回的是补全后的实体
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      expect(result.example).toBe('a brave boy')
      // 验证已持久化（add 被调用）
      expect(callLog.add).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 16. addToWordbook enrichIfMissing=true 且字段完整 → 不调用 AI
  it('addToWordbook enrichIfMissing=true 且字段完整 → 不调用 AI', async () => {
    installWordMock([])
    installAIMock(async () => ({ word: 'Brave', phonetic: '', pos: '', definition: '', example: '', importance: 'low' }))
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '/breɪv/',
        pos: 'adj.',
        definition: '勇敢的',
        example: 'a brave boy',
        enrichIfMissing: true,
      })

      // 验证未调用 AI（字段已完整，enrichWord 直接返回）
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证返回值字段保持原样
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.definition).toBe('勇敢的')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 17. addToWordbook enrichIfMissing=true 且 enrichWord 失败 → 不抛错，返回基础实体
  // 对应 best-effort 语义：AI 补全失败不阻塞加入生词本主流程
  it('addToWordbook enrichIfMissing=true 且 AI 补全失败 → 不抛错返回基础实体', async () => {
    installWordMock([])
    installAIMock(async () => {
      throw new Error('AI service unavailable')
    })
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '',
        pos: '',
        definition: '',
        enrichIfMissing: true,
      })

      // 验证不抛错，返回已写入的基础实体（字段为空但 id 正确）
      expect(result.id).toBe('brave')
      expect(result.word).toBe('Brave')
      // 字段仍为空（AI 补全失败）
      expect(result.phonetic).toBe('')
      // 验证已持久化（add 被调用，主流程未被阻塞）
      expect(callLog.add).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 18. addToWordbook enrichIfMissing=false（默认）→ 不调用 enrichWord
  it('addToWordbook 默认不触发 enrichWord（enrichIfMissing 默认 false）', async () => {
    installWordMock([])
    installAIMock(async () => ({ word: 'Brave', phonetic: '', pos: '', definition: '', example: '', importance: 'low' }))
    try {
      const result = await addToWordbook({
        word: 'Brave',
        phonetic: '',
        pos: '',
        definition: '',
        // 未传 enrichIfMissing，默认 false
      })

      // 验证未调用 AI
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证返回基础实体（字段为空）
      expect(result.id).toBe('brave')
      expect(result.phonetic).toBe('')
      expect(result.definition).toBe('')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 验证 enrichWord 仅写回缺失字段，已存在字段不被覆盖
  it('enrichWord 仅 phonetic 缺失 → patch 仅包含 phonetic，返回更新后的 word', async () => {
    const word = makeWord('test', {
      word: 'test',
      // phonetic 缺失，其余字段完整
      phonetic: '',
      pos: 'n.',
      definition: '测试',
      example: 'This is a test.',
    })
    installWordMock([word])
    // AI 返回完整数据（含所有字段）
    installAIMock(async () => ({
      word: 'test',
      phonetic: '/test/',
      pos: 'n.',
      definition: '测试（AI）',
      example: 'This is a test.（AI）',
      importance: 'high',
    }))
    try {
      const result = await enrichWord('test')

      // 验证调用了 AI
      expect(mockEnrichSingleWord).toHaveBeenCalledTimes(1)
      // 验证 update 被调用一次
      expect(callLog.update).toBe(1)
      // 验证 patch 仅包含 phonetic（pos/definition/example 已存在，不应被覆盖）
      expect(callLog.patches.length).toBe(1)
      expect(Object.keys(callLog.patches[0].patch)).toEqual(['phonetic'])
      expect(callLog.patches[0].patch.phonetic).toBe('/test/')
      // 验证返回的是更新后的 word
      expect(result.id).toBe('test')
      expect(result.phonetic).toBe('/test/')
      // 已有字段保持不变（未被 AI 返回值覆盖）
      expect(result.pos).toBe('n.')
      expect(result.definition).toBe('测试')
      expect(result.example).toBe('This is a test.')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  // 验证 isMissingField 全为 false 时短路返回，不触发 AI 调用与 update 写入
  it('enrichWord 所有字段完整（含 example）→ 不调用 AI，直接返回', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/should-not-be-used/',
      pos: 'v.',
      definition: '不应被使用',
      example: 'should not be used',
      importance: 'low',
    }))
    try {
      const result = await enrichWord('brave')

      // 验证未调用 AI（所有字段完整，短路返回）
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
      // 验证未写入（update 未被调用）
      expect(callLog.update).toBe(0)
      // 验证返回原 word（所有字段保持原值）
      expect(result.id).toBe('brave')
      expect(result.phonetic).toBe('/breɪv/')
      expect(result.pos).toBe('adj.')
      expect(result.definition).toBe('勇敢的')
      expect(result.example).toBe('a brave boy')
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  it('enrichWord 单词不存在 → 抛出 Word not found', async () => {
    installWordMock([])
    installAIMock(async () => ({
      word: 'missing',
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
      importance: 'low',
    }))
    try {
      await expect(enrichWord('missing')).rejects.toThrow('Word not found: missing')
      expect(mockEnrichSingleWord).not.toHaveBeenCalled()
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  it('enrichWord 补全例句翻译与相关短语并写回', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      exampleTranslation: '一个勇敢的男孩',
      importance: 'high',
      phrases: [{ phrase: 'be brave', meaning: '勇敢一点', example: 'Be brave!', exampleTranslation: '勇敢一点！' }],
    }))
    try {
      const result = await enrichWord('brave')

      const patch = callLog.patches[0].patch
      expect(patch.phonetic).toBe('/breɪv/')
      expect(patch.exampleTranslation).toBe('一个勇敢的男孩')
      expect(patch.phrases).toEqual([
        { phrase: 'be brave', meaning: '勇敢一点', example: 'Be brave!', exampleTranslation: '勇敢一点！' },
      ])
      expect(result.exampleTranslation).toBe('一个勇敢的男孩')
      expect(result.phrases).toEqual([
        { phrase: 'be brave', meaning: '勇敢一点', example: 'Be brave!', exampleTranslation: '勇敢一点！' },
      ])
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })

  it('enrichWord 更新后读取不到单词 → 抛出 Word not found after update', async () => {
    const word = makeWord('brave', {
      word: 'Brave',
      phonetic: '',
      pos: '',
      definition: '',
    })
    installWordMock([word])
    installAIMock(async () => ({
      word: 'Brave',
      phonetic: '/breɪv/',
      pos: 'adj.',
      definition: '勇敢的',
      example: 'a brave boy',
      importance: 'high',
    }))
    vi.spyOn(wordRepository, 'getByIdLocalFirst')
      .mockResolvedValueOnce(word)
      .mockResolvedValueOnce(undefined)
    try {
      await expect(enrichWord('brave')).rejects.toThrow(
        'Word not found after update: brave',
      )
      // 更新已执行（失败发生在更新后的回读）
      expect(callLog.update).toBe(1)
    } finally {
      restoreAIMock()
      restoreWordMock()
    }
  })
})
