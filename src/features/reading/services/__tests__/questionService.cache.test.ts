// questionService 本地缓存与 AI 生成
//
// 本地缓存命中、AI 生成写入与 id / 选项 / 答案 / 题型校验。
// 由 questionService.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { QuestionGenerationResult } from '@/shared/services/ai'
import { getQuestionsForArticle } from '../questionService'
import { addCallCount, installRepoMock, restoreRepoMock, installAIMock, restoreAIMock, makeArticle, makeAIQuestion, makeQuestion } from './questionServiceTestMocks'

describe('questionService 本地缓存与 AI 生成', () => {
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

  // 4. AI 失败 → 抛出含可读消息的 Error（改进：原静默返回 []，现透传错误便于排查）
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

  // 9. AI 生成题目 id 不以 articleId 为前缀 → 本地重写为规范 id（改进）
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

  // 10. AI 全部生成无效题目 → 抛出"AI 生成的题目格式无效"错误（改进）
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
})
