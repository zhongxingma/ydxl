// AI 接口抽象层类型定义
// 定义 AIProvider 统一接口与各类生成结果类型，供 OpenAI / 通义千问等多家供应商实现
import type { ArticlePhrase, Difficulty, HighlightedWord, Topic, WordPhrase } from '@/shared/types'

// 文体类型：记叙文 / 说明文 / 应用文 / 议论文
export type Genre = 'narrative' | 'expository' | 'practical' | 'argumentative'

// AI 供应商名称（统一类型，供 ai/index.ts 工厂、ProfilePage、server/src/ai-proxy.ts 共用）
// - 'deepseek'：DeepSeek 官方 API（api.deepseek.com，OpenAI 兼容协议）
// - 'openai'：OpenAI 官方 API（api.openai.com/v1，原生 Chat Completions 协议）
// - 'qwen'：阿里云百炼通义千问（dashscope compatible-mode，OpenAI 兼容协议）
// - 'custom'：自定义模型（用户配置任意 OpenAI Chat Compatibles 兼容端点，
// API 格式 + 请求地址 + 模型 ID + 鉴权信息）
export type AIProviderName = 'deepseek' | 'openai' | 'qwen' | 'custom'

// AI 供应商展示与配置元数据
// 单一事实来源：工厂默认值、连接测试与文档标签均由此派生
// 注意：ProfilePage 供应商下拉框为静态 <option> 列表（未读取此注册表），新增供应商时需手动同步
export interface AIProviderMeta {
  // 显示名称（UI 用）
  label: string
  // 默认直连端点（OpenAI 兼容 chat/completions）
  endpoint: string
  // 默认高质量模型（复杂任务：文章生成、题目生成）
  defaultModel: string
  // 轻量模型（简单任务降级：翻译、emoji、例句等）；不支持分级时为 null
  flashModel: string | null
  // 获取 API Key 的控制台地址
  keyConsoleUrl: string
  // 是否支持 response_format: json_object（JSON Output 模式）
  supportsJsonMode: boolean
}

// 供应商元数据注册表（key 与 AIProviderName 一一对应）
// 注意：custom 为用户运行时配置型供应商，端点/模型由用户输入，不设静态默认值
export const AI_PROVIDER_META: Record<AIProviderName, AIProviderMeta> = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-v4-pro',
    flashModel: 'deepseek-v4-flash',
    keyConsoleUrl: 'https://platform.deepseek.com/api_keys',
    supportsJsonMode: true,
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5.2',
    flashModel: 'gpt-5.2-mini',
    keyConsoleUrl: 'https://platform.openai.com/api-keys',
    supportsJsonMode: true,
  },
  qwen: {
    label: '通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen3-max',
    flashModel: 'qwen3-turbo',
    keyConsoleUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    supportsJsonMode: true,
  },
  custom: {
    label: '自定义模型',
    // 空端点：由用户在个人中心配置（CustomProvider 构造时校验非空）
    endpoint: '',
    defaultModel: '',
    // 自定义模型无内置分级，统一使用用户填写的模型 ID
    flashModel: null,
    keyConsoleUrl: '',
    // OpenAI 兼容端点大多支持 JSON Output，但无法逐一确认；
    // 默认按支持处理，上游不支持时会返回错误并在连接测试中暴露
    supportsJsonMode: true,
  },
}

// 题型：主旨题 / 细节题 / 推断题 / 词义猜测题 / 态度题 / 事实观点题 / 文章结构题 / 段落大意题 / 因果关系题 / 语法填空题
export type QuestionType =
  | 'main_idea'
  | 'detail'
  | 'inference'
  | 'word_guess'
  | 'attitude'
  | 'fact_opinion'
  | 'structure'
  | 'paragraph_main'
  | 'causality'
  | 'grammar_fill'

// 词汇重要程度：高 / 中 / 低（结合中考考纲与出现频率评估）
export type VocabularyImportance = 'high' | 'medium' | 'low'

// 文章生成结果
export interface ArticleGenerationResult {
  title: string
  content: string // 200-300 词英文原文
  translation: string // 全文中文翻译
  genre: Genre
  wordCount: number
  // 题材（校园 / 科普 / 文化 / 人物等）
  topic: Topic
  // 难度等级（easy / medium / hard）
  difficulty: Difficulty
  // 蓝思值范围（如 600-900）
  lexileRange: { min: number; max: number }
  // AI 预标注的生词列表
  highlightedWords: HighlightedWord[]
  // AI 提取的重点短语（3-5 个）
  phrases?: ArticlePhrase[]
}

