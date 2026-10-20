// articleService 历史主题注入单元测试（Task 2.4）
//
// 覆盖场景：
// 1. getRecentTopics 返回最近 10 篇文章的 topic 列表（按 createdAt 倒序）
// 2. getRecentTopics 在无历史文章时返回空数组
// 3. generateArticle 调用时将 avoidTopics 传入 aiProvider.generateArticle
// 4. AI prompt（articlePrompt）中包含「请避免重复或过于相似」提示文案
//
// Mock 策略：
// - 重写 articleRepository 单例上的 getAll 方法，使用内存数组作为存储
// - 重写 aiProvider 单例上的 generateArticle 方法，捕获 avoidTopics 参数
// - articlePrompt 直接导入真实实现，验证 prompt 文案注入

import type { Article, Topic } from '@/shared/types'
import type { ArticleGenerationResult } from '@/shared/services/ai'
import { articlePrompt } from '@/shared/services/ai/prompts'
import { getRecentTopics, generateArticle } from '../articleService'
import { articleRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- articleRepository 内存 Mock ----------

// 内存存储：模拟 articles 表
let mockStore: Article[] = []

// 保存原始方法引用，便于恢复
const originalGetAll = articleRepository.getAll
const originalGetAllLocalFirst = articleRepository.getAllLocalFirst
const originalAdd = articleRepository.add

// 安装 articleRepository mock：重写 getAll / getAllLocalFirst / add 方法
function installArticleMock(initial: Article[] = []): void {
  mockStore = [...initial]
  articleRepository.getAll = async () => [...mockStore]
  // SWR 模式：getAllLocalFirst 与 getAll 行为一致（测试中不触发后台刷新）
  articleRepository.getAllLocalFirst = async () => [...mockStore]
  articleRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Article
    mockStore.push(item)
    return item
  }
}

// 恢复原始方法
function restoreArticleMock(): void {
  articleRepository.getAll = originalGetAll
  articleRepository.getAllLocalFirst = originalGetAllLocalFirst
  articleRepository.add = originalAdd
}

// ---------- aiProvider Mock ----------

// 保存原始方法引用，便于恢复
const originalGenerateArticle = aiProvider.generateArticle

// 捕获 generateArticle 调用参数
interface CapturedCall {
  date: string
  genre?: unknown
  topic?: unknown
  difficulty?: unknown
  avoidTopics?: string[]
}

// 安装 aiProvider mock：记录每次调用的参数，返回预设结果
function installAIProviderMock(
  result: ArticleGenerationResult,
  captured: CapturedCall[],
): void {
  aiProvider.generateArticle = (async (
    date: string,
    genre?: unknown,
    topic?: unknown,
    difficulty?: unknown,
    avoidTopics?: string[],
  ) => {
    captured.push({ date, genre, topic, difficulty, avoidTopics })
    return result
  }) as typeof aiProvider.generateArticle
}

// 恢复原始方法
function restoreAIProviderMock(): void {
  aiProvider.generateArticle = originalGenerateArticle
}

// ---------- 工厂函数 ----------

// 构造合法的 ArticleGenerationResult（提供合理默认值）
function makeAIResult(
  overrides: Partial<ArticleGenerationResult> = {},
): ArticleGenerationResult {
  return {
    title: 'AI 生成文章标题',
    content: 'AI 生成文章内容 200-300 词',
    translation: 'AI 生成文章翻译',
    genre: 'narrative',
    wordCount: 250,
    topic: 'campus',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [
      {
        word: 'campus',
        phonetic: '/ˈkæmpəs/',
        pos: 'n.',
        definition: '校园',
        example: 'AI 生成例句',
      },
    ],
    ...overrides,
  }
}

