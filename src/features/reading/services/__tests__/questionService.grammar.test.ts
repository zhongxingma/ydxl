// questionService 语法填空与阅读理解去重
//
// 语法填空 type 漂移改写、与阅读理解的原句 / stem 去重及类型隔离。
// 由 questionService.test.ts 按职责拆分而来，用例内容与断言未改动。

import type { QuestionGenerationResult } from '@/shared/services/ai'
import { getQuestionsForArticle, getGrammarFillQuestionsForArticle } from '../questionService'
import { addCallCount, installRepoMock, restoreRepoMock, installAIMock, installGrammarAIMock, restoreAIMock, makeArticle, makeAIQuestion, makeQuestion } from './questionServiceTestMocks'

describe('questionService 语法填空与阅读理解去重', () => {
  // ===== 语法填空（修复「语法填空未生成 + 与阅读理解重复」）=====

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
      // 修复：旧逻辑按 locationClue 去重，短文章原句高频重叠导致语法题整批被跳光
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
