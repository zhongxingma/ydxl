// 自定义 API 优先 + DeepSeek 兜底的降级供应商
//
// 设计（2026-08-29「自定义 API 优先调用、DeepSeek 兜底」策略）：
// - primary（自定义 API）调用失败时自动切换 fallback（DeepSeek）重试同一请求
// - 兜底供应商密钥未配置时视为兜底不可用，抛回主供应商原始错误（更具诊断价值）
// - 两者都失败时抛聚合 AIError（message 携带两侧错误摘要，cause 保留兜底错误）
// - 流式调用（streamOptions）在已向前端输出 chunk 后不再降级——重放会导致内容重复，
//   此时直接抛出主供应商错误，由上层（如 articleService 的兜底素材库）接管
import type {
  AIProvider,
  StreamOptions,
  ArticleGenerationResult,
  Genre,
  QuestionGenerationResult,
  VocabularyItem,
  WordHint,
  WordBreakdown,
  MnemonicResult,
} from './types'
import type { Topic, Difficulty, ArticlePhrase } from '@/shared/types'
import { AIError } from './types'

// 密钥未配置错误匹配（与 baseProvider 的消息模板保持同步：
// `未配置 ${providerName()} apiKey 且未设置代理地址，无法发起请求`）
const KEY_NOT_CONFIGURED_RE = /未配置 \S+ apiKey 且未设置代理地址/

function isKeyNotConfiguredError(err: unknown): boolean {
  return err instanceof Error && KEY_NOT_CONFIGURED_RE.test(err.message)
}

/**
 * 包装 streamOptions 追踪是否已向前端发出流式 chunk
 * - onChunk 首次触发时置位；降级决策用（已发出则不可重放）
 * - 未传 streamOptions（非流式调用）时恒为 false，始终允许降级
 */
function trackStreamChunks(streamOptions?: StreamOptions): {
  options: StreamOptions | undefined
  hasEmittedChunks: () => boolean
} {
  if (!streamOptions) {
    return { options: undefined, hasEmittedChunks: () => false }
  }
  let emitted = false
  return {
    options: {
      ...streamOptions,
      onChunk: (delta: string, fullText: string) => {
        emitted = true
        streamOptions.onChunk?.(delta, fullText)
      },
    },
    hasEmittedChunks: () => emitted,
  }
}

/**
 * 降级供应商：自定义 API 优先调用，失败时自动切换 DeepSeek 兜底
 *
 * 覆盖 AIProvider 全部 12 个方法；每个方法 primary 失败后以相同参数调用 fallback。
 * 降级发生时输出 console.warn（避免静默吞错，便于生产排查）。
 */
export class FallbackAIProvider implements AIProvider {
  constructor(
    private readonly primary: AIProvider,
    private readonly fallback: AIProvider,
    private readonly primaryLabel = '自定义 API',
    private readonly fallbackLabel = 'DeepSeek',
  ) {}

