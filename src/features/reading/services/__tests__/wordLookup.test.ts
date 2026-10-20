//
// 覆盖 4 级缓存策略：
// 1. Tier 1 LOCAL_DICT 命中（零 API、零 Dexie 查询）
// 2. Tier 2 wordRepository 命中（零 API）
// 3. Tier 3 responseCache 命中（零 API）
// 4. Tier 4 未命中触发 AI enrichment 并写入 responseCache
// 5. 二次查询同词命中 responseCache（零 API）
// 6. 全部失败时返回空字段
// 7. 非单词输入（空串 / 短语 / 含数字）返回 null
//
// Mock 策略：
// - mock wordRepository.whereEquals（模拟 Dexie 索引查询）
// - mock aiProvider.enrichSingleWord（模拟 AI 调用，记录调用次数验证零 API）
// - responseCache 使用真实实现（验证写入后能命中）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Word } from '@/shared/types'

// ---------- 模块 mock ----------

// wordRepository mock：whereEquals 返回可配置结果
const whereEqualsMock = vi.fn()
vi.mock('@/shared/services', () => ({
  wordRepository: {
    whereEquals: (...args: unknown[]) => whereEqualsMock(...args),
  },
}))

// aiProvider mock：enrichSingleWord 返回可配置结果，记录调用次数
const enrichSingleWordMock = vi.fn()
vi.mock('@/shared/services/ai', () => ({
  aiProvider: {
    enrichSingleWord: (...args: unknown[]) => enrichSingleWordMock(...args),
  },
}))

// 在所有 mock 之后导入被测模块
import { lookupWord, getWordLookupCacheKey } from '../wordLookup'
import { clearCache, getCached } from '@/shared/services/ai/responseCache'

// ---------- 测试数据工厂 ----------

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'test-word',
    word: 'example',
    phonetic: '/ɪɡˈzæmpl/',
    pos: 'n.',
    definition: '例子；榜样',
    example: 'This is an example.',
    mastery: 0,
    nextReview: 0,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// ---------- 测试用例 ----------

