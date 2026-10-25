// 题目结构校验、id 规范化、去重文本与 AI 错误消息提取
import { AIError } from '@/shared/services/ai'
import type { QuestionType } from '@/shared/types'

// 合法的题型集合（含 genre 扩展题型与语法填空题）
export const VALID_TYPES: QuestionType[] = [
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
export function isValidQuestionStructure(
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
export function normalizeQuestionId(
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
export function describeAIError(err: unknown): string {
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
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}