// 趣味助记口诀结果
export interface MnemonicResult {
  mnemonic: string // 趣味助记口诀
  explanation?: string // 口诀解释（可选）
}

// 阅读理解题生成结果
export interface QuestionGenerationResult {
  id: string
  type: QuestionType
  stem: string
  options: [string, string, string, string]
  correctIndex: number // 0-3
  explanation: string
  locationClue: string
}

// 单词提示（图像联想 + 记忆口诀）
export interface WordHint {
  imageAssociation: string // AI 生成的图像联想描述
  mnemonic: string // 记忆口诀
}

// 单词拼读分解
export interface WordBreakdown {
  phonics: string[] // 自然拼读分解，如 ["ap", "ple"]
  syllables: number // 音节数
}

// 词汇条目
export interface VocabularyItem {
  word: string
  phonetic: string
  pos: string
  definition: string
  example: string
  importance: VocabularyImportance
  // 例句中文翻译（AI 提取词汇时生成）
  exampleTranslation?: string
  // 真题/自适应例句（增强阶段生成）
  exampleSentence?: string
  // 真题/自适应例句中文翻译（增强阶段生成，通过 generateTranslation 翻译已生成的例句）
  exampleSentenceTranslation?: string
  // emoji 助记（增强阶段生成，1-3 个）
  emojiHint?: string[]
  // 与该单词相关的常见短语（enrichSingleWord 补全时生成，0-3 个）
  // extractVocabulary 不返回此字段，保留为可选
  phrases?: WordPhrase[]
}

// 流式调用选项（新增）
// - signal：外部 AbortSignal，组件卸载或用户取消时中断请求
// - onChunk：流式回调，每收到一个 delta 触发，可用于 UI 进度显示
export interface StreamOptions {
  signal?: AbortSignal
  onChunk?: (delta: string, fullText: string) => void
}

// AI 供应商统一接口
export interface AIProvider {
  // topic / difficulty / avoidTopics 为可选参数，保持向后兼容
  // streamOptions: 传入时启用流式输出 + 中断机制；不传保持原有非流式行为
  generateArticle(
    date: string,
    genre?: Genre,
    topic?: Topic,
    difficulty?: Difficulty,
    avoidTopics?: string[],
    streamOptions?: StreamOptions
  ): Promise<ArticleGenerationResult>
  generateQuestions(
    articleId: string,
    articleContent: string,
    genre?: Genre,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]>
  /** 生成语法填空题（从文章中挖空典型语法点，深度解析） */
  generateGrammarFillQuestions(
    articleId: string,
    articleContent: string,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]>
  generateTranslation(content: string): Promise<string>
  extractVocabulary(content: string): Promise<VocabularyItem[]>
  /** 从文章中提取重点短语（为历史文章补全 phrases，含 phrase/meaning/example/exampleTranslation） */
  extractArticlePhrases(content: string): Promise<ArticlePhrase[]>
  generateWordHint(word: string, definition: string): Promise<WordHint>
  generateWordBreakdown(word: string): Promise<WordBreakdown>
  /** 生成趣味助记口诀（如 "family → father and mother I love you"） */
  generateMnemonic(word: string, definition: string, root?: string): Promise<MnemonicResult>
  /** 生成包含该词的真题例句或自适应例句 */
  generateExampleSentence(word: string, definition: string): Promise<string>
  /** 生成 1-3 个 emoji 助记字符（无图片成本） */
  generateEmojiHint(word: string, definition: string): Promise<string[]>
  /** 补全单个单词的音标/词性/释义/例句（用于生词本 AI 补全） */
  enrichSingleWord(word: string): Promise<VocabularyItem>
  /**
   * 连通性测试（用于个人中心「测试连接」按钮）
   * 发送极简纯文本请求（无 JSON 模式、无缓存），成功返回即视为连通
   * 与业务方法解耦：JSON 输出不合规不应误判为「连接失败」
   */
  testConnection(): Promise<void>
}

// 聊天消息（OpenAI / 通义千问通用结构）
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 自定义 AI 错误类型
// 使用 class extends Error 的标准 ES 写法，保留原始 cause 便于排查
export class AIError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'AIError'
  }
}
