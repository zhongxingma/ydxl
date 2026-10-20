// 阅读理解题生成服务
// 优先从本地查询；未命中则调用 AI 生成；校验每题 4 选项且 correctIndex 在 0-3 范围内
import { aiProvider, AIError, type StreamOptions } from '@/shared/services/ai'
import { questionRepository } from '@/shared/services'
import type { Article, Question, QuestionType } from '@/shared/types'

// 合法的题型集合（含 genre 扩展题型与语法填空题）
const VALID_TYPES: QuestionType[] = [
  'main_idea',
  'detail',
  'inference',
  'word_guess',
  'attitude',
  'fact_opinion',
  'structure',
  'paragraph_main',
  'causality',
  'grammar_fill',
]

/**
 * 校验 AI 生成题目的结构合法性（不含 id 前缀校验）
 * - 题型合法、字段非空
 * - 4 选项且 correctIndex 在 0-3
 *
 * id 前缀校验从结构校验中拆出（2026-08-29 修复第三方 API 练习题生成失败）：
 * DeepSeek 官方模型能稳定遵守 `${articleId}-${n}` 前缀约定，但第三方/免费模型
 * 常返回 "q1"、"1" 等自定义 id——旧逻辑将这类题目整批拒绝，导致
 * 「AI 生成的题目格式无效」报错且无任何结果。现改为本地重写 id（见 normalizeQuestionId）。
 *
 * ignoreType（语法填空场景）：跳过题型校验。第三方模型 type 字段常漂移
 * （返回 "cloze"/"fill_blank" 等非法值或混入阅读理解类型），语法填空的
 * 题目内容本就是挖空句语义，以调用场景为准强制改写为 grammar_fill，
 * 不依赖模型的 type 标注。
 */
function isValidQuestionStructure(
  q: {
    id: string
    type: QuestionType
    stem: string
    options: string[]
    correctIndex: number
    explanation: string
    locationClue: string
  },
  options?: { ignoreType?: boolean }
): q is {
  id: string
  type: QuestionType
  stem: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
  locationClue: string
} {
  if (!options?.ignoreType && !VALID_TYPES.includes(q.type)) return false
  if (typeof q.stem !== 'string' || !q.stem.trim()) return false
  if (!Array.isArray(q.options) || q.options.length !== 4) return false
  if (q.options.some((o) => typeof o !== 'string' || !o.trim())) return false
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return false
  if (typeof q.explanation !== 'string' || !q.explanation.trim()) return false
  if (typeof q.locationClue !== 'string') return false
  return true
}

/**
 * 规范化题目 id：不符合 `${articleId}-` 前缀约定时本地重写为规范格式
 * @param rawId AI 返回的原始 id（第三方模型可能返回 "q1"、"1" 等任意格式）
 * @param articleId 文章 ID
 * @param seq 本批次序号（从 1 递增）
 * @param grammar true 时使用 `-g${seq}`（语法填空题排序在阅读理解题之后）
 * @returns 规范化后的 id
 */
function normalizeQuestionId(
  rawId: string,
  articleId: string,
  seq: number,
  grammar: boolean
): string {
  if (rawId && rawId.startsWith(`${articleId}-`)) {
    return rawId
  }
  return grammar ? `${articleId}-g${seq}` : `${articleId}-${seq}`
}

/**
 * 从错误对象中提取用户可读的中文错误消息
 * 优先识别 AIError 与 HTTP 状态码，给出明确诊断；兜底返回 err.message
 * 用于让用户看到真实失败原因（如服务未配置、余额不足、限速等），便于排查
 */
function describeAIError(err: unknown): string {
  if (err instanceof AIError) {
    const msg = err.message || ''
    // 已是中文友好提示（如"XX 账号余额不足"）直接返回
    if (/[\u4e00-\u9fa5]/.test(msg)) return msg
    // 包含 HTTP 状态码的英文消息，映射到供应商无关的中文提示
    if (msg.includes('HTTP 503')) return 'AI 服务未配置或不可用，请联系管理员检查服务端 API Key 配置'
    if (msg.includes('HTTP 401')) return 'AI API key 错误或认证失败，请检查「个人中心 → AI 设置」中的密钥配置'
    if (msg.includes('HTTP 402')) return 'AI 服务账号余额不足，请充值后重试'
    if (msg.includes('HTTP 429')) return '请求被限速，请稍后重试'
    if (msg.includes('HTTP 5')) return 'AI 服务器繁忙，请稍后重试'
    return msg || 'AI 调用失败'
  }
  return err instanceof Error ? err.message : 'AI 调用失败'
}

/**
 * 规范化题目文本用于去重比对：小写 + 压缩空白 + 统一空缺占位符
 * 语法填空 stem 的 ___ 写法不一（___ / __ / ____），统一后再比对
 */
