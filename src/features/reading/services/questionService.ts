// 阅读理解题生成服务
// 优先从本地查询；未命中则调用 AI 生成；校验/转换/去重逻辑在 questionMapper，
// 结构校验与错误消息提取在 questionValidation。
import { logger } from '../../../shared/utils/logger'
import { aiProvider, type StreamOptions } from '@/shared/services/ai'
import { questionRepository } from '@/shared/services'
import type { Article, Question } from '@/shared/types'
import { buildGrammarFillQuestions, buildReadingQuestions } from './questionMapper'
import { describeAIError } from './questionValidation'

/**
 * 获取指定文章的阅读理解题
 * 1. 优先从本地 questionRepository 查询 articleId 匹配的题目（排除语法填空类型，防止脏数据混入）
 * 2. 未命中则调用 aiProvider.generateQuestions 生成（跳过模型误返回的 grammar_fill 类型）
 * 3. 校验每题 4 选项且 correctIndex 在 0-3 范围内
 * 4. 写入本地 questionRepository，附 articleId 关联
 *
 * 失败语义（改进）：
 * - AI 调用失败时抛出 Error（含可读中文消息），由 UI 层透传给用户
 * - 之前版本静默 return []，导致用户只看到"练习题生成失败"而不知真实原因，多轮修复无效
 *
 * 优化：
 * - 支持传入 streamOptions 启用流式输出 + 中断机制（组件卸载时取消请求）
 * - 流式模式下跳过 callChatCached 缓存层（流式语义不兼容缓存命中即返回）
 *
 * @param article 文章实体
 * @param streamOptions 流式选项（可选）：signal 外部中断信号、onChunk 流式回调
 * @throws 当 AI 调用失败时抛出 Error，message 为可读中文提示
 */
// 同文章阅读理解生成的 in-flight 协调：
// ReadingPage 并行调用阅读理解与语法填空生成（Promise.allSettled），
// 语法填空的去重依赖阅读理解已写入本地，若并行执行时读取过早（阅读理解
// 尚未落库）则 existingClues 为空、去重失效。此处记录进行中的阅读理解
// 生成 promise，语法填空侧先 await 它再查本地。
const readingInflight = new Map<string, Promise<Question[]>>()

export async function getQuestionsForArticle(
  article: Article,
  streamOptions?: StreamOptions
): Promise<Question[]> {
  // 本地未命中走 AI 生成时登记 in-flight promise，供并行的语法填空调用等待
  const request = doGetQuestionsForArticle(article, streamOptions).finally(() => {
    readingInflight.delete(article.id)
  })
  readingInflight.set(article.id, request)
  return request
}

async function doGetQuestionsForArticle(
  article: Article,
  streamOptions?: StreamOptions
): Promise<Question[]> {
  // 1. 本地查询：使用 Dexie 索引 whereEquals('articleId') 替代 getAll().filter()，避免全表扫描
  // 排除语法填空类型：语法填空题有独立的生成分区（getGrammarFillQuestionsForArticle），
  // 防止历史脏数据（type 漂移的语法题）混入阅读理解列表造成两分区题目重复
  const localQuestions = await questionRepository.whereEquals('articleId', article.id)
  const readingQuestions = localQuestions
    .filter((q) => q.type !== 'grammar_fill')
    .sort((a, b) => a.id.localeCompare(b.id))
  if (readingQuestions.length > 0) {
    return readingQuestions
  }

  // 2. AI 生成：失败时抛出含可读消息的错误，由 UI 透传给用户
  // 透传 streamOptions 启用流式 + 中断机制
  let generated
  try {
    generated = await aiProvider.generateQuestions(article.id, article.content, article.genre, streamOptions)
  } catch (err) {
    // 外部中断（AbortError）不视为错误，向上抛出以便调用方识别
    if (err instanceof Error && err.name === 'AbortError') {
      throw err
    }
    logger.warn('[questionService] AI 生成题目失败', err)
    throw new Error(describeAIError(err))
  }

  // 3. 校验 + 转换为 Question 实体
  const questions = buildReadingQuestions(generated, article.id)

  if (questions.length === 0) {
    // AI 返回内容但全部校验失败：可能是模型返回了非预期结构
    throw new Error('AI 生成的题目格式无效，请稍后重试')
  }

  // 4. 写入本地
  try {
    await Promise.all(questions.map((q) => questionRepository.add(q)))
  } catch (err) {
    // 写入失败不阻塞返回，仅记录日志
    logger.warn('[questionService] 题目写入本地失败', err)
  }
  return questions
}

