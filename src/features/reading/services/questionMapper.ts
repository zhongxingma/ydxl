// AI 生成结果 → 本地 Question 实体转换（结构校验、id 重写、去重）
import type { QuestionGenerationResult } from '@/shared/services/ai'
import type { Question } from '@/shared/types'
import {
  isValidQuestionStructure,
  normalizeForDedupe,
  normalizeQuestionId,
} from './questionValidation'

/**
 * 阅读理解题转换：
 * - 结构合法但 id 前缀不符的题目本地重写 id（第三方模型常不遵守 id 约定）
 * - 同批次内 id 去重，避免 AI 返回重复 id 时写入本地主键冲突
 * - 模型误返回 grammar_fill 类型的题目跳过（语法填空由独立流程生成，避免混入）
 */
export function buildReadingQuestions(
  generated: QuestionGenerationResult[],
  articleId: string
): Question[] {
  const now = Date.now()
  const questions: Question[] = []
  const seenIds = new Set<string>()
  let seq = 0
  for (const g of generated) {
    if (g.type === 'grammar_fill') {
      console.warn('[questionService] 阅读理解生成结果混入 grammar_fill 类型，跳过', g.id)
      continue
    }
    if (!isValidQuestionStructure(g)) {
      console.warn('[questionService] 题目校验失败，跳过', g)
      continue
    }
    seq++
    const id = normalizeQuestionId(g.id, articleId, seq, false)
    if (seenIds.has(id)) {
      console.warn('[questionService] 题目 id 重复，跳过', id)
      continue
    }
    seenIds.add(id)
    questions.push({
      id,
      articleId,
      type: g.type,
      stem: g.stem,
      options: g.options,
      correctIndex: g.correctIndex,
      explanation: g.explanation,
      locationClue: g.locationClue,
      createdAt: now,
      updated_at: now,
    })
  }
  return questions
}

/**
 * 语法填空题转换：
 * - 强制 type='grammar_fill'：模型 type 标注不可信（可能返回 cloze/detail 等），
 *   以调用场景为准，防止非法 type 被整批拒绝或合法 type 混入阅读理解列表
 * - id 前缀不符的本地重写；同批次 id 去重
 * - 与已有阅读理解题去重：题干（stem）相同的跳过——真正的题目重复；
 *   语法填空相互之间 stem（挖空句）规范化后去重
 */
export function buildGrammarFillQuestions(
  generated: QuestionGenerationResult[],
  articleId: string,
  existingReading: Question[]
): Question[] {
  const existingReadingStems = new Set(
    existingReading.map((q) => normalizeForDedupe(q.stem))
  )
  const now = Date.now()
  const questions: Question[] = []
  const seenIds = new Set<string>()
  const seenStems = new Set<string>()
  let seq = 0
  for (const g of generated) {
    // ignoreType：语法填空场景模型 type 常漂移（cloze/fill_blank/阅读理解类型等），
    // 结构校验跳过 type，通过后强制改写为 grammar_fill
    if (!isValidQuestionStructure(g, { ignoreType: true })) {
      console.warn('[questionService] 语法填空题校验失败，跳过', g)
      continue
    }
    // 先计算题干 key：与阅读理解去重 + 语法填空相互去重共用
    const stemKey = normalizeForDedupe(g.stem)
    // 与阅读理解题去重：题干相同才是真正的重复（同一道题重复出现）
    if (existingReadingStems.has(stemKey)) {
      console.warn('[questionService] 语法填空题与阅读理解题重复（题干相同），跳过', g.id)
      continue
    }
    // 语法填空相互去重：挖空句规范化后重复的跳过
    if (seenStems.has(stemKey)) {
      console.warn('[questionService] 语法填空题 stem 重复，跳过', g.id)
      continue
    }
    seq++
    const id = normalizeQuestionId(g.id, articleId, seq, true)
    if (seenIds.has(id)) {
      console.warn('[questionService] 语法填空题 id 重复，跳过', id)
      continue
    }
    seenIds.add(id)
    seenStems.add(stemKey)
    questions.push({
      id,
      articleId,
      // 强制改写：模型的 type 标注不可信，本场景生成的必然是语法填空题
      type: 'grammar_fill',
      stem: g.stem,
      options: g.options,
      correctIndex: g.correctIndex,
      explanation: g.explanation,
      locationClue: g.locationClue,
      createdAt: now,
      updated_at: now,
    })
  }
  return questions
}
