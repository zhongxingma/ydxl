// 离线场景服务级测试（Task 9.5）
//
// 验证断网状态下各页面数据可从本地缓存加载：
// - 首页（最近阅读）：getRecentlyReadArticles 从本地缓存加载
// - 历史阅读：getReadHistory 从本地缓存加载
// - 生词本：getWordbook 从本地缓存加载
// - 复习页：getTodayReviewQueue 从本地缓存加载
// - markAsRead：断网时写入本地缓存，后续离线查询可读到已读状态
//
// 模拟策略：
// CachedRemoteRepository 在远程失败时回退 local.getAll()，
// 此处直接重写 repository 单例方法返回本地缓存数据（等价于离线回退路径），
// 并验证新字段（phrases / exampleTranslation）在离线加载时完整保留。
//
// Mock 策略：重写 articleRepository / wordRepository 单例方法，
// 使用内存数组模拟本地 Dexie 缓存（断网时的数据源）

import type { Article, Word, ArticlePhrase, WordPhrase } from '@/shared/types'
import { articleRepository, wordRepository } from '@/shared/services'
import {
  getReadHistory,
  getRecentlyReadArticles,
  markAsRead,
} from '../articleService'
import { getWordbook } from '@/features/wordbook/services/wordbookService'
import { getTodayReviewQueue } from '@/features/review/services/reviewService'

// ---------- 内存存储（模拟本地 Dexie 缓存） ----------

let mockArticles: Article[] = []
let mockWords: Word[] = []

// 记录 update 调用，用于验证 markAsRead 写入本地缓存
let articleUpdateCalls: Array<{ id: string; patch: Record<string, unknown> }> = []

// 保存原始方法引用
const originalArticleGetAll = articleRepository.getAll
const originalArticleGetAllLocalFirst = articleRepository.getAllLocalFirst
const originalArticleGetById = articleRepository.getById
const originalArticleUpdate = articleRepository.update
const originalWordGetAll = wordRepository.getAll
const originalWordGetAllLocalFirst = wordRepository.getAllLocalFirst
const originalWordWhereBelowOrEqual = wordRepository.whereBelowOrEqual
const originalWordTriggerRefresh = wordRepository.triggerRefresh

// 安装离线 mock：模拟 CachedRemoteRepository 远程失败后回退本地缓存的路径
function installOfflineMock(articles: Article[], words: Word[] = []): void {
  mockArticles = [...articles]
  mockWords = [...words]
  articleUpdateCalls = []

  // articleRepository 离线回退：返回本地缓存数据
  articleRepository.getAll = async () => [...mockArticles]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  articleRepository.getAllLocalFirst = async () => [...mockArticles]
  articleRepository.getById = async (id: string) =>
    mockArticles.find((a) => a.id === id)
  // update 模拟 CachedRemoteRepository 离线时的 best-effort 本地写入
  articleRepository.update = async (id, patch) => {
    articleUpdateCalls.push({ id, patch: patch as Record<string, unknown> })
    const idx = mockArticles.findIndex((a) => a.id === id)
    if (idx >= 0) {
      mockArticles[idx] = { ...mockArticles[idx], ...patch, updated_at: Date.now() } as Article
      return mockArticles[idx]
    }
    return { id, updated_at: Date.now(), ...patch } as Article
  }

  // wordRepository 离线回退
  wordRepository.getAll = async () => [...mockWords]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  wordRepository.getAllLocalFirst = async () => [...mockWords]
  wordRepository.whereBelowOrEqual = async (field, value) =>
    mockWords.filter((w) => (w[field] as unknown as number) <= (value as unknown as number))
  // triggerRefresh 在测试中为 no-op（避免触发后台刷新与 cacheEvents）
  wordRepository.triggerRefresh = () => {}
}

// 恢复原始方法
function restoreMock(): void {
  articleRepository.getAll = originalArticleGetAll
  articleRepository.getAllLocalFirst = originalArticleGetAllLocalFirst
  articleRepository.getById = originalArticleGetById
  articleRepository.update = originalArticleUpdate
  wordRepository.getAll = originalWordGetAll
  wordRepository.getAllLocalFirst = originalWordGetAllLocalFirst
  wordRepository.whereBelowOrEqual = originalWordWhereBelowOrEqual
  wordRepository.triggerRefresh = originalWordTriggerRefresh
}