/**
 * 获取指定文章的语法填空题
 * 1. 优先从本地 questionRepository 查询 articleId 匹配且 type='grammar_fill' 的题目
 * 2. 未命中则调用 aiProvider.generateGrammarFillQuestions 生成
 * 3. 校验每题 4 选项且 correctIndex 在 0-3 范围内、强制 type 改写为 grammar_fill、
 *    与已有阅读理解题去重（同一原句不重复出题）
 * 4. 写入本地 questionRepository，附 articleId 关联
 *
 * 修复「阅读理解 5 题生成后语法填空未生成且与阅读理解重复」：
 * - 第三方模型 type 字段常漂移（返回 "cloze"/"fill_blank"/"detail" 等）：
 *   旧逻辑不校验 type 直接入库——非法 type 被 VALID_TYPES 整批拒绝导致「无结果」；
 *   合法阅读理解 type 混入则本地 filter(type='grammar_fill') 永远落空，
 *   且 getQuestionsForArticle 本地命中会把语法题混进阅读理解列表（两分区重复）。
 *   现改为：结构校验通过后强制 type='grammar_fill'（题目内容本就是语法填空语义，
 *   模型的 type 标注不可信，以调用场景为准）。
 * - 与阅读理解题去重：比对 stem（题干）——同一道题（题干相同）不再重复出现。
 *   修复「语法填空 5 题全部未生成」：旧逻辑比对 locationClue（原句），
 *   但 200-300 词短文章仅 10-20 句，阅读理解 5 题必然覆盖文章主要句子，语法填空
 *   从典型语法句挖空时原句高频重叠 → 合法语法题被整批误判"重复"跳光 → 抛错后
 *   UI 静默降级为空数组，且 7 天缓存使重试同样失败。同一原句上阅读理解考细节、
 *   语法填空挖空考语法是两种考法，不构成重复出题；真正的重复是题干相同
 *   （第三方模型偷懒复制阅读理解题干时按 stem 正确拦截）。
 *   语法填空相互之间同样比对 stem（挖空句规范化）。
 *
 * @param article 文章实体
 * @param streamOptions 流式选项（可选）
 * @throws 当 AI 调用失败时抛出 Error
 */
export async function getGrammarFillQuestionsForArticle(
  article: Article,
  streamOptions?: StreamOptions
): Promise<Question[]> {
  // 并行协调：同文章阅读理解正在生成时先等待其完成（失败不阻塞语法填空），
  // 确保去重比对时阅读理解题已写入本地
  const inflightReading = readingInflight.get(article.id)
  if (inflightReading) {
    await inflightReading.catch(() => {
      // 阅读理解生成失败不阻塞语法填空的独立生成
    })
  }

  // 1. 本地查询：过滤 type='grammar_fill' 的题目
  const localQuestions = await questionRepository.whereEquals('articleId', article.id)
  const grammarQuestions = localQuestions
    .filter((q) => q.type === 'grammar_fill')
    .sort((a, b) => a.id.localeCompare(b.id))
  if (grammarQuestions.length > 0) {
    return grammarQuestions
  }

  // 2. AI 生成
  let generated
  try {
    generated = await aiProvider.generateGrammarFillQuestions(
      article.id,
      article.content,
      streamOptions
    )
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err
    }
    logger.warn('[questionService] AI 生成语法填空题失败', err)
    throw new Error(describeAIError(err))
  }

  // 3. 校验 + 转换为 Question 实体（含与阅读理解题去重）
  const existingReading = localQuestions.filter((q) => q.type !== 'grammar_fill')
  const questions = buildGrammarFillQuestions(generated, article.id, existingReading)

  if (questions.length === 0) {
    throw new Error('AI 生成的语法填空题格式无效或与阅读理解题全部重复，请稍后重试')
  }

  // 4. 写入本地
  try {
    await Promise.all(questions.map((q) => questionRepository.add(q)))
  } catch (err) {
    logger.warn('[questionService] 语法填空题写入本地失败', err)
  }
  return questions
}

export const questionService = {
  getQuestionsForArticle,
  getGrammarFillQuestionsForArticle,
}
