// AI 响应 JSON 解析工具（与具体供应商无关）
//
// 各供应商的响应格式差异较大：官方模型通常稳定输出纯 JSON，第三方/开源模型
// 常附加 markdown 围栏或前后闲聊。此处集中实现多级容错解析，供 BaseAIProvider
// 及各业务方法复用。
import { AIError } from './types'

/**
 * 从混杂文本中提取首个平衡的 JSON 块（对象或数组）
 * 第三方/开源模型常在 JSON 前后附加说明文字（如"以下是解析结果：{...}希望有帮助"），
 * 严格的整段解析会失败；此函数扫描文本找到首个 { 或 [，按括号配对（跳过字符串字面量
 * 与转义字符）截取完整 JSON 片段。
 * @param text 可能包含 JSON 的任意文本
 * @returns 提取出的 JSON 字符串，未找到完整块时返回 null
 */
export function extractJsonBlock(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start === -1) return null
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === open) {
      depth++
    } else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  // 括号不闭合（响应被截断）：返回 null，交由上层统一抛出解析错误
  return null
}

/**
 * 解析 AI 返回的 JSON 响应（带多级容错）
 * 1. 整段直接解析（标准路径，DeepSeek/OpenAI json_object 模式）
 * 2. 剥离整段 markdown 代码块包裹后解析（部分网关会忽略 response_format）
 * 3. 从混杂文本中提取首个平衡 JSON 块再解析（开源小模型常见的前后缀闲聊）
 * @param text AI 返回的原始文本
 * @returns 解析后的 JSON 对象
 * @throws AIError 当内容无法解析为 JSON 时抛出
 */
export function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim()

  // 第一级：整段直接解析（最快路径）
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // 继续尝试降级策略
  }

  // 第二级：剥离 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenceMatch) {
    const content = fenceMatch[1].trim()
    try {
      return JSON.parse(content) as T
    } catch {
      // 围栏内仍非纯 JSON，继续尝试提取平衡块
    }
  }

  // 第三级：从混杂文本中提取首个平衡 JSON 块
  const block = extractJsonBlock(trimmed)
  if (block) {
    try {
      return JSON.parse(block) as T
    } catch (err) {
      throw new AIError('AI 返回内容无法解析为 JSON', err)
    }
  }

  throw new AIError('AI 返回内容无法解析为 JSON')
}

/**
 * 解析预期为 JSON 数组的 AI 响应（parseJsonResponse + 对象包装自动解包）
 *
 * 背景（2026-08-28 第三方 API 数组类结果生成失败根因）：
 * `response_format: { type: 'json_object' }` 的语义是「顶层必须是 JSON object」。
 * DeepSeek 官方模型理解力强，prompt 要求顶层数组时仍会输出 `[...]`；
 * 但第三方/免费模型（如 OpenRouter 上的 nemotron）严格服从 schema 约束，
 * 会把数组包装成 `{"questions": [...]}` / `{"data": [...]}` 等单字段对象返回，
 * 导致调用方 `Array.isArray(result)` 校验失败（题目/词汇/短语生成报错）。
 *
 * 解包策略（两层约束防止静默错数据）：
 * 1. 解析结果为对象且恰好含一个数组类型字段
 * 2. 该数组的元素必须全部为非 null 对象（题目/词汇/短语元素均为对象结构）；
 *    若唯一数组是 `options` 等字符串数组（模型返回了裸的单个题目对象
 *    `{stem, options:[...], ...}`），不满足元素约束，按解析失败报错，
 *    避免把选项字符串数组误当题目数组返回给调用方
 * @param text AI 返回的原始文本
 * @returns 解析出的数组（可能为空数组，由调用方决定是否接受空）
 * @throws AIError 当内容无法解析为数组、也无法从对象包装中提取时抛出
 */
export function parseJsonArrayResponse<T>(
  text: string,
  options?: { allowPrimitives?: boolean },
): T[] {
  const result = parseJsonResponse<unknown>(text)
  if (Array.isArray(result)) {
    return result as T[]
  }
  if (result && typeof result === 'object') {
    // 元素类型约束：默认要求全为对象（题目/词汇/短语元素结构）；
    // allowPrimitives 为 true 时放宽为「非 null 即可」（emoji 助记等字符串数组场景，
    // json_object 模式下第三方模型会把 ["☀️"] 包成 {"emojis": ["☀️"]}）
    const isValidElement = options?.allowPrimitives
      ? (item: unknown) => item !== null
      : (item: unknown) => item !== null && typeof item === 'object'
    const objectArrayFields = Object.values(result).filter(
      (value): value is unknown[] =>
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(isValidElement),
    )
    if (objectArrayFields.length === 1) {
      return objectArrayFields[0] as T[]
    }
  }
  throw new AIError('AI 返回内容不是 JSON 数组，且无法从对象包装中提取唯一数组字段')
}

/**
 * 解析例句响应：兼容纯文本、JSON 字符串与 JSON 对象 {"sentence": "..."}
 * 复用解析逻辑，去除可能的 markdown 代码块包裹
 * @param text AI 返回的原始文本
 * @returns 解析后的例句字符串（已 trim）
 */
export function parseExampleSentence(text: string): string {
  const trimmed = text.trim()
  // 去除可能存在的 markdown 代码块包裹
  let content = trimmed
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenceMatch) {
    content = fenceMatch[1].trim()
  }
  // 尝试解析为 JSON：兼容 {"sentence":"..."} 或纯字符串
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'string') {
      return parsed.trim()
    }
    if (parsed && typeof parsed === 'object' && 'sentence' in parsed) {
      return String((parsed as { sentence: unknown }).sentence).trim()
    }
    // 其他 JSON 类型，回退到原文
    return content
  } catch (err) {
    // 非 JSON，直接返回文本
    if (import.meta.env.DEV)
      console.warn('[base-provider] 内容非 JSON 格式，按纯文本处理', err)
    return content
  }
}