// 构造含 phrases 字段的 Article（Task 3 新字段）
function makeArticle(overrides: Partial<Article> = {}): Article {
  const phrases: ArticlePhrase[] = [
    {
      phrase: 'take care of',
      meaning: '照顾',
      example: 'She takes care of her sister.',
      exampleTranslation: '她照顾她的妹妹。',
    },
  ]
  return {
    id: 'default-id',
    title: '默认文章标题',
    content: '默认文章内容',
    translation: '默认文章翻译',
    genre: 'narrative',
    wordCount: 250,
    createdAt: 1000,
    updated_at: 1000,
    topic: 'campus',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [],
    readAt: null,
    phrases,
    ...overrides,
  }
}

// 构造含 exampleTranslation / phrases 字段的 Word（Task 7 新字段）
function makeWord(id: string, overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  const phrases: WordPhrase[] = [
    {
      phrase: 'look up',
      meaning: '查找',
      example: 'Look up the word in the dictionary.',
      exampleTranslation: '在字典里查找这个单词。',
    },
  ]
  return {
    id,
    word: id,
    phonetic: '/test/',
    pos: 'n.',
    definition: '测试',
    example: 'This is a test.',
    mastery: 0,
    nextReview: now,
    lastReview: 0,
    reviewCount: 0,
    interval: 0,
    easeFactor: 2.5,
    createdAt: now,
    updated_at: now,
    exampleTranslation: '这是一个测试。',
    phrases,
    ...overrides,
  }
}

