// questionService 单元测试（Task 7.2）
//
// questionService.ts 仅导出 getQuestionsForArticle 方法（无 saveQuestions/checkAnswer），
// 故本测试聚焦于 getQuestionsForArticle 的多维度覆盖：
// 1. 本地缓存命中 → 返回本地题目，不调用 AI
// 2. 本地缓存命中 → 题目按 id 升序排序
// 3. 本地缓存未命中 → 调用 AI 生成并写入本地
// 4. AI 失败 → 抛出含可读消息的 Error（2026-07-26 改进：原静默返回 []，现透传错误便于排查）
// 5. AI 生成题目选项数 ≠ 4 → 跳过该题
// 6. AI 生成题目 correctIndex 越界 → 跳过该题
// 7. AI 生成题目 type 非法 → 跳过该题
// 8. AI 生成题目 stem 为空 → 跳过该题
// 9. AI 生成题目 id 不以 articleId 为前缀 → 跳过该题
// 10. AI 全部生成无效题目 → 抛出"AI 生成的题目格式无效"错误（2026-07-26 改进）
//
// Mock 策略：重写 questionRepository 单例上的方法 + aiProvider.generateQuestions 方法
// 参考 articleDedup.test.ts 的 mock 模式

import type { Article, Question } from '@/shared/types'
import type { QuestionGenerationResult } from '@/shared/services/ai'
import { getQuestionsForArticle, getGrammarFillQuestionsForArticle } from '../questionService'
import { questionRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'

// ---------- questionRepository 内存 Mock ----------

let mockStore: Question[] = []
let addCallCount = 0

const originalWhereEquals = questionRepository.whereEquals
const originalAdd = questionRepository.add

function installRepoMock(initial: Question[] = []): void {
  mockStore = [...initial]
  addCallCount = 0
  questionRepository.whereEquals = async (_field, value) =>
    mockStore.filter((q) => q.articleId === (value as string))
  questionRepository.add = async (entity) => {
    addCallCount += 1
    const item = { ...entity, updated_at: Date.now() } as Question
    mockStore.push(item)
    return item
  }
}

function restoreRepoMock(): void {
  questionRepository.whereEquals = originalWhereEquals
  questionRepository.add = originalAdd
}

// ---------- aiProvider Mock ----------

const originalGenerateQuestions = aiProvider.generateQuestions
const originalGenerateGrammarFill = aiProvider.generateGrammarFillQuestions

function installAIMock(
  impl: (articleId: string, content: string) => Promise<QuestionGenerationResult[]>,
): void {
  aiProvider.generateQuestions = impl as typeof aiProvider.generateQuestions
}

function installGrammarAIMock(
  impl: (articleId: string, content: string) => Promise<QuestionGenerationResult[]>,
): void {
  aiProvider.generateGrammarFillQuestions = impl as typeof aiProvider.generateGrammarFillQuestions
}

function restoreAIMock(): void {
  aiProvider.generateQuestions = originalGenerateQuestions
  aiProvider.generateGrammarFillQuestions = originalGenerateGrammarFill
}

// 构造合法的 Article
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '2024-01-01',
    title: 'Test Article',
    content: 'This is a test article content for unit testing.',
    translation: '测试文章',
    genre: 'narrative',
    wordCount: 100,
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// 构造合法的 QuestionGenerationResult
function makeAIQuestion(
  id: string,
  overrides: Partial<QuestionGenerationResult> = {},
): QuestionGenerationResult {
  return {
    id,
    type: 'main_idea',
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Explanation here',
    locationClue: 'paragraph 1',
    ...overrides,
  }
}

// 构造合法的 Question（已持久化形式）
function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  const now = Date.now()
  return {
    id,
    articleId: '2024-01-01',
    type: 'main_idea',
    stem: 'What is the main idea?',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Explanation',
    locationClue: 'paragraph 1',
    createdAt: now,
    updated_at: now,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('questionService', () => {
  // 1. 本地缓存命中 → 返回本地题目，不调用 AI
  it('本地缓存命中 → 返回本地题目，不调用 AI', async () => {
    const article = makeArticle()
    const existing = [
      makeQuestion('2024-01-01-1', { stem: '本地题目 1' }),
      makeQuestion('2024-01-01-2', { stem: '本地题目 2' }),
    ]
    installRepoMock(existing)
    let aiCallCount = 0
    installAIMock(async () => {
      aiCallCount += 1
      return []
    })
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(2)
      expect(aiCallCount).toBe(0)
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 2. 本地缓存命中 → 题目按 id 升序排序
  it('本地缓存命中 → 题目按 id 升序排序', async () => {
    const article = makeArticle()
    // 倒序插入，验证返回时按 id 升序
    const existing = [
      makeQuestion('2024-01-01-3'),
      makeQuestion('2024-01-01-1'),
      makeQuestion('2024-01-01-2'),
    ]
    installRepoMock(existing)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.map((q) => q.id)).toEqual([
        '2024-01-01-1',
        '2024-01-01-2',
        '2024-01-01-3',
      ])
    } finally {
      restoreRepoMock()
    }
  })

  // 3. 本地缓存未命中 → 调用 AI 生成并写入本地
  it('本地缓存未命中 → 调用 AI 生成并写入本地', async () => {
    const article = makeArticle({ id: '2024-02-02' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-02-02-1', { stem: 'AI 题目 1' }),
      makeAIQuestion('2024-02-02-2', { stem: 'AI 题目 2' }),
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(2)
      expect(result[0].stem).toBe('AI 题目 1')
      expect(result[1].stem).toBe('AI 题目 2')
      // 验证已写入本地（每个 question 调用一次 add）
      expect(addCallCount).toBe(2)
      // 验证 articleId 已关联
      expect(result[0].articleId).toBe('2024-02-02')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 4. AI 失败 → 抛出含可读消息的 Error（2026-07-26 改进：原静默返回 []，现透传错误便于排查）
  it('AI 失败 → 抛出含可读消息的 Error，不静默返回空数组', async () => {
    const article = makeArticle({ id: '2024-03-03' })
    installRepoMock([])
    installAIMock(async () => {
      throw new Error('AI 服务不可用')
    })
    try {
      await expect(getQuestionsForArticle(article)).rejects.toThrow(/AI 服务不可用|AI 调用失败/)
      // 验证未写入本地
      expect(addCallCount).toBe(0)
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 5. AI 生成题目选项数 ≠ 4 → 跳过该题
  it('AI 生成题目选项数 ≠ 4 → 跳过该题', async () => {
    const article = makeArticle({ id: '2024-04-04' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      // 合法题目
      makeAIQuestion('2024-04-04-1'),
      // 非法：只有 3 个选项（类型断言绕过编译期检查，模拟运行时 AI 返回）
      {
        ...makeAIQuestion('2024-04-04-2'),
        options: ['A', 'B', 'C'] as unknown as [string, string, string, string],
      },
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      // 仅保留 1 条合法题目
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('2024-04-04-1')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 6. AI 生成题目 correctIndex 越界 → 跳过该题
  it('AI 生成题目 correctIndex 越界 → 跳过该题', async () => {
    const article = makeArticle({ id: '2024-05-05' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-05-05-1'),
      // 非法：correctIndex=4（超出 0-3 范围）
      makeAIQuestion('2024-05-05-2', { correctIndex: 4 }),
      // 非法：correctIndex=-1
      makeAIQuestion('2024-05-05-3', { correctIndex: -1 }),
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('2024-05-05-1')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 7. AI 生成题目 type 非法 → 跳过该题
  it('AI 生成题目 type 非法 → 跳过该题', async () => {
    const article = makeArticle({ id: '2024-06-06' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-06-06-1'),
      // 非法：type 不在合法集合内
      {
        ...makeAIQuestion('2024-06-06-2'),
        type: 'invalid_type' as unknown as QuestionGenerationResult['type'],
      },
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('2024-06-06-1')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 8. AI 生成题目 stem 为空 → 跳过该题
  it('AI 生成题目 stem 为空 → 跳过该题', async () => {
    const article = makeArticle({ id: '2024-07-07' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-07-07-1'),
      // 非法：stem 为空白字符串
      makeAIQuestion('2024-07-07-2', { stem: '   ' }),
      // 非法：stem 为空字符串
      makeAIQuestion('2024-07-07-3', { stem: '' }),
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('2024-07-07-1')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 9. AI 生成题目 id 不以 articleId 为前缀 → 本地重写为规范 id（2026-08-29 改进）
  // 旧逻辑：整题跳过 → 第三方模型生成的题目全部被拒（"AI 生成的题目格式无效"）
  it('AI 生成题目 id 不以 articleId 为前缀 → 本地重写为规范 id', async () => {
    const article = makeArticle({ id: '2024-08-08' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-08-08-1'),
      // 第三方模型风格的自定义 id：结构合法但前缀不符
      makeAIQuestion('q2'),
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(2)
      expect(result[0].id).toBe('2024-08-08-1')
      // 前缀不符的题目按批次序号重写为 `${articleId}-${seq}`
      expect(result[1].id).toBe('2024-08-08-2')
      expect(result[1].articleId).toBe('2024-08-08')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 10. AI 全部生成无效题目 → 抛出"AI 生成的题目格式无效"错误（2026-07-26 改进）
  it('AI 全部生成无效题目 → 抛出"格式无效"错误且不写入本地', async () => {
    const article = makeArticle({ id: '2024-09-09' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-09-09-1', { correctIndex: 5 }),
      makeAIQuestion('2024-09-09-2', { stem: '' }),
      makeAIQuestion('wrong-id', { type: 'invalid' as unknown as QuestionGenerationResult['type'] }),
    ]
    installAIMock(async () => aiQuestions)
    try {
      await expect(getQuestionsForArticle(article)).rejects.toThrow(/格式无效/)
      // 验证未写入本地
      expect(addCallCount).toBe(0)
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // ===== 语法填空（2026-08-29 修复「语法填空未生成 + 与阅读理解重复」）=====

  // 11. 第三方模型 type 漂移（如 cloze）→ 强制改写为 grammar_fill 入库
  it('语法填空 type 漂移 → 强制改写为 grammar_fill，不再整批拒绝', async () => {
    const article = makeArticle({ id: '2024-10-10' })
    installRepoMock([])
    const aiGrammar: QuestionGenerationResult[] = [
      makeAIQuestion('q1', {
        type: 'cloze' as unknown as QuestionGenerationResult['type'],
        stem: 'He ___ to school every day.',
      }),
      // 混入阅读理解类型同样改写（内容是挖空句语义，以调用场景为准）
      makeAIQuestion('q2', {
        type: 'detail',
        stem: 'She has ___ finished her homework.',
      }),
    ]
    installGrammarAIMock(async () => aiGrammar)
    try {
      const result = await getGrammarFillQuestionsForArticle(article)
      expect(result.length).toBe(2)
      expect(result.every((q) => q.type === 'grammar_fill')).toBe(true)
      expect(result[0].id).toBe('2024-10-10-g1')
      expect(result[1].id).toBe('2024-10-10-g2')
      expect(addCallCount).toBe(2)
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 12. 与阅读理解题去重：按题干（stem）比对——原句重叠不误杀，题干相同才跳过
  it('语法填空与阅读理解考同一原句（考法不同）→ 不误判重复，正常保留', async () => {
    const article = makeArticle({ id: '2024-11-11' })
    // 已有阅读理解题引用原句 X（articleId 须与文章一致才能被本地查询命中）
    installRepoMock([
      makeQuestion('2024-11-11-1', {
        articleId: '2024-11-11',
        locationClue: 'He goes to school by bus.',
      }),
    ])
    const aiGrammar: QuestionGenerationResult[] = [
      // 原句与阅读理解相同但考法不同（挖空考语法）→ 不再按原句误杀
      // 2026-08-29 修复：旧逻辑按 locationClue 去重，短文章原句高频重叠导致语法题整批被跳光
      makeAIQuestion('2024-11-11-g1', {
        stem: 'He ___ to school by bus.',
        locationClue: 'he goes to school by bus. ',
      }),
      // 不重复：另一原句
      makeAIQuestion('2024-11-11-g2', {
        stem: 'They ___ playing football now.',
        locationClue: 'They are playing football now.',
      }),
    ]
    installGrammarAIMock(async () => aiGrammar)
    try {
      const result = await getGrammarFillQuestionsForArticle(article)
      // 两题均保留：原句重叠是短文章正常现象，题干不同即非重复
      expect(result.length).toBe(2)
      expect(result[0].id).toBe('2024-11-11-g1')
      expect(result[1].id).toBe('2024-11-11-g2')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 12b. 语法填空题干与阅读理解题干相同（模型偷懒复制题干）→ 跳过重复题
  it('语法填空 stem 与阅读理解 stem 相同 → 跳过重复题', async () => {
    const article = makeArticle({ id: '2024-11-11' })
    installRepoMock([
      makeQuestion('2024-11-11-1', {
        articleId: '2024-11-11',
        stem: 'He ___ to school by bus.',
        locationClue: 'He goes to school by bus.',
      }),
    ])
    const aiGrammar: QuestionGenerationResult[] = [
      // 题干与阅读理解相同（大小写/空白差异应被规范化）→ 真正的重复，跳过
      makeAIQuestion('2024-11-11-g1', {
        stem: 'he ___ to school by bus.',
        locationClue: 'He goes to school by bus.',
      }),
      makeAIQuestion('2024-11-11-g2', {
        stem: 'They ___ playing football now.',
        locationClue: 'They are playing football now.',
      }),
    ]
    installGrammarAIMock(async () => aiGrammar)
    try {
      const result = await getGrammarFillQuestionsForArticle(article)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('2024-11-11-g2')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 13. 语法填空相互之间 stem 重复（占位符写法不一）→ 跳过后者
  it('语法填空相互 stem 重复（___ 写法不一）→ 去重', async () => {
    const article = makeArticle({ id: '2024-12-12' })
    installRepoMock([])
    const aiGrammar: QuestionGenerationResult[] = [
      makeAIQuestion('q1', { stem: 'He ___ to school.', locationClue: 'He walks to school.' }),
      // 同一挖空句，占位符与空白写法不同 → 规范化后重复
      makeAIQuestion('q2', { stem: 'he ____   to school.', locationClue: 'He walks to school.' }),
      makeAIQuestion('q3', { stem: 'She ___ singing.', locationClue: 'She likes singing.' }),
    ]
    installGrammarAIMock(async () => aiGrammar)
    try {
      const result = await getGrammarFillQuestionsForArticle(article)
      expect(result.length).toBe(2)
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 14. 阅读理解本地查询排除 grammar_fill 类型（防语法题混入阅读理解列表）
  it('阅读理解本地命中 → 排除 grammar_fill 类型题目', async () => {
    const article = makeArticle()
    const existing = [
      makeQuestion('2024-01-01-1', { stem: '阅读理解题' }),
      makeQuestion('2024-01-01-g1', { type: 'grammar_fill', stem: '语法填空题' }),
    ]
    installRepoMock(existing)
    let aiCallCount = 0
    installAIMock(async () => {
      aiCallCount += 1
      return []
    })
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(1)
      expect(result[0].stem).toBe('阅读理解题')
      expect(aiCallCount).toBe(0)
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })

  // 15. 阅读理解生成混入 grammar_fill 类型 → 跳过（语法填空由独立流程生成）
  it('阅读理解 AI 结果混入 grammar_fill → 跳过不写入', async () => {
    const article = makeArticle({ id: '2024-13-13' })
    installRepoMock([])
    const aiQuestions: QuestionGenerationResult[] = [
      makeAIQuestion('2024-13-13-1', { stem: '阅读理解题 1' }),
      makeAIQuestion('q2', { type: 'grammar_fill', stem: 'He ___ a student.' }),
    ]
    installAIMock(async () => aiQuestions)
    try {
      const result = await getQuestionsForArticle(article)
      expect(result.length).toBe(1)
      expect(result[0].stem).toBe('阅读理解题 1')
    } finally {
      restoreRepoMock()
      restoreAIMock()
    }
  })
})
