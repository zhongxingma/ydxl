// 内容类任务：文章生成
//
// 由 ContentTaskProvider 委托调用；执行上下文（传输能力）见 contentTaskIO.ts。
import { logger } from '../../utils/logger'
import {
  AIError,
  type ArticleGenerationResult,
  type ChatMessage,
  type Genre,
  type StreamOptions,
} from './types'
import type { Difficulty, Topic } from '@/shared/types'
import { articlePrompt } from './prompts'
import { parseJsonResponse } from './jsonParsing'
import type { ContentTaskIO } from './contentTaskIO'

/**
 * 生成文章
 *
 * 优化：
 * - thinkingDisabled: true：文章结构由 JSON schema 严格约束（200-300 词、文体/题材/难度指定、生词预标注），
 *   创作自由度有限，关闭思考节省 500-1500 token/次（v4-pro 输出价 6 元/M）。
 *   若文章质量下降可移除 thinkingDisabled 参数回滚到思考模式。
 * - maxTokens: 3072：典型响应 ~2000 token（文章+翻译+生词+短语），1.5x 上限 3072
 * - temperature: 0.9：文章为创作型任务，关闭思考后模型易套用训练数据的固定安全句式，
 *   导致题材/文体不同却行文雷同；显式提高采样温度（0.9）增加用词与句式多样性，
 *   配合 articlePrompt 的随机叙事视角注入共同打破「千篇一律」
 *
 * @param io 内容任务执行上下文
 * @param date 日期字符串
 * @param genre 文章体裁（可选）
 * @param topic 文章主题（可选）
 * @param difficulty 难度等级（可选）
 * @param avoidTopics 需回避的主题列表（可选）
 * @param streamOptions 流式选项（可选）
 * @returns 文章生成结果（含标题、正文、翻译等字段）
 * @throws AIError 当生成失败或结果缺少必要字段时抛出
 */
export async function runGenerateArticle(
  io: ContentTaskIO,
  date: string,
  genre?: Genre,
  topic?: Topic,
  difficulty?: Difficulty,
  avoidTopics?: string[],
  streamOptions?: StreamOptions,
): Promise<ArticleGenerationResult> {
  return io.withAIError(async () => {
    const { system, user } = articlePrompt(date, genre, topic, difficulty, avoidTopics)
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]

    // 结果校验失败重试：轻量模型（如第三方 Flash）生成复杂 JSON 偶发缺字段/高亮词为空，
    // 单次结果不合格不应立即抛错触发 FallbackAIProvider 切换官方兜底（违背「自定义可用优先」）。
    // 此处对「JSON 解析 + 字段校验」的失败在同一供应商内重试（合计最多 3 次），
    // 仅在重试耗尽后才抛出；网络/超时/中断类错误不在此重试（callChat 内部已处理）。
    const MAX_RESULT_ATTEMPTS = 3
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_RESULT_ATTEMPTS; attempt++) {
      // 生成文本：流式（失败降级非流式）或非流式
      let text: string
      if (streamOptions) {
        // 流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式
        try {
          text = await io.callChatStream(messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            scenario: 'article',
            signal: streamOptions.signal,
            onChunk: streamOptions.onChunk,
            temperature: 0.9,
          })
        } catch (err) {
          // 外部中断不降级，直接抛出
          if (err instanceof Error && err.name === 'AbortError') throw err
          logger.warn('[generateArticle] 流式生成失败，降级到非流式模式', err)
          // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
          streamOptions.onChunk?.('', '')
          text = await io.callChat(messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            scenario: 'article',
            temperature: 0.9,
          })
        }
      } else {
        text = await io.callChat(messages, {
          jsonMode: true,
          maxTokens: 3072,
          thinkingDisabled: true,
          scenario: 'article',
          temperature: 0.9,
        })
      }

      // 解析 + 字段校验；失败视为「结果不合格」重试同供应商
      try {
        const result = parseJsonResponse<ArticleGenerationResult>(text)
        // 逐一校验必要字段，缺失时精确提示
        const requiredFields: { key: keyof ArticleGenerationResult; label: string }[] = [
          { key: 'title', label: 'title' },
          { key: 'content', label: 'content' },
          { key: 'translation', label: 'translation' },
          { key: 'genre', label: 'genre' },
          { key: 'wordCount', label: 'wordCount' },
          { key: 'topic', label: 'topic' },
          { key: 'difficulty', label: 'difficulty' },
          { key: 'lexileRange', label: 'lexileRange' },
          { key: 'highlightedWords', label: 'highlightedWords' },
        ]
        for (const { key, label } of requiredFields) {
          if (result[key] == null || result[key] === '') {
            throw new AIError(`文章生成结果缺少必要字段: ${label}`)
          }
        }
        // highlightedWords 强化校验：必须是非空数组
        // 第三方/开源模型偶发返回空数组（字段存在但内容缺失），空数组会让文章无高亮生词；
        // 视为不合格结果重试；重试耗尽后由上层降级到兜底素材库（自带完整 highlightedWords）
        if (!Array.isArray(result.highlightedWords) || result.highlightedWords.length === 0) {
          throw new AIError('文章生成结果缺少必要字段: highlightedWords（为空数组）')
        }
        return result
      } catch (err) {
        lastError = err
        if (attempt + 1 < MAX_RESULT_ATTEMPTS) {
          logger.warn(
            `[generateArticle] 结果校验失败（第 ${attempt + 1}/${MAX_RESULT_ATTEMPTS} 次），重试同供应商`,
            err,
          )
          continue
        }
        throw err
      }
    }
    // 理论上不可达（循环末次校验失败会 throw），保留以满足 noImplicitReturns
    throw lastError
  }, '生成文章失败')
}
