// 阅读特性模块的类型定义
import type { Genre, QuestionType } from '@/shared/types'
import type { VocabularyItem as AIVocabularyItem } from '@/shared/services/ai'

// 复用 AI 层的词汇重要程度类型，避免重复定义
export type { VocabularyImportance } from '@/shared/services/ai'

// 增强版词汇条目：在 AI 层 VocabularyItem 基础上扩展
// - exampleSentence：真题/自适应例句（AI 生成的包含该词的例句）
// - emojiHint：emoji 助记字符数组（1-3 个 emoji 帮助记忆）
export interface VocabularyItem extends AIVocabularyItem {
  exampleSentence?: string
  emojiHint?: string[]
}

// 翻译显示模式：纯英文 / 段落对照 / 按句显示 / 逐句切换
export type TranslationMode = 'english' | 'paragraph' | 'sentence' | 'toggle'

// 练习题生成阶段（多阶段 UI 提示）
// - idle：未生成或上次已结束
// - generating：首次生成中
// - retrying：流式失败重试中（callChatStream retryWithBackoff 触发）
// - fallback：流式失败降级到非流式（generateQuestions/generateArticle 触发）
// - error：所有尝试均失败，展示重试按钮
export type QuizGenStage = 'idle' | 'generating' | 'retrying' | 'fallback' | 'error'

// 选择题选项字母（答题面板与反馈组件共用）
export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const

// 查词结果
export interface WordLookup {
  word: string
  phonetic: string
  pos: string
  definition: string
  // 例句（由 AI enrichment 或字典提供，可选）
  // LOCAL_DICT 中的条目无此字段；wordbook/responseCache/AI enrichment 命中时可能携带
  example?: string
}

// 阅读文章元信息（用于在 UI 顶部展示）
export interface ArticleMeta {
  id: string
  title: string
  genre: Genre
  wordCount: number
}

// 题型中文映射（用于在 UI 中展示题型标签）
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  main_idea: '主旨题',
  detail: '细节题',
  inference: '推断题',
  word_guess: '词义猜测题',
  attitude: '态度题',
  fact_opinion: '事实与观点题',
  structure: '文章结构题',
  paragraph_main: '段落大意题',
  causality: '因果关系题',
  grammar_fill: '语法填空',
}

// 文体中文映射
export const GENRE_LABEL: Record<Genre, string> = {
  narrative: '记叙文',
  expository: '说明文',
  practical: '应用文',
  argumentative: '议论文',
}

// 题材中文映射（用于在 UI 中展示题材标签）
export const TOPIC_LABEL: Record<string, string> = {
  campus: '校园生活',
  science: '科普知识',
  culture: '文化生活',
  biography: '人物传记',
  travel: '旅行见闻',
  sports: '体育竞技',
  technology: '科技前沿',
  nature: '自然风物',
  news: '新闻时事',
  // 新课标三大主题
  self: '人与自我',
  society: '人与社会',
  nature_theme: '人与自然',
  // 生活化题材
  traditional_culture: '中华传统文化',
  ai_life: '人工智能与生活',
  personal_growth: '个人成长与真实体验',
}

// 难度等级中文映射与样式
export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
}

// 难度徽章颜色样式映射
export const DIFFICULTY_STYLE: Record<string, string> = {
  easy: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  hard: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}
