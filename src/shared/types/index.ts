// 公共类型定义出口

// 文体类型：记叙文 / 说明文 / 应用文 / 议论文
export type Genre = 'narrative' | 'expository' | 'practical' | 'argumentative'

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

// 复习步骤：识记 / 阅读 / 练习 / 拼写 / 造句
export type ReviewStep = 'learn' | 'read' | 'practice' | 'spell' | 'write'

// 文章主题：校园 / 科学 / 文化 / 人物传记 / 旅行 / 体育 / 科技 / 自然 / 新闻时事
// 新课标扩展：人与自我（生活与学习）/ 人与社会（历史科技人际）/ 人与自然（环保宇宙）
// 生活化题材扩展：中华传统文化 / 人工智能与生活 / 个人成长与真实体验（附专属防套话创作要求）
export type Topic =
  | 'campus'
  | 'science'
  | 'culture'
  | 'biography'
  | 'travel'
  | 'sports'
  | 'technology'
  | 'nature'
  | 'self'
  | 'society'
  | 'nature_theme'
  | 'news'
  | 'traditional_culture'
  | 'ai_life'
  | 'personal_growth'

// 难度等级：简单 / 中等 / 困难
export type Difficulty = 'easy' | 'medium' | 'hard'

// AI 预标注生词：包含词形、音标、词性、释义、例句
export interface HighlightedWord {
  word: string
  phonetic: string
  pos: string // 词性
  definition: string // 释义
  example: string // 例句
}

// 生词相关短语（AI 补全时生成）
export interface WordPhrase {
  phrase: string // 短语（如 "take care of"）
  meaning: string // 短语释义
  example: string // 包含该短语的英文例句
  exampleTranslation: string // 例句中文翻译
}

// 文章重点短语（AI 生成文章时提取）
export interface ArticlePhrase {
  phrase: string // 短语
  meaning: string // 短语释义
  example?: string // 包含该短语的例句（可选）
  exampleTranslation?: string // 例句中文翻译（可选，兼容历史数据）
}

// 文章重点词汇条目（AI 提取并增强后随文章实体持久化）
// - 基础字段与例句翻译：aiProvider.extractVocabulary 生成
// - exampleSentence / emojiHint / exampleSentenceTranslation：增强阶段生成（失败降级为空）
// - 结构与 reading/types 的 VocabularyItem 兼容（后者额外含可选 phrases 字段）
export interface ArticleVocabulary {
  word: string
  phonetic: string
  pos: string // 词性
  definition: string // 释义
  example: string // 原文例句
  importance: 'high' | 'medium' | 'low' // 重要程度：核心 / 中等 / 了解
  exampleTranslation?: string // 原文例句中文翻译
  exampleSentence?: string // 真题/自适应例句（增强阶段生成）
  exampleSentenceTranslation?: string // 真题/自适应例句中文翻译（增强阶段生成）
  emojiHint?: string[] // emoji 助记（增强阶段生成，1-3 个）
}

// 基础实体接口：所有表实体统一包含主键 id 与 updated_at 时间戳
export interface BaseEntity {
  id: string
  updated_at: number
}

// 每日阅读文章
export interface Article extends BaseEntity {
  // id 格式 YYYY-MM-DD
  title: string
  content: string
  translation: string
  genre: Genre
  wordCount: number
  createdAt: number
  // 文章主题，可选以兼容历史数据
  topic?: Topic
  // 难度等级，可选以兼容历史数据
  difficulty?: Difficulty
  // 蓝思值范围，用于难度分级展示
  lexileRange?: { min: number; max: number }
  // AI 预标注的生词列表，可选以兼容历史数据
  highlightedWords?: HighlightedWord[]
  // 文章内容指纹（基于标题+正文 SHA-256 前 16 位），用于去重判断
  // 可选以兼容历史数据（未计算指纹的旧文章为 undefined）
  contentHash?: string
  // 阅读完成时间戳（毫秒），null/undefined 表示尚未阅读完成
  // 用于已读历史查询与去重后的回退展示
  readAt?: number | null
  // 开始阅读时间戳（毫秒），null/undefined 表示尚未开始阅读
  // 用于追踪用户阅读行为，区分"未开始"与"已开始未完成"状态
  startedAt?: number | null
  // 文章重点短语列表（AI 生成时提取，3-5 个）
  phrases?: ArticlePhrase[]
  // 文章重点词汇列表（AI 提取并增强后随文章持久化，含全部显示内容）
  // 旧文章为 undefined（首次阅读时由 vocabularyService 提取并写回）
  vocabulary?: ArticleVocabulary[]
}

// 阅读理解题
export interface Question extends BaseEntity {
  // id 格式 `${articleId}-${n}`
  articleId: string
  type: QuestionType
  stem: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
  locationClue: string
  createdAt: number
}

// 生词本
export interface Word extends BaseEntity {
  // id 使用 word 本身
  word: string
  phonetic: string
  pos: string
  definition: string
  example: string
  root?: string
  note?: string
  mastery: number
  nextReview: number
  lastReview: number
  reviewCount: number
  interval: number
  easeFactor: number
  sourceArticleId?: string
  createdAt: number
  // 顽固词错误计数（炼/拼/写环节错误累计），默认 0
  stubbornCount?: number
  // 成就标签（如 'stubborn' 'mastered'），默认 []
  achievementTags?: string[]
  // 记忆稳固度 0-100，用于进度条展示
  stabilityScore?: number
  // 收藏标记：0 = 普通生词，1 = 重点收藏（默认 0）
  // 用于在生词本中标记重点单词，支持「仅看收藏」筛选
  favorite?: 0 | 1
  // 例句中文翻译（AI 补全时生成）
  exampleTranslation?: string
  // 相关短语数组（AI 补全时生成，0-3 个）
  phrases?: WordPhrase[]
}

// 复习记录
export interface Review extends BaseEntity {
  wordId: string
  step: ReviewStep
  correct: boolean
  correctRate: number
  timeSpent: number
  reviewedAt: number
}

// 学习统计（按日聚合）
export interface Stats extends BaseEntity {
  // id 格式 YYYY-MM-DD
  articlesRead: number
  wordsLearned: number
  wordsReviewed: number
  wordsMastered: number
  streak: number
}

// 阅读会话记录：每次阅读文章后的完成情况（用时 / 字数 / 正确率）
export interface ReadingSession extends BaseEntity {
  // id 格式 `${articleId}-${timestamp}` 或 UUID
  articleId: string // 外键，关联 articles 表
  durationSec: number // 阅读用时（秒）
  wordCount: number // 文章字数
  correctRate: number // 答题正确率 0-1
  reviewedAt: number // 阅读时间戳（毫秒）
}

// 成就：解锁条件、图标、解锁时间
export interface Achievement extends BaseEntity {
  // id 主键，成就规则 ID（如 'reading-star' 'all-correct-king'）
  name: string // 成就名称（如 "阅读之星"）
  description: string // 成就描述
  icon: string // emoji 或图标名（如 "⭐" "🏆"）
  unlockedAt: number // 解锁时间戳（毫秒），0 表示未解锁
}
