// AI Prompt 模板聚合出口
//
// 按任务领域拆分，调用方仍从 './prompts' 导入，无需感知文件结构：
//   - promptShared.ts：共享输出规则、文体/题材/难度映射、创作风格预设
//   - articlePrompts.ts：文章 / 短语 / 题目 / 语法填空 / 翻译 / 词汇
//   - wordPrompts.ts：单词提示 / 拼读 / 助记 / 例句 / emoji / 单词补全
export {
  articlePhrasesPrompt,
  articlePrompt,
  grammarFillPrompt,
  questionsPrompt,
  translationPrompt,
  vocabularyPrompt,
} from './articlePrompts'
export {
  emojiHintPrompt,
  exampleSentencePrompt,
  mnemonicPrompt,
  wordBreakdownPrompt,
  wordEnrichPrompt,
  wordHintPrompt,
} from './wordPrompts'
