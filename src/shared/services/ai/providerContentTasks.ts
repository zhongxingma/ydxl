// AI Provider 内容类任务：文章 / 题目 / 语法填空 / 翻译 / 词汇 / 短语
//
// 继承 ProviderCore 的传输与配置能力，仅负责 prompt 组织、调用参数与结果校验。
// 单词类任务见 providerWordTasks.ts。
import {
  AIError,
  type ArticleGenerationResult,
  type ChatMessage,
  type Genre,
  type QuestionGenerationResult,
  type StreamOptions,
  type VocabularyItem,
} from './types'
import type { ArticlePhrase, Difficulty, Topic } from '@/shared/types'
import {
  articlePhrasesPrompt,
  articlePrompt,
  grammarFillPrompt,
  questionsPrompt,
  translationPrompt,
  vocabularyPrompt,
} from './prompts'
import {
  parseJsonArrayResponse,
  parseJsonResponse,
} from './jsonParsing'
import { ProviderCore } from './providerCore'

export abstract class ContentTaskProvider extends ProviderCore {
  /**
   * 生成文章
   *
   * Phase 2 优化：
   * - thinkingDisabled: true：文章结构由 JSON schema 严格约束（200-300 词、文体/题材/难度指定、生词预标注），
   *   创作自由度有限，关闭思考节省 500-1500 token/次（v4-pro 输出价 6 元/M）。
   *   若文章质量下降可移除 thinkingDisabled 参数回滚到思考模式。
   * - maxTokens: 3072：典型响应 ~2000 token（文章+翻译+生词+短语），1.5x 上限 3072
   * - temperature: 0.9：文章为创作型任务，关闭思考后模型易套用训练数据的固定安全句式，
   *   导致题材/文体不同却行文雷同；显式提高采样温度（0.9）增加用词与句式多样性，
   *   配合 articlePrompt 的随机叙事视角注入共同打破「千篇一律」（2026-09-05）
   *
   * @param date 日期字符串
   * @param genre 文章体裁（可选）
   * @param topic 文章主题（可选）
   * @param difficulty 难度等级（可选）
   * @param avoidTopics 需回避的主题列表（可选）
   * @returns 文章生成结果（含标题、正文、翻译等字段）
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateArticle(
    date: string,
    genre?: Genre,
    topic?: Topic,
    difficulty?: Difficulty,
    avoidTopics?: string[],
    streamOptions?: StreamOptions
  ): Promise<ArticleGenerationResult> {
    return this.withAIError(async () => {
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
          // Phase 3：流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式
          try {
            text = await this.callChatStream(messages, {
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
            console.warn('[generateArticle] 流式生成失败，降级到非流式模式', err)
            // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
            streamOptions.onChunk?.('', '')
            text = await this.callChat(messages, {
              jsonMode: true,
              maxTokens: 3072,
              thinkingDisabled: true,
              scenario: 'article',
              temperature: 0.9,
            })
          }
        } else {
          text = await this.callChat(messages, {
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
            console.warn(
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

  /**
   * 生成阅读理解题目
   *
   * 优化（2026-07-26 修复练习题生成失败问题）：
   * - thinkingDisabled: true：命题虽需推理干扰项迷惑性，但 DeepSeek V4-Pro 基础能力足够，
   *   关闭思考可避免思考过程消耗 500-1500 token 导致 maxTokens 预算不足。
   *   思考模式 + JSON Output 模式存在已知的内容截断与空 content 问题（DeepSeek 官方文档：
   *   https://api-docs.deepseek.com/zh-cn/guides/json_mode），禁用思考后稳定性显著提升。
   *   与 generateArticle / extractVocabulary 保持一致策略（结构化 JSON 任务一律禁用思考）。
   *   若命题质量下降可恢复 reasoningEffort: 'high' 并将 maxTokens 提至 4096+。
   * - maxTokens: 3072：典型响应 ~1500 token（3-5 题 + stem/options/explanation/locationClue），
   *   预留 1.5x 上限 3072，避免 phrases 较多时被截断导致 JSON 解析失败
   *
   * Phase 3 优化（2026-07-27）：
   * - 启用 7 天缓存：失败重试时（JSON 解析失败、网络错误后）直接命中缓存，避免重复调用 AI；
   *   同文章二次请求题目时（用户清除本地数据后重新阅读）直接返回缓存。
   *   questionService 数据库持久化已避免大部分重复，缓存仅作为兜底（命中率预计 10-20%）。
   *   注意：不使用 modelOverride，保持 v4-pro 命题质量。
   *
   * @param articleId 文章 ID
   * @param articleContent 文章正文内容
   * @returns 题目数组
   * @throws AIError 当生成失败或结果非有效非空数组时抛出
   */
  async generateQuestions(
    articleId: string,
    articleContent: string,
    genre?: Genre,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]> {
    return this.withAIError(async () => {
      const { system, user } = questionsPrompt(articleId, articleContent, genre)
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]
      let text: string
      if (streamOptions) {
        // Phase 3：流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式 + 7 天缓存
        try {
          text = await this.callChatStream(messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            scenario: 'questions',
            signal: streamOptions.signal,
            onChunk: streamOptions.onChunk,
            expectArray: true,
          })
        } catch (err) {
          // 外部中断不降级，直接抛出
          if (err instanceof Error && err.name === 'AbortError') throw err
          console.warn('[generateQuestions] 流式生成失败，降级到非流式模式', err)
          // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
          streamOptions.onChunk?.('', '')
          text = await this.callChatCached('questions', messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            ttlMs: Infinity, // 永久缓存（同文章同题目）
            expectArray: true,
          })
        }
      } else {
        // 非流式：使用 callChatCached（7 天缓存兜底失败重试）
        text = await this.callChatCached('questions', messages, {
          jsonMode: true,
          maxTokens: 3072,
          thinkingDisabled: true,
          ttlMs: Infinity, // 永久缓存（同文章同题目）
          expectArray: true,
        })
      }
      const result = parseJsonArrayResponse<QuestionGenerationResult>(text)
      if (result.length === 0) {
        throw new AIError('题目生成结果不是有效的非空数组')
      }
      return result
    }, '生成题目失败')
  }

  /**
   * 生成语法填空题
   * 从文章中选取含典型语法点的句子挖空，生成 2-3 道选择填空题
   * explanation 须深度透彻：语法知识点 + 正确项依据 + 干扰项排除 + 拓展知识
   * 复用 generateQuestions 的流式 + 降级 + 缓存模式
   *
   * @param articleId 文章 ID
   * @param articleContent 文章正文内容
   * @param streamOptions 流式选项（可选）
   * @returns 语法填空题目数组
   * @throws AIError 当生成失败或结果非有效非空数组时抛出
   */
  async generateGrammarFillQuestions(
    articleId: string,
    articleContent: string,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]> {
    return this.withAIError(async () => {
      const { system, user } = grammarFillPrompt(articleId, articleContent)
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]
      let text: string
      if (streamOptions) {
        // 流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式 + 7 天缓存
        try {
          text = await this.callChatStream(messages, {
            jsonMode: true,
            maxTokens: 4096,
            thinkingDisabled: true,
            scenario: 'grammar_fill',
            signal: streamOptions.signal,
            onChunk: streamOptions.onChunk,
            expectArray: true,
          })
        } catch (err) {
          // 外部中断不降级，直接抛出
          if (err instanceof Error && err.name === 'AbortError') throw err
          console.warn('[generateGrammarFillQuestions] 流式生成失败，降级到非流式模式', err)
          // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
          streamOptions.onChunk?.('', '')
          text = await this.callChatCached('grammar_fill', messages, {
            jsonMode: true,
            maxTokens: 4096,
            thinkingDisabled: true,
            ttlMs: Infinity, // 永久缓存
            expectArray: true,
          })
        }
      } else {
        // 非流式：使用 callChatCached（7 天缓存兜底失败重试）
        text = await this.callChatCached('grammar_fill', messages, {
          jsonMode: true,
          maxTokens: 4096,
          thinkingDisabled: true,
          ttlMs: Infinity, // 永久缓存
          expectArray: true,
        })
      }
      const result = parseJsonArrayResponse<QuestionGenerationResult>(text)
      if (result.length === 0) {
        throw new AIError('语法填空题生成结果不是有效的非空数组')
      }
      return result
    }, '生成语法填空题失败')
  }

  /**
   * 生成翻译
   * 翻译为成熟任务，使用 deepseek-v4-flash 降低成本（约为 v4-pro 的 1/3）
   * 同内容同译文，启用 30 天缓存避免重复请求
   * @param content 待翻译的文本内容
   * @returns 翻译后的文本（已 trim）
   * @throws AIError 当生成失败时抛出
   */
  async generateTranslation(content: string): Promise<string> {
    return this.withAIError(async () => {
      const { system, user } = translationPrompt(content)
      const text = await this.callChatCached(
        'translation',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          maxTokens: 768,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
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
   * - 启用 24 小时缓存：同文章同词汇结果稳定，重复打开页面时直接命中缓存（0 token 消耗）。
   *   缓存命中率预计 30-50%（用户反复阅读同文章场景）。
   * - thinkingDisabled: true：无需深度推理，关闭思考节省 500-1500 token/次。
   * - maxTokens: 1536：典型响应 ~1000 token（8-15 词 + 例句翻译），1.5x 上限 1536。
   *
   * @param content 文本内容
   * @returns 词汇项数组
   * @throws AIError 当提取失败或结果非有效数组时抛出
   */
  async extractVocabulary(content: string): Promise<VocabularyItem[]> {
    return this.withAIError(async () => {
      const { system, user } = vocabularyPrompt(content)
      const text = await this.callChatCached(
        'vocabulary',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 1536,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(), // v4-pro → v4-flash，节省 2/3 成本
          ttlMs: Infinity, // 永久缓存（同文章同词汇）
          expectArray: true,
        }
      )
      const result = parseJsonArrayResponse<VocabularyItem>(text)
      return result
    }, '词汇提取失败')
  }

  /**
   * 提取文章短语（为历史文章补全 phrases）
   *
   * 用于功能上线前生成的历史文章（article.phrases 为 undefined），
   * 从已有文章内容中提取 5-8 个重点短语，每个含 phrase/meaning/example/exampleTranslation。
   *
   * 复用 extractVocabulary 的策略：
   * - 模型使用 deepseek-v4-flash：短语提取为机械性任务，flash 足够
   * - 启用 24 小时缓存：同文章同短语结果稳定，重复打开页面直接命中缓存
   * - thinkingDisabled: true：无需深度推理，关闭思考节省 token
   * - maxTokens: 1536：典型响应 ~1000 token（5-8 短语 + 例句翻译），1.5x 上限 1536
   *
   * @param content 文章英文正文
   * @returns 短语数组
   * @throws AIError 当提取失败或结果非有效非空数组时抛出
   */
  async extractArticlePhrases(content: string): Promise<ArticlePhrase[]> {
    return this.withAIError(async () => {
      const { system, user } = articlePhrasesPrompt(content)
      const text = await this.callChatCached(
        'articlePhrases',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 1536,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(), // v4-pro → v4-flash，节省 2/3 成本
          ttlMs: Infinity, // 永久缓存（同文章同短语）
          expectArray: true,
        }
      )
      const result = parseJsonArrayResponse<ArticlePhrase>(text)
      return result
    }, '文章短语提取失败')
  }
}
