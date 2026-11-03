// AI Provider 单词类任务：单词提示 / 拼读 / 助记 / 例句 / emoji / 连通性测试 / 单词补全
//
// 继承 ContentTaskProvider（进而继承 ProviderCore），完成 AIProvider 接口的全部方法。
// 这些任务的共同特征：输入为单个单词或简短文本，使用 flash 模型 + 永久/长期缓存。
import {
  AIError,
  type AIProvider,
  type MnemonicResult,
  type VocabularyItem,
  type WordBreakdown,
  type WordHint,
} from './types'
import {
  emojiHintPrompt,
  exampleSentencePrompt,
  mnemonicPrompt,
  wordBreakdownPrompt,
  wordEnrichPrompt,
  wordHintPrompt,
} from './prompts'
import {
  parseExampleSentence,
  parseJsonArrayResponse,
  parseJsonResponse,
} from './jsonParsing'
import { ContentTaskProvider } from './providerContentTasks'

export abstract class WordTaskProvider extends ContentTaskProvider implements AIProvider {
  /**
   * 生成单词提示
   * 图像联想 + 口诀为简单创作任务，使用 deepseek-v4-flash 降低成本
   * 同 word+definition 输入可接受相同结果，启用 7 天缓存
   * @param word 单词
   * @param definition 释义
   * @returns 单词提示（含图像联想与助记）
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateWordHint(word: string, definition: string): Promise<WordHint> {
    return this.withAIError(async () => {
      const { system, user } = wordHintPrompt(word, definition)
      const text = await this.callChatCached(
        'wordHint',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 256,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      const result = parseJsonResponse<WordHint>(text)
      if (!result.imageAssociation || !result.mnemonic) {
        throw new AIError('单词提示结果缺少必要字段')
      }
      return result
    }, '生成单词提示失败')
  }

  /**
   * 生成拼读分解
   * 拼读规则确定性强，使用 deepseek-v4-flash 降低成本
   * 同词同拼读，启用永久缓存（Infinity）
   * @param word 单词
   * @returns 拼读分解结果（含音素与音节数）
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateWordBreakdown(word: string): Promise<WordBreakdown> {
    return this.withAIError(async () => {
      const { system, user } = wordBreakdownPrompt(word)
      const text = await this.callChatCached(
        'wordBreakdown',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 128,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存（同词同拼读）
        }
      )
      const result = parseJsonResponse<WordBreakdown>(text)
      if (!Array.isArray(result.phonics) || typeof result.syllables !== 'number') {
        throw new AIError('拼读分解结果缺少必要字段')
      }
      return result
    }, '生成拼读分解失败')
  }

  /**
   * 生成助记口诀
   * 助记口诀为简单创作任务，使用 deepseek-v4-flash 降低成本
   * 同 word+definition 输入可接受相同结果，启用 7 天缓存
   * @param word 单词
   * @param definition 释义
   * @param root 词根（可选）
   * @returns 助记口诀结果
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateMnemonic(
    word: string,
    definition: string,
    root?: string
  ): Promise<MnemonicResult> {
    return this.withAIError(async () => {
      const { system, user } = mnemonicPrompt(word, definition, root)
      const text = await this.callChatCached(
        'mnemonic',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 256,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      const result = parseJsonResponse<MnemonicResult>(text)
      if (!result.mnemonic) {
        throw new AIError('助记口诀结果缺少必要字段')
      }
      return result
    }, '生成助记口诀失败')
  }

  /**
   * 生成例句
   * 例句生成难度可控，使用 deepseek-v4-flash 降低成本
   * 允许例句多样性，启用 24 小时短期缓存
   * @param word 单词
   * @param definition 释义
   * @returns 例句字符串
   * @throws AIError 当生成失败时抛出
   */
  async generateExampleSentence(word: string, definition: string): Promise<string> {
    return this.withAIError(async () => {
      const { system, user } = exampleSentencePrompt(word, definition)
      const text = await this.callChatCached(
        'exampleSentence',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          maxTokens: 256,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      return parseExampleSentence(text)
    }, '生成例句失败')
  }

  /**
   * 生成 emoji 助记
   * emoji 选择极简，使用 deepseek-v4-flash 降低成本
   * 同词同 emoji，启用永久缓存（Infinity）
   * @param word 单词
   * @param definition 释义
   * @returns emoji 字符串数组
   * @throws AIError 当生成失败或结果非有效数组时抛出
   */
  async generateEmojiHint(word: string, definition: string): Promise<string[]> {
    return this.withAIError(async () => {
      const { system, user } = emojiHintPrompt(word, definition)
      const text = await this.callChatCached(
        'emojiHint',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          // 64 → 256（第三方模型 emoji 助记失败根因）：
          // 推理型第三方模型（如 OpenRouter nemotron）会先输出思考内容再给 JSON，
          // 64 tokens 极易截断（括号不闭合 → JSON 解析失败）；256 覆盖思考前缀 + 包装对象
          maxTokens: 256,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存（同词同 emoji）
          expectArray: true,
        }
      )
      // allowPrimitives：json_object 模式下第三方模型会把 emoji 数组包成
      // {"emojis": ["☀️","🌞"]}（字符串元素），需放宽解包元素约束
      const result = parseJsonArrayResponse<string>(text, { allowPrimitives: true })
      return result
    }, '生成 emoji 助记失败')
  }