  /**
   * 核心降级逻辑：primary →（失败）→ fallback →（也失败）→ 聚合错误
   * @param methodName 方法名（日志用）
   * @param invokePrimary 主供应商调用闭包
   * @param invokeFallback 兜底供应商调用闭包
   * @param canFallback 降级前置条件（流式已发出 chunk 时为 false）
   */
  private async callWithFallback<T>(
    methodName: string,
    invokePrimary: () => Promise<T>,
    invokeFallback: () => Promise<T>,
    canFallback: () => boolean = () => true,
  ): Promise<T> {
    try {
      return await invokePrimary()
    } catch (primaryErr) {
      // 流式已输出 chunk：重放会导致前端内容重复，直接抛出主供应商错误
      if (!canFallback()) throw primaryErr
      console.warn(
        `[fallback-provider] ${this.primaryLabel}.${methodName} 调用失败，自动切换 ${this.fallbackLabel} 兜底`,
        primaryErr,
      )
      try {
        return await invokeFallback()
      } catch (fallbackErr) {
        // 兜底供应商密钥未配置：视为兜底不可用，抛回主供应商原始错误
        if (isKeyNotConfiguredError(fallbackErr)) throw primaryErr
        // 两侧均失败：聚合错误（cause 保留兜底错误，便于调试追溯）
        throw new AIError(
          `${this.primaryLabel} 与兜底 ${this.fallbackLabel} 均调用失败（${methodName}）：` +
            `[${this.primaryLabel}] ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}；` +
            `[${this.fallbackLabel}] ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
          fallbackErr,
        )
      }
    }
  }

  generateArticle(
    date: string,
    genre?: Genre,
    topic?: Topic,
    difficulty?: Difficulty,
    avoidTopics?: string[],
    streamOptions?: StreamOptions,
  ): Promise<ArticleGenerationResult> {
    const tracked = trackStreamChunks(streamOptions)
    return this.callWithFallback(
      'generateArticle',
      () =>
        this.primary.generateArticle(date, genre, topic, difficulty, avoidTopics, tracked.options),
      () =>
        this.fallback.generateArticle(date, genre, topic, difficulty, avoidTopics, streamOptions),
      () => !tracked.hasEmittedChunks(),
    )
  }

  generateQuestions(
    articleId: string,
    articleContent: string,
    genre?: Genre,
    streamOptions?: StreamOptions,
  ): Promise<QuestionGenerationResult[]> {
    const tracked = trackStreamChunks(streamOptions)
    return this.callWithFallback(
      'generateQuestions',
      () => this.primary.generateQuestions(articleId, articleContent, genre, tracked.options),
      () => this.fallback.generateQuestions(articleId, articleContent, genre, streamOptions),
      () => !tracked.hasEmittedChunks(),
    )
  }

  generateGrammarFillQuestions(
    articleId: string,
    articleContent: string,
    streamOptions?: StreamOptions,
  ): Promise<QuestionGenerationResult[]> {
    const tracked = trackStreamChunks(streamOptions)
    return this.callWithFallback(
      'generateGrammarFillQuestions',
      () =>
        this.primary.generateGrammarFillQuestions(articleId, articleContent, tracked.options),
      () =>
        this.fallback.generateGrammarFillQuestions(articleId, articleContent, streamOptions),
      () => !tracked.hasEmittedChunks(),
    )
  }

  generateTranslation(content: string): Promise<string> {
    return this.callWithFallback(
      'generateTranslation',
      () => this.primary.generateTranslation(content),
      () => this.fallback.generateTranslation(content),
    )
  }

  extractVocabulary(content: string): Promise<VocabularyItem[]> {
    return this.callWithFallback(
      'extractVocabulary',
      () => this.primary.extractVocabulary(content),
      () => this.fallback.extractVocabulary(content),
    )
  }

  extractArticlePhrases(content: string): Promise<ArticlePhrase[]> {
    return this.callWithFallback(
      'extractArticlePhrases',
      () => this.primary.extractArticlePhrases(content),
      () => this.fallback.extractArticlePhrases(content),
    )
  }

  generateWordHint(word: string, definition: string): Promise<WordHint> {
    return this.callWithFallback(
      'generateWordHint',
      () => this.primary.generateWordHint(word, definition),
      () => this.fallback.generateWordHint(word, definition),
    )
  }

  generateWordBreakdown(word: string): Promise<WordBreakdown> {
    return this.callWithFallback(
      'generateWordBreakdown',
      () => this.primary.generateWordBreakdown(word),
      () => this.fallback.generateWordBreakdown(word),
    )
  }

  generateMnemonic(word: string, definition: string, root?: string): Promise<MnemonicResult> {
    return this.callWithFallback(
      'generateMnemonic',
      () => this.primary.generateMnemonic(word, definition, root),
      () => this.fallback.generateMnemonic(word, definition, root),
    )
  }

  generateExampleSentence(word: string, definition: string): Promise<string> {
    return this.callWithFallback(
      'generateExampleSentence',
      () => this.primary.generateExampleSentence(word, definition),
      () => this.fallback.generateExampleSentence(word, definition),
    )
  }

  generateEmojiHint(word: string, definition: string): Promise<string[]> {
    return this.callWithFallback(
      'generateEmojiHint',
      () => this.primary.generateEmojiHint(word, definition),
      () => this.fallback.generateEmojiHint(word, definition),
    )
  }

  enrichSingleWord(word: string): Promise<VocabularyItem> {
    return this.callWithFallback(
      'enrichSingleWord',
      () => this.primary.enrichSingleWord(word),
      () => this.fallback.enrichSingleWord(word),
    )
  }

  testConnection(): Promise<void> {
    return this.callWithFallback(
      'testConnection',
      () => this.primary.testConnection(),
      () => this.fallback.testConnection(),
    )
  }
}

/**
 * 创建「不可用」的哑供应商：所有方法抛出指定错误
 * 用于自定义模型配置不完整（endpoint/model 缺失）时的 primary——
 * 保持 FallbackAIProvider 的统一降级链路（哑 primary 失败 → DeepSeek 兜底；
 * DeepSeek 密钥也未配置时抛回配置错误，由上层业务降级处理）
 */
export function createUnavailableProvider(reason: string): AIProvider {
  const fail = async (): Promise<never> => {
    throw new AIError(reason)
  }
  return {
    generateArticle: fail,
    generateQuestions: fail,
    generateGrammarFillQuestions: fail,
    generateTranslation: fail,
    extractVocabulary: fail,
    extractArticlePhrases: fail,
    generateWordHint: fail,
    generateWordBreakdown: fail,
    generateMnemonic: fail,
    generateExampleSentence: fail,
    generateEmojiHint: fail,
    enrichSingleWord: fail,
    testConnection: fail,
  }
}