function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 获取指定文章的阅读理解题
 * 1. 优先从本地 questionRepository 查询 articleId 匹配的题目（排除语法填空类型，防止脏数据混入）
 * 2. 未命中则调用 aiProvider.generateQuestions 生成（跳过模型误返回的 grammar_fill 类型）
 * 3. 校验每题 4 选项且 correctIndex 在 0-3 范围内
 * 4. 写入本地 questionRepository，附 articleId 关联
 *
 * 失败语义（2026-07-26 改进）：
 * - AI 调用失败时抛出 Error（含可读中文消息），由 UI 层透传给用户
 * - 之前版本静默 return []，导致用户只看到"练习题生成失败"而不知真实原因，多轮修复无效
 *
 * Phase 3 优化（2026-07-27）：
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
  // Phase 3：透传 streamOptions 启用流式 + 中断机制
  let generated
  try {
    generated = await aiProvider.generateQuestions(article.id, article.content, article.genre, streamOptions)
  } catch (err) {
    // 外部中断（AbortError）不视为错误，向上抛出以便调用方识别
    if (err instanceof Error && err.name === 'AbortError') {
      throw err
    }
    console.warn('[questionService] AI 生成题目失败', err)
    throw new Error(describeAIError(err))
  }

  // 3. 校验 + 转换为 Question 实体
  // 结构合法但 id 前缀不符的题目本地重写 id（第三方模型常不遵守 id 约定）；
  // 同批次内 id 去重，避免 AI 返回重复 id 时写入本地主键冲突；
  // 模型误返回 grammar_fill 类型的题目跳过（语法填空由独立流程生成，避免混入）
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
    const id = normalizeQuestionId(g.id, article.id, seq, false)
    if (seenIds.has(id)) {
      console.warn('[questionService] 题目 id 重复，跳过', id)
      continue
    }
    seenIds.add(id)
    questions.push({
      id,
      articleId: article.id,
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

  if (questions.length === 0) {
    // AI 返回内容但全部校验失败：可能是模型返回了非预期结构
    throw new Error('AI 生成的题目格式无效，请稍后重试')
  }

  // 4. 写入本地
  try {
    await Promise.all(questions.map((q) => questionRepository.add(q)))
  } catch (err) {
    // 写入失败不阻塞返回，仅记录日志
    console.warn('[questionService] 题目写入本地失败', err)
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
 * 2026-08-29 修复「阅读理解 5 题生成后语法填空未生成且与阅读理解重复」：
 * - 第三方模型 type 字段常漂移（返回 "cloze"/"fill_blank"/"detail" 等）：
 *   旧逻辑不校验 type 直接入库——非法 type 被 VALID_TYPES 整批拒绝导致「无结果」；
 *   合法阅读理解 type 混入则本地 filter(type='grammar_fill') 永远落空，
 *   且 getQuestionsForArticle 本地命中会把语法题混进阅读理解列表（两分区重复）。
 *   现改为：结构校验通过后强制 type='grammar_fill'（题目内容本就是语法填空语义，
 *   模型的 type 标注不可信，以调用场景为准）。
 * - 与阅读理解题去重：比对 stem（题干）——同一道题（题干相同）不再重复出现。
 *   2026-08-29 修复「语法填空 5 题全部未生成」：旧逻辑比对 locationClue（原句），
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
    console.warn('[questionService] AI 生成语法填空题失败', err)
    throw new Error(describeAIError(err))
  }

  // 3. 校验 + 转换为 Question 实体
  // - 强制 type='grammar_fill'：模型 type 标注不可信（可能返回 cloze/detail 等），
  //   以调用场景为准，防止非法 type 被整批拒绝或合法 type 混入阅读理解列表
  // - id 前缀不符的本地重写；同批次 id 去重
  // - 与已有阅读理解题去重：题干（stem）相同的跳过——真正的题目重复；
  //   语法填空相互之间 stem（挖空句）规范化后去重
  const existingReading = localQuestions.filter((q) => q.type !== 'grammar_fill')
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
    const id = normalizeQuestionId(g.id, article.id, seq, true)
    if (seenIds.has(id)) {
      console.warn('[questionService] 语法填空题 id 重复，跳过', id)
      continue
    }
    seenIds.add(id)
    seenStems.add(stemKey)
    questions.push({
      id,
      articleId: article.id,
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

  if (questions.length === 0) {
    throw new Error('AI 生成的语法填空题格式无效或与阅读理解题全部重复，请稍后重试')
  }

  // 4. 写入本地
  try {
    await Promise.all(questions.map((q) => questionRepository.add(q)))
  } catch (err) {
    console.warn('[questionService] 语法填空题写入本地失败', err)
  }
  return questions
}

export const questionService = {
  getQuestionsForArticle,
  getGrammarFillQuestionsForArticle,
}