// 构造合法的 Article（提供合理默认值）
function makeArticle(overrides: Partial<Article> = {}): Article {
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
    contentHash: undefined,
    readAt: null,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('articleService 历史主题注入（Task 2）', () => {
  // 1. getRecentTopics 返回最近 10 篇文章的 topic 列表
  it('getRecentTopics 返回最近 10 篇文章的 topic 列表（按 createdAt 倒序）', async () => {
    // 构造 12 篇文章，createdAt 递增，topic 各不相同
    const topics: Topic[] = [
      'campus',
      'science',
      'culture',
      'biography',
      'travel',
      'sports',
      'technology',
      'nature',
      'campus',
      'science',
      'culture',
      'biography',
    ]
    const articles: Article[] = topics.map((topic, i) =>
      makeArticle({
        id: `2024-01-${String(i + 1).padStart(2, '0')}`,
        topic,
        createdAt: 1000 + i,
      }),
    )
    installArticleMock(articles)

    try {
      const recentTopics = await getRecentTopics(10)

      // 验证返回 10 条（限制 limit=10，共 12 篇取最近 10 篇）
      expect(recentTopics.length).toBe(10)
      // 验证按 createdAt 倒序：最近的是第 12 篇（createdAt=1011），最早取到第 3 篇（createdAt=1002）
      // 第 12 篇 topic=biography, 第 11 篇 topic=culture, 第 10 篇 topic=science
      expect(recentTopics[0]).toBe('biography') // createdAt=1011
      expect(recentTopics[1]).toBe('culture') // createdAt=1010
      expect(recentTopics[2]).toBe('science') // createdAt=1009
      // 最早取到的是第 3 篇（createdAt=1002, topic=culture）
      expect(recentTopics[9]).toBe('culture') // createdAt=1002
    } finally {
      restoreArticleMock()
    }
  })

  // 2. getRecentTopics 在无历史文章时返回空数组
  it('getRecentTopics 在无历史文章时返回空数组', async () => {
    installArticleMock([])

    try {
      const recentTopics = await getRecentTopics(10)
      expect(recentTopics).toEqual([])
    } finally {
      restoreArticleMock()
    }
  })

  // 3. generateArticle 调用时传入 avoidTopics 参数
  it('generateArticle 调用时将历史主题列表作为 avoidTopics 传入 aiProvider', async () => {
    // 历史文章：3 篇，topic 分别为 campus / science / culture
    const historyArticles: Article[] = [
      makeArticle({
        id: '2024-01-01',
        topic: 'campus',
        createdAt: 1000,
      }),
      makeArticle({
        id: '2024-01-02',
        topic: 'science',
        createdAt: 2000,
      }),
      makeArticle({
        id: '2024-01-03',
        topic: 'culture',
        createdAt: 3000,
      }),
    ]
    installArticleMock(historyArticles)

    // AI 返回全新结果（不与历史重复）
    const aiResult = makeAIResult({
      title: '全新主题文章标题',
      content: '全新主题文章内容',
    })
    const captured: CapturedCall[] = []
    installAIProviderMock(aiResult, captured)

    try {
      await generateArticle({ date: '2024-02-02' })

      // 验证 aiProvider.generateArticle 被调用 1 次
      expect(captured.length).toBe(1)
      // 验证 avoidTopics 参数已传入，且为历史文章的 topic 列表（按 createdAt 倒序）
      expect(captured[0].avoidTopics).toBeDefined()
      expect(captured[0].avoidTopics).toEqual(['culture', 'science', 'campus'])
    } finally {
      restoreArticleMock()
      restoreAIProviderMock()
    }
  })

  // 4. AI prompt 中包含「请避免...最近生成过的主题」提示文案
  // 注：avoidTopics 注入到 user message 末尾（动态部分），保持 system message 稳定
  // 以最大化 DeepSeek Context Cache 命中率（Task 3: 提示词与结构化优化）
  it('articlePrompt 在传入 avoidTopics 时 user message 包含「请避免...最近生成过的主题」提示', () => {
    const avoidTopics = ['campus', 'science', 'culture']
    const { system, user } = articlePrompt(
      '2024-02-02',
      undefined,
      undefined,
      undefined,
      avoidTopics,
    )

    // 验证 user message 包含避免重复的提示文案
    expect(user).toContain('请避免以下最近生成过的主题')
    // 验证每个历史主题都被列入提示
    expect(user).toContain('- campus')
    expect(user).toContain('- science')
    expect(user).toContain('- culture')
    // 验证包含「选择不同的主题或角度进行创作」的引导文案
    expect(user).toContain('选择不同的主题或角度进行创作')
    // 验证 system message 保持稳定（不含动态内容，最大化 Context Cache 命中）
    expect(system).not.toContain('请避免以下最近生成过的主题')
    expect(system).not.toContain('- campus')
  })

  // 补充：未传入 avoidTopics 时 user message 不包含避免重复提示
  it('articlePrompt 未传入 avoidTopics 时 user message 不包含避免重复提示', () => {
    const { user } = articlePrompt('2024-02-02')
    expect(user).not.toContain('请避免以下最近生成过的主题')
  })

  // 补充：avoidTopics 为空数组时不注入提示
  it('articlePrompt 传入空 avoidTopics 时不注入避免重复提示', () => {
    const { user } = articlePrompt(
      '2024-02-02',
      undefined,
      undefined,
      undefined,
      [],
    )
    expect(user).not.toContain('请避免以下最近生成过的主题')
  })
})

// ---------- Task 4：JSON Schema 样例精简测试 ----------
// 验证 articlePrompt 返回的 user message 中 JSON schema 样例已精简：
// - 不再含枚举值字符串（如 narrative|expository|practical）
// - 字段值为空字符串或 0 占位
// - 字段名与结构保持完整
describe('articlePrompt JSON Schema 精简（Task 4）', () => {
  it('user message 中 JSON 样例不含 narrative|expository|practical 字符串', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例中 genre 字段含枚举值 narrative|expository|practical，精简后应已移除
    expect(user).not.toContain('narrative|expository|practical')
  })

  it('user message 中 JSON 样例不含 topic 枚举值字符串', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例中 topic 字段含 8 个枚举值用 | 分隔，精简后应已移除
    expect(user).not.toContain('campus|science|culture|biography|travel|sports|technology|nature')
  })

  it('user message 中 JSON 样例不含 difficulty 枚举值字符串', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例中 difficulty 字段含 easy|medium|hard 枚举值，精简后应已移除
    expect(user).not.toContain('easy|medium|hard')
  })

  it('user message 中 JSON 样例字段值为空字符串占位 ""', () => {
    const { user } = articlePrompt('2024-02-02')
    // 精简后所有字符串字段值为空字符串占位
    expect(user).toContain('"title":""')
    expect(user).toContain('"content":""')
    expect(user).toContain('"translation":""')
    expect(user).toContain('"genre":""')
    expect(user).toContain('"topic":""')
    expect(user).toContain('"difficulty":""')
  })

  it('user message 中 JSON 样例数值字段用 0 占位', () => {
    const { user } = articlePrompt('2024-02-02')
    // wordCount 与 lexileRange.min/max 用 0 占位
    expect(user).toContain('"wordCount":0')
    expect(user).toContain('"lexileRange":{"min":0,"max":0}')
  })

  it('user message 中 JSON 样例保留所有字段名与结构', () => {
    const { user } = articlePrompt('2024-02-02')
    // 验证顶层字段名保持完整
    expect(user).toContain('"title"')
    expect(user).toContain('"content"')
    expect(user).toContain('"translation"')
    expect(user).toContain('"genre"')
    expect(user).toContain('"wordCount"')
    expect(user).toContain('"topic"')
    expect(user).toContain('"difficulty"')
    expect(user).toContain('"lexileRange"')
    expect(user).toContain('"highlightedWords"')
    expect(user).toContain('"phrases"')
    // 验证嵌套字段名保持完整
    expect(user).toContain('"phonetic"')
    expect(user).toContain('"pos"')
    expect(user).toContain('"definition"')
    expect(user).toContain('"example"')
    expect(user).toContain('"phrase"')
    expect(user).toContain('"meaning"')
    expect(user).toContain('"exampleTranslation"')
  })

  it('user message 中 JSON 样例不再含中文占位符（如 "英文标题"、"单词"）', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例字段值含中文说明（如 "英文标题"、"中文翻译"、"单词"、"音标"），精简后应已移除
    expect(user).not.toContain('"英文标题"')
    expect(user).not.toContain('"英文正文"')
    expect(user).not.toContain('"中文翻译"')
    expect(user).not.toContain('"词数"')
    expect(user).not.toContain('"单词"')
    expect(user).not.toContain('"音标"')
    expect(user).not.toContain('"词性"')
    expect(user).not.toContain('"释义"')
    expect(user).not.toContain('"例句翻译"')
  })

  it('字段语义说明保持完整（与现行 prompt 演进同步）', () => {
    const { user } = articlePrompt('2024-02-02')
    // 验证字段语义说明（在 JSON 样例之前的上文）保持完整
    // 注：源码 prompt 已新增议论文（argumentative）文体与 nature_theme 题材，断言随之更新
    expect(user).toContain('genre 字段必须使用 narrative / expository / practical / argumentative 之一')
    expect(user).toContain('topic 字段须使用 campus / science / culture / biography / travel / sports / technology / nature / news / self / society / nature_theme / traditional_culture / ai_life / personal_growth 之一')
    expect(user).toContain('difficulty 字段须使用 easy / medium / hard 之一')
    expect(user).toContain('highlightedWords 字段')
    expect(user).toContain('phrases 字段')
  })
})

