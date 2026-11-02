// 内容类任务：翻译 / 词汇提取 / 文章短语提取
//
// 三类任务均为「单次确定性输出」：走 callChatCached 永久缓存 + 轻量模型降级，
// 由 ContentTaskProvider 委托调用；执行上下文（传输能力）见 contentTaskIO.ts。
import type { ArticlePhrase } from '@/shared/types'
import { type ChatMessage, type VocabularyItem } from './types'
import { articlePhrasesPrompt, translationPrompt, vocabularyPrompt } from './prompts'
import { parseJsonArrayResponse } from './jsonParsing'
import type { ContentTaskIO } from './contentTaskIO'

/**
 * 生成翻译
 *
 * 翻译为成熟任务，使用轻量模型（如 deepseek-v4-flash）降低成本（约为 v4-pro 的 1/3）；
 * 同内容同译文，启用永久缓存避免重复请求。
 *
 * @param io 内容任务执行上下文
 * @param content 待翻译的文本内容
 * @returns 翻译后的文本（已 trim）
 * @throws AIError 当生成失败时抛出
 */
export async function runGenerateTranslation(io: ContentTaskIO, content: string): Promise<string> {
  return io.withAIError(async () => {
    const { system, user } = translationPrompt(content)
    const text = await io.callChatCached(
      'translation',
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        maxTokens: 768,
        modelOverride: io.getFlashModel(),
        ttlMs: Infinity, // 永久缓存
      },
    )
    return text.trim()
  }, '生成翻译失败')
}

/**
 * 提取词汇
 *
 * Phase 3 优化（2026-07-27）：
 * - 模型降级 v4-pro → v4-flash：词汇提取为机械性任务（识别中考高频词 + 附音标/词性/释义/例句），
 *   v4-flash 足够，单次成本降低 67%（v4-pro 3元/百万输入 → v4-flash 1元/百万输入）。
 * - 启用永久缓存：同文章同词汇结果稳定，重复打开页面时直接命中缓存（0 token 消耗）。
 * - thinkingDisabled: true：无需深度推理，关闭思考节省 500-1500 token/次。
 * - maxTokens: 1536：典型响应 ~1000 token（8-15 词 + 例句翻译），1.5x 上限 1536。
 *
 * @param io 内容任务执行上下文
 * @param content 文本内容
 * @returns 词汇项数组
 * @throws AIError 当提取失败或结果非有效数组时抛出
 */
export async function runExtractVocabulary(
  io: ContentTaskIO,
  content: string,
): Promise<VocabularyItem[]> {
  return runCachedArrayExtraction<VocabularyItem>(
    io,
    'vocabulary',
    vocabularyPrompt,
    content,
    '词汇提取失败',
  )
}

/**
 * 提取文章短语（为历史文章补全 phrases）
 *
 * 用于功能上线前生成的历史文章（article.phrases 为 undefined），
 * 从已有文章内容中提取 5-8 个重点短语，每个含 phrase/meaning/example/exampleTranslation。
 * 复用词汇提取策略：轻量模型 + 永久缓存 + 关闭思考 + maxTokens 1536。
 *
 * @param io 内容任务执行上下文
 * @param content 文章英文正文
 * @returns 短语数组
 * @throws AIError 当提取失败或结果非有效数组时抛出
 */
export async function runExtractArticlePhrases(
  io: ContentTaskIO,
  content: string,
): Promise<ArticlePhrase[]> {
  return runCachedArrayExtraction<ArticlePhrase>(
    io,
    'articlePhrases',
    articlePhrasesPrompt,
    content,
    '文章短语提取失败',
  )
}

/**
 * 缓存类数组提取任务的统一流程
 *
 * @param io 内容任务执行上下文
 * @param scenario 缓存场景标识
 * @param promptFactory 提示词构造函数
 * @param content 输入内容
 * @param fallbackMessage 非 AIError 异常包装后的兜底文案
 * @returns 解析后的数组
 * @throws AIError 当调用或解析失败时抛出
 */
async function runCachedArrayExtraction<T>(
  io: ContentTaskIO,
  scenario: string,
  promptFactory: (content: string) => { system: string; user: string },
  content: string,
  fallbackMessage: string,
): Promise<T[]> {
  return io.withAIError(async () => {
    const { system, user } = promptFactory(content)
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
    const text = await io.callChatCached(scenario, messages, {
      jsonMode: true,
      maxTokens: 1536,
      thinkingDisabled: true,
      modelOverride: io.getFlashModel(), // 轻量模型，节省约 2/3 成本
      ttlMs: Infinity, // 永久缓存
      expectArray: true,
    })
    return parseJsonArrayResponse<T>(text)
  }, fallbackMessage)
}