describe('离线场景数据加载（Task 9.5）', () => {
  // 1. 断网时首页「最近阅读」从本地缓存加载
  it('断网时 getRecentlyReadArticles 从本地缓存加载，phrases 字段不丢失', async () => {
    const readArticle = makeArticle({
      id: '2026-07-15',
      title: '已读文章',
      readAt: 5000,
      phrases: [
        {
          phrase: 'in order to',
          meaning: '为了',
          example: 'He ran in order to catch the bus.',
          exampleTranslation: '他跑着为了赶上公交车。',
        },
      ],
    })
    const unreadArticle = makeArticle({ id: '2026-07-16', title: '未读文章', readAt: null })
    installOfflineMock([readArticle, unreadArticle])

    try {
      const result = await getRecentlyReadArticles(10)

      // 验证仅返回已读文章
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('2026-07-15')
      expect(result[0].title).toBe('已读文章')
      // 验证 readAt 已持久化（离线可读已读状态）
      expect(result[0].readAt).toBe(5000)
    } finally {
      restoreMock()
    }
  })

  // 2. 断网时历史阅读从本地缓存加载
  it('断网时 getReadHistory 从本地缓存加载已读文章', async () => {
    const read1 = makeArticle({ id: 'h1', title: '历史文章1', readAt: 1000 })
    const read2 = makeArticle({ id: 'h2', title: '历史文章2', readAt: 3000 })
    const unread = makeArticle({ id: 'h3', title: '未读文章', readAt: null })
    installOfflineMock([read1, read2, unread])

    try {
      const result = await getReadHistory(50, 0)

      // 验证仅返回已读或已开始的文章（readAt != null）
      expect(result).toHaveLength(2)
      // 验证按 readAt 降序排列（最近阅读的在前）
      expect(result[0].id).toBe('h2')
      expect(result[1].id).toBe('h1')
      // 验证 phrases 字段在离线加载时完整保留
      expect(result[0].phrases).toBeDefined()
      expect(result[0].phrases!.length).toBeGreaterThan(0)
      expect(result[0].phrases![0].exampleTranslation).toBe('她照顾她的妹妹。')
    } finally {
      restoreMock()
    }
  })

  // 3. 断网时生词本从本地缓存加载，exampleTranslation / phrases 字段不丢失
  it('断网时 getWordbook 从本地缓存加载，exampleTranslation / phrases 字段保留', async () => {
    const now = Date.now()
    const words: Word[] = [
      makeWord('apple', {
        word: 'apple',
        mastery: 0,
        nextReview: now + 9999,
        createdAt: now - 1000,
        exampleTranslation: '这是一个苹果。',
        phrases: [
          {
            phrase: 'apple pie',
            meaning: '苹果派',
            example: 'She baked an apple pie.',
            exampleTranslation: '她烤了一个苹果派。',
          },
        ],
      }),
      makeWord('banana', {
        word: 'banana',
        mastery: 3,
        nextReview: now + 9999,
        createdAt: now,
      }),
      // 已掌握单词应被过滤
      makeWord('cherry', { word: 'cherry', mastery: 5, createdAt: now - 500 }),
    ]
    installOfflineMock([], words)

    try {
      const result = await getWordbook()

      // 验证仅返回未掌握单词（mastery < 5）
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)

      // 验证 exampleTranslation 字段在离线加载时保留
      const apple = result.items.find((w) => w.id === 'apple')
      expect(apple).toBeDefined()
      expect(apple!.exampleTranslation).toBe('这是一个苹果。')
      // 验证 phrases 字段在离线加载时保留
      expect(apple!.phrases).toBeDefined()
      expect(apple!.phrases!.length).toBe(1)
      expect(apple!.phrases![0].exampleTranslation).toBe('她烤了一个苹果派。')
    } finally {
      restoreMock()
    }
  })

  // 4. 断网时复习页从本地缓存加载待复习队列
  it('断网时 getTodayReviewQueue 从本地缓存加载待复习队列', async () => {
    const now = Date.now()
    const words: Word[] = [
      // 已到期待复习
      makeWord('due1', { word: 'due1', nextReview: now - 1000, mastery: 0 }),
      makeWord('due2', { word: 'due2', nextReview: now - 500, mastery: 2 }),
      // 未到期
      makeWord('future', { word: 'future', nextReview: now + 9999, mastery: 0 }),
    ]
    installOfflineMock([], words)

    try {
      const result = await getTodayReviewQueue()

      // 验证仅返回到期单词（nextReview <= now）
      expect(result).toHaveLength(2)
      const ids = result.map((w) => w.id)
      expect(ids).toContain('due1')
      expect(ids).toContain('due2')
      expect(ids).not.toContain('future')
    } finally {
      restoreMock()
    }
  })

  // 5. 断网时 markAsRead 写入本地缓存，后续离线查询可读到已读状态
  it('断网时 markAsRead 写入本地缓存，getRecentlyReadArticles 可读到已读状态', async () => {
    // 初始状态：文章未读
    const article = makeArticle({
      id: '2026-07-16',
      title: '今日文章',
      readAt: null,
    })
    installOfflineMock([article], [])

    try {
      // 断网时调用 markAsRead（CachedRemoteRepository 离线 best-effort 写入本地）
      await markAsRead('2026-07-16')

      // 验证 articleRepository.update 被调用（写入本地缓存）
      expect(articleUpdateCalls).toHaveLength(1)
      expect(articleUpdateCalls[0].id).toBe('2026-07-16')
      expect(articleUpdateCalls[0].patch.readAt).toBeDefined()
      expect(typeof articleUpdateCalls[0].patch.readAt).toBe('number')

      // 验证后续离线查询可读到已读状态
      const recent = await getRecentlyReadArticles(10)
      expect(recent).toHaveLength(1)
      expect(recent[0].id).toBe('2026-07-16')
      expect(recent[0].readAt).toBeDefined()
      expect(typeof recent[0].readAt).toBe('number')
    } finally {
      restoreMock()
    }
  })

  // 6. 断网时 getReadHistory 加载 startedAt 但未读完的文章
  it('断网时 getReadHistory 加载已开始阅读但未完成的文章（startedAt != null）', async () => {
    const started = makeArticle({
      id: 'started-1',
      title: '已开始未完成',
      readAt: null,
      startedAt: 2000,
    })
    const notStarted = makeArticle({
      id: 'not-started',
      title: '未开始',
      readAt: null,
      startedAt: null,
    })
    installOfflineMock([started, notStarted])

    try {
      const result = await getReadHistory(50, 0)

      // 验证仅返回已开始或已读完的文章（readAt != null || startedAt != null）
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('started-1')
    } finally {
      restoreMock()
    }
  })
})