// ---------- 去模板化：随机叙事视角注入测试 ----------
// 验证 articlePrompt 注入的「叙事视角/开头方式/结尾方式」随机创作风格文案，
// 用于打破 AI 文章模板化/千篇一律（2026-09-05）
describe('articlePrompt 随机叙事视角注入（去模板化）', () => {
  it('user message 包含随机叙事视角/开头/结尾引导文案', () => {
    const { user } = articlePrompt('2024-02-02')
    expect(user).toContain('叙事视角')
    expect(user).toContain('开头方式')
    expect(user).toContain('结尾方式')
    expect(user).toContain('避免套用固定模板')
  })

  it('system message 保持稳定，不含随机视角动态内容', () => {
    const { system } = articlePrompt('2024-02-02', undefined, undefined, undefined, [
      'campus',
    ])
    expect(system).not.toContain('叙事视角')
    expect(system).not.toContain('开头方式')
    expect(system).not.toContain('结尾方式')
  })

  it('随机视角注入后仍保留 avoidTopics 避免重复提示', () => {
    const { user } = articlePrompt('2024-02-02', undefined, undefined, undefined, [
      'campus',
    ])
    expect(user).toContain('请避免以下最近生成过的主题')
    expect(user).toContain('- campus')
  })
})

// ---------- 生活化题材专属创作简报测试（防套话/防千篇一律） ----------
// 验证 traditional_culture / ai_life / personal_growth 三个新题材
// 在 articlePrompt 中注入专属创作简报，并跳过通用随机叙事视角（避免指令冲突）
describe('articlePrompt 生活化题材专属创作简报', () => {
  it('ai_life 题材注入「一次具体经历」简报并禁用利弊议论文套话', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'ai_life')
    expect(user).toContain('题材专属要求（人工智能与生活')
    expect(user).toContain('一次具体经历')
    expect(user).toContain('AI is a double-edged sword')
    // 题材简报锁定叙事形式后不再叠加随机叙事视角（避免矛盾指令）
    expect(user).not.toContain('叙事视角')
  })

  it('traditional_culture 题材注入「给笔友的邮件」简报并禁止节日百科式写法', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'traditional_culture')
    expect(user).toContain('题材专属要求（中华传统文化')
    expect(user).toContain('外国笔友写一封邮件')
    expect(user).toContain('我参与的过程')
    expect(user).not.toContain('叙事视角')
  })

  it('personal_growth 题材注入「日记 + 具体挫折」简报并禁止大道理结尾', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'personal_growth')
    expect(user).toContain('题材专属要求（个人成长与真实体验')
    expect(user).toContain('英语日记')
    expect(user).toContain('This experience taught me')
    expect(user).not.toContain('叙事视角')
  })

  it('普通题材不受影响，仍注入随机叙事视角', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'campus')
    expect(user).not.toContain('题材专属要求')
    expect(user).toContain('叙事视角')
  })

  it('未指定题材时不注入专属简报', () => {
    const { user } = articlePrompt('2024-02-02')
    expect(user).not.toContain('题材专属要求')
    expect(user).toContain('叙事视角')
  })
})