describe('wordLookup 4 级缓存策略', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // 每个测试前清空 responseCache，避免跨用例污染（clearCache 现为 async）
    await clearCache()
    // 默认 wordRepository 与 aiProvider 都返回空，由各测试按需配置
    whereEqualsMock.mockResolvedValue([])
    enrichSingleWordMock.mockResolvedValue({
      word: '',
      phonetic: '',
      pos: '',
      definition: '',
      example: '',
    })
  })

  afterEach(async () => {
    await clearCache()
  })

  // 1. Tier 1 LOCAL_DICT 命中
  it('Tier 1: LOCAL_DICT 命中时直接返回，不查询 wordRepository 与 AI', async () => {
    // 'apple' 在 LOCAL_DICT 中
    const result = await lookupWord('apple')

    expect(result).not.toBeNull()
    expect(result?.word).toBe('apple')
    expect(result?.phonetic).toBe('/ˈæpl/')
    expect(result?.pos).toBe('n.')
    expect(result?.definition).toBe('苹果')
    // 不应查询 wordRepository
    expect(whereEqualsMock).not.toHaveBeenCalled()
    // 不应调用 AI
    expect(enrichSingleWordMock).not.toHaveBeenCalled()
  })

  // 2. Tier 2 wordRepository 命中
  it('Tier 2: wordRepository 命中时返回生词本字段，不调用 AI', async () => {
    const wordEntry = makeWord({
      word: 'serendipity',
      phonetic: '/ˌserənˈdɪpəti/',
      pos: 'n.',
      definition: '意外发现美好事物的能力',
      example: 'Finding this cafe was pure serendipity.',
    })
    whereEqualsMock.mockResolvedValue([wordEntry])

    const result = await lookupWord('serendipity')

    expect(result).not.toBeNull()
    expect(result?.word).toBe('serendipity')
    expect(result?.phonetic).toBe('/ˌserənˈdɪpəti/')
    expect(result?.pos).toBe('n.')
    expect(result?.definition).toBe('意外发现美好事物的能力')
    expect(result?.example).toBe('Finding this cafe was pure serendipity.')
    // 应查询 wordRepository
    expect(whereEqualsMock).toHaveBeenCalledWith('word', 'serendipity')
    // 不应调用 AI
    expect(enrichSingleWordMock).not.toHaveBeenCalled()
  })

  // 3. Tier 3 responseCache 命中
  it('Tier 3: responseCache 命中时返回缓存结果，不调用 AI', async () => {
    // 先通过 Tier 4 写入缓存（模拟之前 AI enrichment 的结果）
    enrichSingleWordMock.mockResolvedValue({
      word: 'ephemeral',
      phonetic: '/ɪˈfemərəl/',
      pos: 'adj.',
      definition: '短暂的；瞬息的',
      example: 'Fame is ephemeral.',
    })
    // 第一次查询：触发 AI enrichment 并写入缓存
    await lookupWord('ephemeral')
    expect(enrichSingleWordMock).toHaveBeenCalledTimes(1)

    // 重置 mock 调用计数，准备第二次查询
    enrichSingleMockReset()
    // wordRepository 仍返回空，强制走 Tier 3
    whereEqualsMock.mockResolvedValue([])

    // 第二次查询：应命中 Tier 3 缓存，零 API
    const result = await lookupWord('ephemeral')

    expect(result).not.toBeNull()
    expect(result?.word).toBe('ephemeral')
    expect(result?.phonetic).toBe('/ɪˈfemərəl/')
    expect(result?.definition).toBe('短暂的；瞬息的')
    // 不应再次调用 AI
    expect(enrichSingleWordMock).not.toHaveBeenCalled()
  })

  // 4. Tier 4 未命中触发 AI enrichment 并写入 responseCache
  it('Tier 4: 未命中时触发 AI enrichment 并写入 responseCache', async () => {
    const aiResult = {
      word: 'quintessential',
      phonetic: '/ˌkwɪntɪˈsenʃl/',
      pos: 'adj.',
      definition: '典型的；精髓的',
      example: 'She is the quintessential teacher.',
    }
    enrichSingleWordMock.mockResolvedValue(aiResult)

    const result = await lookupWord('quintessential')

    // 返回 AI enrichment 结果
    expect(result).not.toBeNull()
    expect(result?.word).toBe('quintessential')
    expect(result?.phonetic).toBe('/ˌkwɪntɪˈsenʃl/')
    expect(result?.definition).toBe('典型的；精髓的')
    expect(result?.example).toBe('She is the quintessential teacher.')

    // 应调用 AI enrichment
    expect(enrichSingleWordMock).toHaveBeenCalledTimes(1)
    expect(enrichSingleWordMock).toHaveBeenCalledWith('quintessential')

    // 应写入 responseCache：直接读取缓存验证
    const key = await getWordLookupCacheKey('quintessential')
    const cached = await getCached<typeof aiResult>(key)
    expect(cached).not.toBeNull()
    expect(cached?.value.word).toBe('quintessential')
    expect(cached?.value.definition).toBe('典型的；精髓的')
  })

  // 5. 二次查询同词命中缓存（零 API）
  it('二次查询同词：命中 responseCache，零 API 调用', async () => {
    enrichSingleWordMock.mockResolvedValue({
      word: 'paradigm',
      phonetic: '/ˈpærədaɪm/',
      pos: 'n.',
      definition: '范式；典范',
      example: 'A new paradigm emerged.',
    })

    // 第一次查询：触发 AI
    await lookupWord('paradigm')
    expect(enrichSingleWordMock).toHaveBeenCalledTimes(1)

    // 第二次查询：应命中缓存，不调用 AI
    await lookupWord('paradigm')
    expect(enrichSingleWordMock).toHaveBeenCalledTimes(1) // 仍然是 1，未增加
  })

  // 6. 全部失败时返回空字段
  it('全部 Tier 失败时：返回空字段以保持 UI 兼容', async () => {
    // wordRepository 抛错
    whereEqualsMock.mockRejectedValue(new Error('Dexie error'))
    // AI 也抛错
    enrichSingleWordMock.mockRejectedValue(new Error('AI error'))

    // 抑制 console.warn 输出
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await lookupWord('nonexistent')

    expect(result).not.toBeNull()
    expect(result?.word).toBe('nonexistent')
    expect(result?.phonetic).toBe('')
    expect(result?.pos).toBe('')
    expect(result?.definition).toBe('')

    warnSpy.mockRestore()
  })

  // 7. 非单词输入返回 null
  it('非单词输入（空串 / 短语 / 含数字）返回 null', async () => {
    expect(await lookupWord('')).toBeNull()
    expect(await lookupWord('   ')).toBeNull()
    // 短语（含空格）
    expect(await lookupWord('hello world')).toBeNull()
    // 含数字
    expect(await lookupWord('test123')).toBeNull()
    // 不应查询任何 Tier
    expect(whereEqualsMock).not.toHaveBeenCalled()
    expect(enrichSingleWordMock).not.toHaveBeenCalled()
  })

  // 8. 大小写不敏感：输入大写也能命中 LOCAL_DICT
  it('大小写不敏感：输入大写也能命中 LOCAL_DICT', async () => {
    const result = await lookupWord('APPLE')

    expect(result).not.toBeNull()
    expect(result?.word).toBe('apple')
    expect(result?.definition).toBe('苹果')
  })

  // 9. Tier 2 失败时降级到 Tier 3
  it('Tier 2 失败时降级到 Tier 3（responseCache）', async () => {
    // 先写入 responseCache
    enrichSingleWordMock.mockResolvedValue({
      word: 'resilient',
      phonetic: '/rɪˈzɪliənt/',
      pos: 'adj.',
      definition: '有弹性的；能恢复的',
      example: 'She is resilient.',
    })
    await lookupWord('resilient') // 写入缓存
    enrichSingleMockReset()

    // wordRepository 抛错，应降级到 Tier 3
    whereEqualsMock.mockRejectedValue(new Error('Dexie error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await lookupWord('resilient')

    expect(result).not.toBeNull()
    expect(result?.word).toBe('resilient')
    expect(result?.definition).toBe('有弹性的；能恢复的')
    // AI 不应被调用（Tier 3 命中）
    expect(enrichSingleWordMock).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  // 10. 缓存 key 包含 word 文本（同词同 key）
  it('缓存 key 基于 word 文本：同词同 key，不同词不同 key', async () => {
    const key1 = await getWordLookupCacheKey('hello')
    const key2 = await getWordLookupCacheKey('hello')
    const key3 = await getWordLookupCacheKey('world')

    expect(key1).toBe(key2)
    expect(key1).not.toBe(key3)
    // key 应包含 scenario 前缀
    expect(key1.startsWith('wordLookup|')).toBe(true)
  })
})

// ---------- 辅助函数 ----------

// 重置 enrichSingleWordMock 调用计数（避免跨测试步骤干扰）
function enrichSingleMockReset(): void {
  enrichSingleWordMock.mockClear()
  enrichSingleWordMock.mockResolvedValue({
    word: '',
    phonetic: '',
    pos: '',
    definition: '',
    example: '',
  })
}