  /**
   * 连通性测试（个人中心「测试连接」按钮）
   *
   * 设计（修复测试误报「AI 返回内容无法解析为 JSON」）：
   * - 极简纯文本请求，无 jsonMode、无缓存（callChat 直连，绕过 callChatCached），
   *   避免命中业务缓存造成「假成功」
   * - 连通性语义与 JSON 能力解耦：第三方模型 JSON 输出不合规不应判为连接失败
   * - maxTokens 512：推理型第三方模型会先输出思考内容，过小会截断导致空响应
   * - 成功标准：HTTP 200 且返回非空内容
   */
  async testConnection(): Promise<void> {
    return this.withAIError(async () => {
      const text = await this.callChat(
        [
          {
            role: 'user',
            content: ' connectivity check: reply with the single word OK',
          },
        ],
        {
          maxTokens: 512,
          scenario: 'connection_test',
        }
      )
      if (!text || !text.trim()) {
        throw new AIError('接口连通但返回内容为空，请检查模型是否可用')
      }
    }, '连接测试失败')
  }

  /**
   * 补全单个单词的音标/词性/释义/例句
   * 专为生词本 AI 补全设计，直接返回该单词的完整信息，不依赖文章上下文
   * 单词信息查询确定性强，使用 deepseek-v4-flash 降低成本
   * 词义稳定，启用 30 天长期缓存
   *
   * 优化（修复生词 AI 补全失败问题）：
   * - maxTokens: 512 → 1024：wordEnrichPrompt 返回含 0-3 个 phrases（每项 4 字段）的完整 JSON，
   *   实测 token 需求 350-600，512 处于临界值，phrases 较多时被截断导致 JSON 解析失败。
   *   提升 1.5x 上限至 1024，覆盖最复杂响应场景
   *
   * @param word 单词
   * @returns 单词完整信息
   * @throws AIError 当补全失败时抛出
   */
  async enrichSingleWord(word: string): Promise<VocabularyItem> {
    return this.withAIError(async () => {
      const { system, user } = wordEnrichPrompt(word)
      const text = await this.callChatCached(
        'wordEnrich',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 1024,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      const result = parseJsonResponse<VocabularyItem>(text)
      // 校验返回的 word 字段（大小写不敏感）；不一致时使用输入的 word
      if (!result.word || result.word.toLowerCase() !== word.toLowerCase()) {
        result.word = word
      }
      return result
    }, '补全单词信息失败')
  }
}
