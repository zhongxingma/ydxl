// 单词类 Prompt 模板：单词提示 / 拼读分解 / 助记口诀 / 例句 / emoji / 单词补全
//
// word / definition / root 等动态内容统一放在 user message 末尾，
// 保持 system 前缀稳定以最大化 DeepSeek Context Cache 命中。
import { JSON_OUTPUT_RULE } from './promptShared'

// 单词提示 prompt
// 要求：生成 1-2 句中文图像联想描述 + 朗朗上口的中文记忆口诀、返回 {imageAssociation, mnemonic}
// word / definition 作为动态内容放在 user message 末尾
export function wordHintPrompt(word: string, definition: string): { system: string; user: string } {
  return {
    system:
      '你是一位擅长记忆法教学的英语老师，擅长用图像联想与口诀帮助初中生记忆单词。' +
      JSON_OUTPUT_RULE,
    user:
      '请为单词生成记忆辅助内容，要求如下：\n' +
      '1. imageAssociation 字段：1-2 句中文图像联想描述，将单词的发音或拼写与释义建立生动画面感；\n' +
      '2. mnemonic 字段：朗朗上口的中文记忆口诀，便于背诵，不超过 20 字；\n' +
      '3. 内容适合初中生，避免低俗或敏感内容。\n\n' +
      '仅返回 JSON：{"imageAssociation":"","mnemonic":""}\n\n' +
      `word：${word}\n` +
      `definition：${definition}`,
  }
}

// 拼读分解 prompt
// 要求：返回自然拼读拆分数组与音节数
// word 作为动态内容放在 user message 末尾
export function wordBreakdownPrompt(word: string): { system: string; user: string } {
  return {
    system:
      '你是一位英语自然拼读（phonics）教学专家，擅长将单词拆分为易于拼读的音节。' +
      JSON_OUTPUT_RULE,
    user:
      '请将单词按自然拼读规则拆分，要求如下：\n' +
      '1. phonics 字段：将单词拆分为若干拼读单元的字符串数组（如 "apple" 拆为 ["ap","ple"]）；\n' +
      '2. 拆分应反映实际发音规律，便于学生拼读；\n' +
      '3. syllables 字段：该单词的音节数（正整数）。\n\n' +
      '仅返回 JSON：{"phonics":["",""],"syllables":0}\n\n' +
      `word：${word}`,
  }
}

// 趣味助记口诀 prompt
// 要求：生成趣味助记口诀（如 family → father and mother I love you），返回 {mnemonic, explanation}
// root 为可选词根信息，提供时帮助 AI 建立联想
// word / definition / root 作为动态内容放在 user message 末尾
export function mnemonicPrompt(
  word: string,
  definition: string,
  root?: string
): { system: string; user: string } {
  const rootRequirement = root
    ? '\n5. 可参考词根建立联想（如该词根的含义与单词的联系）；'
    : ''
  const rootInput = root ? `\nroot：${root}` : ''
  return {
    system:
      '你是一位擅长趣味记忆法的英语老师，擅长用谐音、拆字、联想等方式为初中生创作朗朗上口的助记口诀。' +
      '口诀需简短、有趣、便于记忆，且与单词的拼写或释义有明确关联。' +
      JSON_OUTPUT_RULE,
    user:
      '请为单词生成趣味助记口诀，要求如下：\n' +
      '1. mnemonic 字段：趣味助记口诀，可使用拆字、谐音、联想等方式（如 "family" → "father and mother I love you"）；\n' +
      '2. 口诀需简短，便于初中生背诵，不超过 40 字；\n' +
      '3. 口诀需与单词拼写或释义有明确关联，避免无关联的联想；\n' +
      '4. explanation 字段（可选）：简要说明口诀与单词的关联方式；' +
      `${rootRequirement}\n\n` +
      '仅返回 JSON：{"mnemonic":"","explanation":""}\n\n' +
      `word：${word}\n` +
      `definition：${definition}` +
      rootInput,
  }
}

