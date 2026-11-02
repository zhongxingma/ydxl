// 内容类任务：阅读理解题目 / 语法填空题目
//
// 两类题目共用同一执行流程：流式优先 → 流式失败降级非流式 → 永久缓存 → 非空数组校验。
// 由 ContentTaskProvider 委托调用；执行上下文（传输能力）见 contentTaskIO.ts。
import { logger } from '../../utils/logger'
import {
  AIError,
  type ChatMessage,
  type Genre,
  type QuestionGenerationResult,
  type StreamOptions,
} from './types'
import { grammarFillPrompt, questionsPrompt } from './prompts'
import { parseJsonArrayResponse } from './jsonParsing'
import type { ContentTaskIO } from './contentTaskIO'

interface QuestionArrayTaskConfig {
  scenario: string
  messages: ChatMessage[]
  maxTokens: number
  // 日志前缀（保留与原方法名一致的定位信息）
  logLabel: string
  // 结果为空数组时的错误文案
  emptyMessage: string
  // 非 AIError 异常包装后的兜底文案
  fallbackMessage: string
}

/**
 * 生成阅读理解题目
 *
 * 优化（2026-07-26 修复练习题生成失败问题）：
 * - thinkingDisabled: true：命题虽需推理干扰项迷惑性，但 DeepSeek V4-Pro 基础能力足够，
 *   关闭思考可避免思考过程消耗 500-1500 token 导致 maxTokens 预算不足。
 *   思考模式 + JSON Output 模式存在已知的内容截断与空 content 问题（DeepSeek 官方文档：
 *   https://api-docs.deepseek.com/zh-cn/guides/json_mode），禁用思考后稳定性显著提升。
 * - maxTokens: 3072：典型响应 ~1500 token（3-5 题 + stem/options/explanation/locationClue），
 *   预留 1.5x 上限 3072，避免 phrases 较多时被截断导致 JSON 解析失败
 *
 * Phase 3 优化（2026-07-27）：
 * - 启用永久缓存：失败重试时（JSON 解析失败、网络错误后）直接命中缓存，避免重复调用 AI；
 *   questionService 数据库持久化已避免大部分重复，缓存仅作为兜底（命中率预计 10-20%）。
 *
 * @param io 内容任务执行上下文
 * @param articleId 文章 ID
 * @param articleContent 文章正文内容
 * @param genre 文章体裁（可选）
 * @param streamOptions 流式选项（可选）
 * @returns 题目数组
 * @throws AIError 当生成失败或结果非有效非空数组时抛出
 */
export async function runGenerateQuestions(
  io: ContentTaskIO,
  articleId: string,
  articleContent: string,
  genre?: Genre,
  streamOptions?: StreamOptions,
): Promise<QuestionGenerationResult[]> {
  const { system, user } = questionsPrompt(articleId, articleContent, genre)
  return runQuestionArrayTask(
    io,
    {
      scenario: 'questions',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 3072,
      logLabel: 'generateQuestions',
      emptyMessage: '题目生成结果不是有效的非空数组',
      fallbackMessage: '生成题目失败',
    },
    streamOptions,
  )
}

/**
 * 生成语法填空题
 *
 * 从文章中选取含典型语法点的句子挖空，生成 2-3 道选择填空题；
 * explanation 须深度透彻：语法知识点 + 正确项依据 + 干扰项排除 + 拓展知识。
 * 复用阅读题目的流式 + 降级 + 缓存模式，maxTokens 提高至 4096。
 *
 * @param io 内容任务执行上下文
 * @param articleId 文章 ID
 * @param articleContent 文章正文内容
 * @param streamOptions 流式选项（可选）
 * @returns 语法填空题目数组
 * @throws AIError 当生成失败或结果非有效非空数组时抛出
 */
export async function runGenerateGrammarFillQuestions(
  io: ContentTaskIO,
  articleId: string,
  articleContent: string,
  streamOptions?: StreamOptions,
): Promise<QuestionGenerationResult[]> {
  const { system, user } = grammarFillPrompt(articleId, articleContent)
  return runQuestionArrayTask(
    io,
    {
      scenario: 'grammar_fill',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 4096,
      logLabel: 'generateGrammarFillQuestions',
      emptyMessage: '语法填空题生成结果不是有效的非空数组',
      fallbackMessage: '生成语法填空题失败',
    },
    streamOptions,
  )
}

/**
 * 题目类任务的统一执行流程
 *
 * @param io 内容任务执行上下文
 * @param config 场景配置（scenario / messages / maxTokens / 文案）
 * @param streamOptions 流式选项（可选）
 * @returns 非空题目数组
 * @throws AIError 当生成失败或结果非有效非空数组时抛出
 */
async function runQuestionArrayTask(
  io: ContentTaskIO,
  config: QuestionArrayTaskConfig,
  streamOptions?: StreamOptions,
): Promise<QuestionGenerationResult[]> {
  return io.withAIError(async () => {
    let text: string
    if (streamOptions) {
      // 流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式 + 永久缓存
      try {
        text = await io.callChatStream(config.messages, {
          jsonMode: true,
          maxTokens: config.maxTokens,
          thinkingDisabled: true,
          scenario: config.scenario,
          signal: streamOptions.signal,
          onChunk: streamOptions.onChunk,
          expectArray: true,
        })
      } catch (err) {
        // 外部中断不降级，直接抛出
        if (err instanceof Error && err.name === 'AbortError') throw err
        logger.warn(`[${config.logLabel}] 流式生成失败，降级到非流式模式`, err)
        // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
        streamOptions.onChunk?.('', '')
        text = await io.callChatCached(config.scenario, config.messages, {
          jsonMode: true,
          maxTokens: config.maxTokens,
          thinkingDisabled: true,
          ttlMs: Infinity, // 永久缓存
          expectArray: true,
        })
      }
    } else {
      // 非流式：使用 callChatCached
      text = await io.callChatCached(config.scenario, config.messages, {
        jsonMode: true,
        maxTokens: config.maxTokens,
        thinkingDisabled: true,
        ttlMs: Infinity, // 永久缓存
        expectArray: true,
      })
    }
    const result = parseJsonArrayResponse<QuestionGenerationResult>(text)
    if (result.length === 0) {
      throw new AIError(config.emptyMessage)
    }
    return result
  }, config.fallbackMessage)
}
