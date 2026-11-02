// AI Provider 内容类任务：文章 / 题目 / 语法填空 / 翻译 / 词汇 / 短语
//
// 本文件仅保留类声明与执行上下文构造，具体 prompt 组织、调用参数与结果校验按领域拆分：
//   - contentArticleTasks.ts：文章生成（含结果校验重试）
//   - contentQuestionTasks.ts：题目 / 语法填空（流式 + 非流式降级 + 永久缓存）
//   - contentTextTasks.ts：翻译 / 词汇 / 文章短语（轻量模型 + 永久缓存）
// 单词类任务见 providerWordTasks.ts。
import type {
  ArticleGenerationResult,
  Genre,
  QuestionGenerationResult,
  StreamOptions,
  VocabularyItem,
} from './types'
import type { ArticlePhrase, Difficulty, Topic } from '@/shared/types'
import { ProviderCore } from './providerCore'
import type { ContentTaskIO } from './contentTaskIO'
import { runGenerateArticle } from './contentArticleTasks'
import { runGenerateGrammarFillQuestions, runGenerateQuestions } from './contentQuestionTasks'
import {
  runExtractArticlePhrases,
  runExtractVocabulary,
  runGenerateTranslation,
} from './contentTextTasks'

export abstract class ContentTaskProvider extends ProviderCore {
  /**
   * 构造任务执行上下文
   *
   * ProviderCore 的传输能力为 protected，拆分出的任务模块通过该闭包上下文调用，
   * 既保持封装边界，也避免把内部传输方法提升为公开 API。
   * @returns 内容任务执行上下文
   */
  private contentTaskIO(): ContentTaskIO {
    return {
      callChat: (messages, options) => this.callChat(messages, options),
      callChatCached: (scenario, messages, options) =>
        this.callChatCached(scenario, messages, options),
      callChatStream: (messages, options) => this.callChatStream(messages, options),
      withAIError: <T>(fn: () => Promise<T>, fallbackMsg: string) =>
        this.withAIError(fn, fallbackMsg),
      getFlashModel: () => this.getFlashModel(),
    }
  }

  /**
   * 生成文章（详见 contentArticleTasks.ts）
   * @param date 日期字符串
   * @param genre 文章体裁（可选）
   * @param topic 文章主题（可选）
   * @param difficulty 难度等级（可选）
   * @param avoidTopics 需回避的主题列表（可选）
   * @param streamOptions 流式选项（可选）
   * @returns 文章生成结果
   */
  async generateArticle(
    date: string,
    genre?: Genre,
    topic?: Topic,
    difficulty?: Difficulty,
    avoidTopics?: string[],
    streamOptions?: StreamOptions,
  ): Promise<ArticleGenerationResult> {
    return runGenerateArticle(
      this.contentTaskIO(),
      date,
      genre,
      topic,
      difficulty,
      avoidTopics,
      streamOptions,
    )
  }

  /**
   * 生成阅读理解题目（详见 contentQuestionTasks.ts）
   * @param articleId 文章 ID
   * @param articleContent 文章正文内容
   * @param genre 文章体裁（可选）
   * @param streamOptions 流式选项（可选）
   * @returns 题目数组
   */
  async generateQuestions(
    articleId: string,
    articleContent: string,
    genre?: Genre,
    streamOptions?: StreamOptions,
  ): Promise<QuestionGenerationResult[]> {
    return runGenerateQuestions(
      this.contentTaskIO(),
      articleId,
      articleContent,
      genre,
      streamOptions,
    )
  }

  /**
   * 生成语法填空题（详见 contentQuestionTasks.ts）
   * @param articleId 文章 ID
   * @param articleContent 文章正文内容
   * @param streamOptions 流式选项（可选）
   * @returns 语法填空题目数组
   */
  async generateGrammarFillQuestions(
    articleId: string,
    articleContent: string,
    streamOptions?: StreamOptions,
  ): Promise<QuestionGenerationResult[]> {
    return runGenerateGrammarFillQuestions(
      this.contentTaskIO(),
      articleId,
      articleContent,
      streamOptions,
    )
  }

  /**
   * 生成翻译（详见 contentTextTasks.ts）
   * @param content 待翻译的文本内容
   * @returns 翻译后的文本（已 trim）
   */
  async generateTranslation(content: string): Promise<string> {
    return runGenerateTranslation(this.contentTaskIO(), content)
  }

  /**
   * 提取词汇（详见 contentTextTasks.ts）
   * @param content 文本内容
   * @returns 词汇项数组
   */
  async extractVocabulary(content: string): Promise<VocabularyItem[]> {
    return runExtractVocabulary(this.contentTaskIO(), content)
  }

  /**
   * 提取文章短语（详见 contentTextTasks.ts）
   * @param content 文章英文正文
   * @returns 短语数组
   */
  async extractArticlePhrases(content: string): Promise<ArticlePhrase[]> {
    return runExtractArticlePhrases(this.contentTaskIO(), content)
  }
}