// 真题例句 prompt
// 要求：生成 1-2 个包含该词的真题风格例句（初中水平），返回纯字符串
// 例句需符合中考真题语境，难度适中，句式地道
// word / definition 作为动态内容放在 user message 末尾
export function exampleSentencePrompt(
  word: string,
  definition: string
): { system: string; user: string } {
  return {
    system:
      '你是一位初中英语命题专家，熟悉中考真题的句式风格与难度水平。' +
      '你能生成地道、自然的英语例句，句式贴近中考真题风格，难度控制在 CEFR A2-B1。',
    user:
      '请为单词生成 1-2 个包含该词的例句，要求如下：\n' +
      '1. 例句需符合中考真题风格，句式地道、自然；\n' +
      '2. 难度控制在初中水平（CEFR A2-B1），避免使用超纲词汇与复杂句式；\n' +
      '3. 例句内容积极向上，贴近中学生生活与学习场景；\n' +
      '4. 可返回纯文本字符串，或返回 JSON 字符串（如 {"sentence":"例句内容"}），程序会做容错处理；\n' +
      '5. 若返回多个例句，用换行符分隔；\n' +
      '6. 不要包含任何解释性文字、编号或 markdown 代码块标记。\n\n' +
      `word：${word}\n` +
      `definition：${definition}`,
  }
}

// emoji 助记 prompt
// 要求：生成 1-3 个 emoji 字符（基于词义联想，如 "sun" → "☀️🌞"），返回字符串数组
// 不产生图片成本，仅用 emoji 字符建立视觉联想
// word / definition 作为动态内容放在 user message 末尾
export function emojiHintPrompt(
  word: string,
  definition: string
): { system: string; user: string } {
  return {
    system:
      '你是一位擅长视觉联想教学的英语老师，擅长用 emoji 字符帮助学生建立单词的视觉记忆。' +
      '你能根据单词的拼写、释义、发音或联想场景，挑选最贴切的 emoji 字符。' +
      '你只能输出严格的 JSON 数组。',
    user:
      '请为单词生成 1-3 个 emoji 助记字符，要求如下：\n' +
      '1. emoji 需与单词的拼写、释义、发音或联想场景有明确关联（如 "sun" → "☀️🌞"，"happy" → "😊😄"）；\n' +
      '2. 优先选择常用、辨识度高的 emoji 字符；\n' +
      '3. 数量控制在 1-3 个，避免过多干扰；\n' +
      '4. 仅返回 emoji 字符本身，不要包含文字描述。\n\n' +
      '仅返回 JSON：["",""]\n\n' +
      `word：${word}\n` +
      `definition：${definition}`,
  }
}

// 单词补全 prompt
// 专为补全单个单词的音标/词性/释义/例句设计，要求 AI 直接返回该单词的完整信息（JSON 对象，非数组）
// 用于 enrichWord 场景：用户添加新单词到生词本时，AI 补全缺失的音标/词义/例句
// word 作为动态内容放在 user message 末尾
export function wordEnrichPrompt(word: string): { system: string; user: string } {
  return {
    system:
      '你是一位初中英语词汇教学专家，熟悉中考考纲词汇与国际音标。' +
      '你能为任意英语单词提供准确的音标、词性、中文释义、适合初中水平的例句及例句翻译。' +
      '你还能提供与该单词相关的常见短语（含短语释义、例句与例句翻译）。' +
      JSON_OUTPUT_RULE,
    user:
      '请为单词提供以下信息，要求如下：\n' +
      '1. phonetic 字段为国际音标（如 /əˈpleɪ/），pos 字段为词性缩写（如 n. / v. / adj. / adv.），definition 字段为中文释义（简洁准确，适合初中生理解）；\n' +
      '2. example 字段为包含该单词的英文例句（句式地道、难度控制在初中水平 CEFR A2-B1，必须包含该单词本身），exampleTranslation 字段为该例句的中文翻译；\n' +
      '3. phrases 字段为与该单词相关的常见短语数组（0-3 个），每个短语包含 phrase、meaning、example（含该短语的英文例句）、exampleTranslation（例句中文翻译）；若无相关短语则返回空数组 []。\n\n' +
      '仅返回 JSON：{"word":"","phonetic":"","pos":"","definition":"","example":"","exampleTranslation":"","phrases":[{"phrase":"","meaning":"","example":"","exampleTranslation":""}]}\n\n' +
      `word：${word}`,
  }
}
