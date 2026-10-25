// 文章类 Prompt 模板：文章生成 / 短语提取 / 阅读理解题目 / 语法填空 / 翻译 / 词汇提取
//
// 结构遵循「稳定前缀 + 动态变量后置」原则，
// 以最大化 DeepSeek Context Cache（上下文硬盘缓存）命中率，降低 Token 成本。
import type { Difficulty, Topic } from '@/shared/types'
import type { Genre } from './types'
import {
  DIFFICULTY_CONFIG,
  GENRE_LABEL,
  JSON_OUTPUT_RULE,
  pickVariation,
  TOPIC_BRIEF,
  TOPIC_LABEL,
} from './promptShared'

// 生成文章 prompt
// 要求：200-300 词、初中英语水平、指定文体与题材、控制蓝思值、预标注生词、返回严格 JSON
// topic / difficulty / avoidTopics 为可选参数，保持向后兼容
// avoidTopics: 最近生成过的主题列表，注入 user message 末尾提示 AI 避免重复
// 注：avoidTopics 必须放在 user message 末尾（动态部分），不能放 system message
// 否则会破坏 system message 的稳定性，降低 DeepSeek Context Cache 命中率
export function articlePrompt(
  date: string,
  genre?: Genre,
  topic?: Topic,
  difficulty?: Difficulty,
  avoidTopics?: string[]
): { system: string; user: string } {
  const genreText = genre ? GENRE_LABEL[genre] : '记叙文 / 说明文 / 应用文 / 议论文中随机选择一种'
  // 未指定题材时，要求从校园 / 科普 / 文化 / 人物故事中随机选一
  const topicText = topic
    ? TOPIC_LABEL[topic]
    : '围绕新课标三大主题之一：人与自我（self，生活与学习）/ 人与社会（society，历史、科技、人际交往）/ 人与自然（nature_theme，环境保护、宇宙探索）中随机选择一种'
  // biography 题材特殊提示：优先选择各行业名人、伟人作为传主
  const biographyHint = topic === 'biography'
    ? '（传主优先选择各行业名人、伟人、杰出人物，如科学家、文学家、艺术家、运动员、企业家等，体现其成长经历或杰出贡献）'
    : ''
  // 生活化题材专属创作简报（防套话，见 TOPIC_BRIEF 注释）
  const topicBrief = topic ? TOPIC_BRIEF[topic] : undefined
  // 未指定难度时默认中等（700-800L）
  const diffConfig = difficulty ? DIFFICULTY_CONFIG[difficulty] : DIFFICULTY_CONFIG.medium
  // 构造避免重复主题的提示文案，放在 user message 末尾（动态部分）
  const avoidTopicsSuffix =
    avoidTopics && avoidTopics.length > 0
      ? '\n\n请避免以下最近生成过的主题，选择不同的主题或角度进行创作：\n' +
        avoidTopics.map((t) => `- ${t}`).join('\n')
      : ''
  // 随机创作风格注入（打破模板化，见 VARIATION_PRESETS 注释）
  // 有题材专属简报时跳过：简报已锁定叙事形式（邮件/日记/具体经历），
  // 再叠加随机视角会产生互相矛盾的指令（如「日记开头直接进场景」vs「以人物对话开场」）
  const variation = pickVariation()
  const variationSuffix = topicBrief
    ? ''
    : '\n\n请为本文随机选定一种叙事方式，避免套用固定模板、增强多样性与可读性（务必遵循）：\n' +
      `- 叙事视角：${variation.perspective}；\n` +
      `- 开头方式：${variation.opening}；\n` +
      `- 结尾方式：${variation.ending}。`
  return {
    // system message 完全稳定（不依赖任何参数），最大化 Context Cache 命中
    system:
      '你是一位资深初中英语教研专家，擅长根据中考考纲生成难度适中的英语阅读素材。' +
      '你熟悉蓝思（Lexile）分级体系，能够精确控制文本难度。' +
      '你能自动识别中考高频词与潜在生词，并给出音标、词性、释义与原文例句。' +
      JSON_OUTPUT_RULE,
    user:
      '请生成一篇英语阅读文章，要求如下：\n' +
      `1. 文体：${genreText}；\n` +
      `2. 题材：${topicText}${biographyHint}（topic 字段须使用 campus / science / culture / biography / travel / sports / technology / nature / news / self / society / nature_theme / traditional_culture / ai_life / personal_growth 之一）；\n` +
      `3. 难度等级：${diffConfig.label}（difficulty 字段须使用 easy / medium / hard 之一，与所给难度一致）；\n` +
      `4. 蓝思值范围：${diffConfig.lexileMin}-${diffConfig.lexileMax}L（lexileRange 字段的 min / max 落在此区间内）；\n` +
      '5. 字数：英文正文严格控制在 200-300 词之间，wordCount 字段为实际词数；\n' +
      '6. 词汇限定在中考考纲范围内，避免生僻词；\n' +
      '7. 主题积极向上、适合中学生阅读，避免敏感内容；\n' +
      '8. translation 字段提供与英文正文逐段对应的完整中文翻译；\n' +
      '9. genre 字段必须使用 narrative / expository / practical / argumentative 之一，并与所生成文体一致；\n' +
      '10. highlightedWords 字段：自动识别文中对初中生有学习价值的中考高频词与潜在生词（5-10 个），' +
      '每项包含 word、phonetic（国际音标，如 /əˈpleɪ/）、pos（词性缩写，如 n. / v. / adj.）、' +
      'definition（在文中的中文释义）、example（文中包含该词的英文原句）；\n' +
      '11. phrases 字段：从文章中提取 5-8 个重点短语（如动词短语、固定搭配、惯用表达），每项必须包含 phrase、meaning、example（含该短语的原文例句）、exampleTranslation（例句中文翻译）四字段；\n' +
      '12. 文体内容规范（按所选文体遵循对应要求）：\n' +
      '   - 记叙文（narrative）：包含清晰的开端（setting）、发展（rising action）、高潮（climax）、结局（resolution）四段结构；体现人物的情感变化；使用第一或第三人称叙事；\n' +
      '   - 说明文（expository）：结构清晰（总分/总分总/递进等）；使用举例、列数据、分类等说明方法；客观陈述事实；\n' +
      '   - 应用文（practical）：包含关键细节信息（时间/地点/价格/规则/联系方式等）；结构如通知/广告/便条/书信/邮件；信息准确完整；\n' +
      '   - 议论文（argumentative）：包含明确论点（thesis）；正反方论据（pros and cons）；作者自己的结论（conclusion）；论据需有逻辑性；\n' +
      '13. 融入中国元素：每 3-4 篇可融入 1 次中国元素（如二十四节气、汉服、高铁、航天等传统文化或现代成就，或中外文化对比），自然融入不生硬；\n' +
      '14. 非连续性文本：若题材适合，可在 content 中包含纯文本结构化数据段（用编号或分点格式表示表格/数据，如"① 项目A：xx ② 项目B：yy"），translation 对应翻译；不要使用 markdown 表格语法；\n\n' +
      (topicBrief ? `${topicBrief}\n\n` : '') +
      `日期：${date}\n` +
      '仅返回 JSON：{"title":"","content":"","translation":"","genre":"","wordCount":0,"topic":"","difficulty":"","lexileRange":{"min":0,"max":0},"highlightedWords":[{"word":"","phonetic":"","pos":"","definition":"","example":""}],"phrases":[{"phrase":"","meaning":"","example":"","exampleTranslation":""}]}' +
      variationSuffix +
      avoidTopicsSuffix,
  }
}

// 文章短语提取 prompt（为历史文章补全 phrases）
//
// 用于功能上线前生成的历史文章（article.phrases 为 undefined），
// 从已有文章内容中提取 5-8 个重点短语，每个含 phrase/meaning/example/exampleTranslation。
//
// 设计要点：
// - 复用 articlePrompt 的短语格式要求，保持新文章与历史文章短语一致性
// - 单行紧凑 JSON schema（Phase 3 约定：减少 token 消耗）
// - content 截断到 3000 字符（与 questionsPrompt 一致，覆盖 200-300 词文章）
// - system message 稳定（不依赖参数），最大化 Context Cache 命中
//
// @param content 文章英文正文
// @returns {system, user} 消息对
export function articlePhrasesPrompt(content: string): { system: string; user: string } {
  const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n[article truncated]' : content
  return {
    system:
      '你是一位资深初中英语教研专家，擅长从英语阅读材料中提取重点短语与固定搭配。' +
      '你能为每个短语提供准确释义、原文例句与例句翻译。' +
      JSON_OUTPUT_RULE,
    user:
      '请从以下文章中提取 5-8 个重点短语（如动词短语、固定搭配、惯用表达），要求如下：\n' +
      '1. 每项必须包含 phrase（短语）、meaning（中文释义）、example（含该短语的原文例句）、exampleTranslation（例句中文翻译）四字段；\n' +
      '2. 短语须为文章中实际出现的表达，释义须准确且符合语境；\n' +
      '3. 例句优先使用文章原文中的句子；若原文无完整句子则可稍作改写；\n' +
      '4. 优先选择中考高频短语与有学习价值的搭配。\n\n' +
      `文章内容：\n${truncated}\n\n` +
      '仅返回 JSON：[{"phrase":"","meaning":"","example":"","exampleTranslation":""}]',
  }
}

// 生成题目 prompt
// 要求：5 道、覆盖主旨/细节/推断/词义猜测至少 3 类、每题 4 选项 1 正确答案、附 explanation 与 locationClue、返回 JSON 数组
// articleContent 作为动态内容放在 user message 末尾
// Phase 3 优化（2026-07-27）：
// - articleContent 截断到 3000 字符：覆盖 200-300 词文章（约 1500-2000 字符），仅超长文章触发截断
//   避免极端长文章消耗过多 token（每 1000 字符约 250 token）
// - 精简 JSON schema 示例：移除「仅返回如下 JSON：\n」换行，改为单行紧凑格式
export function questionsPrompt(
  articleId: string,
  articleContent: string,
  genre?: Genre
): { system: string; user: string } {
  // 按文体映射题型要求（议论文出态度/事实观点/结构题，说明文出段落大意/因果题等）
  // 未传 genre 时（历史文章兼容）保持原有通用题型要求
  const GENRE_QUESTION_MAP: Record<Genre, string> = {
    practical: '题型以 detail（细节题）为主，辅以 word_guess（词义猜测题），至少 3 道题',
    narrative: '题型覆盖 detail（细节题）/ inference（推断题）/ main_idea（主旨题）中至少 3 类',
    expository: '题型覆盖 detail（细节题）/ paragraph_main（段落大意题）/ causality（因果关系题）中至少 3 类',
    argumentative: '题型覆盖 attitude（推断作者态度题）/ fact_opinion（区分事实与观点题）/ structure（文章结构题）中至少 3 类',
  }
  const questionRequirement = genre
    ? GENRE_QUESTION_MAP[genre]
    : '题型覆盖 main_idea（主旨题）/ detail（细节题）/ inference（推断题）/ word_guess（词义猜测题）中至少 3 类'
  // 截断过长文章内容，避免 prompt 超限（3000 字符覆盖 200-300 词文章）
  const truncatedContent = articleContent.length > 3000
    ? articleContent.slice(0, 3000) + '\n[article truncated]'
    : articleContent
  return {
    system:
      '你是一位初中英语命题专家，擅长基于阅读材料命制高质量选择题。' +
      '所有答案必须在原文中找到明确依据，干扰项需具备一定迷惑性但不产生歧义。' +
      '你只能输出严格的 JSON 数组。',
    user:
      '请生成 5 道单项选择题，要求如下：\n' +
      `1. ${questionRequirement}；\n` +
      '2. 每题 4 个选项，仅 1 个正确答案，其余 3 个为干扰项；\n' +
      '3. correctIndex 为正确选项在 options 数组中的下标（0-3）；\n' +
      '4. explanation 字段说明正确答案的依据，并简要说明干扰项为何错误；\n' +
      '5. locationClue 字段给出在原文中定位答案的线索（引用原文片段或段落位置）；\n' +
      '6. id 字段格式为 `${articleId}-${n}`，n 从 1 开始递增；\n' +
      '7. stem（题干）与 options（选项）必须使用英文，以保持英语阅读训练价值；explanation（解析）使用中文，详细说明正确答案的依据并简要说明干扰项为何错误；locationClue 引用英文原文片段并附简短中文位置说明（如「第三段：...」）；\n\n' +
      `articleId：${articleId}\n` +
      `文章内容：\n${truncatedContent}\n` +
      '仅返回 JSON：[{"id":"","type":"","stem":"","options":["","","",""],"correctIndex":0,"explanation":"","locationClue":""}]',
  }
}

// 语法填空题 prompt
// 从文章中选取含典型语法点的句子挖空，生成 5 道选择填空题
// 考点覆盖：时态/语态/主谓一致/从句/非谓语动词等中考高频语法点
// explanation 须深度透彻：语法知识点 + 正确项依据 + 逐一排除干扰项 + 拓展知识
// id 格式 `${articleId}-g${n}`，g 前缀确保排序在阅读理解题（`${articleId}-${n}`）之后
export function grammarFillPrompt(
  articleId: string,
  articleContent: string
): { system: string; user: string } {
  // 截断过长文章内容，避免 prompt 超限（3000 字符覆盖 200-300 词文章）
  const truncatedContent = articleContent.length > 3000
    ? articleContent.slice(0, 3000) + '\n[article truncated]'
    : articleContent
  return {
    system:
      '你是一位资深初中英语语法教学专家，擅长从阅读材料中选取典型句子命制语法填空题。' +
      '你能精准识别中考高频语法考点（时态、语态、主谓一致、从句、非谓语动词等），' +
      '并为每道题提供深度透彻的语法解析，帮助学生理解语法规则与运用场景。' +
      '你只能输出严格的 JSON 数组。',
    user:
      '请基于以下文章，生成 5 道语法填空选择题，要求如下：\n' +
      '1. 从文章中选取包含典型语法点的句子，将关键语法词挖空作为题干（用 ___ 表示空缺处），保留原文句式与语境；\n' +
      '2. 每题提供 4 个选项（词形/时态/介词/连词等），仅 1 个正确答案，其余 3 个为常见错误形式干扰项；\n' +
      '3. type 字段固定为 "grammar_fill"；\n' +
      '4. id 字段格式为 `${articleId}-g${n}`，n 从 1 开始递增（如 ' + articleId + '-g1）；\n' +
      '5. stem 字段为含 ___ 空缺处的英文句子；\n' +
      '6. options 字段为 4 个英文选项；\n' +
      '7. correctIndex 为正确选项在 options 数组中的下标（0-3）；\n' +
      '8. explanation 字段使用中文，须深度透彻解析，包含以下层次：\n' +
      '   - 语法知识点：明确指出本题考查的语法点（如"本题考查一般现在时第三人称单数"）；\n' +
      '   - 正确项依据：解释正确答案为何符合语法规则（引用具体规则）；\n' +
      '   - 干扰项排除：逐一说明每个错误选项为何错误（涉及的具体语法错误类型）；\n' +
      '   - 拓展知识：补充相关语法规则或易混点辨析（如相近语法点的区别）；\n' +
      '9. locationClue 字段引用文章中该句的原文完整句子（英文），便于学生回看定位；\n' +
      '10. 考点覆盖面：尽量覆盖不同语法点（时态/语态/从句/非谓语/主谓一致等），避免多题考查同一考点；\n' +
      '11. 难度适中：选项为初中阶段常见语法用法，避免超纲语法点。\n\n' +
      `articleId：${articleId}\n` +
      `文章内容：\n${truncatedContent}\n` +
      '仅返回 JSON：[{"id":"","type":"grammar_fill","stem":"","options":["","","",""],"correctIndex":0,"explanation":"","locationClue":""}]',
  }
}

// 翻译 prompt
// 要求：将英文内容翻译为通顺自然的中文，仅返回译文文本
// content 作为动态内容放在 user message 末尾
export function translationPrompt(content: string): { system: string; user: string } {
  // 截断过长内容，避免 prompt 超限
  const truncated = content.length > 5000
    ? content.slice(0, 5000) + '\n[content truncated]'
    : content
  return {
    system:
      '你是一位专业英汉翻译专家，擅长将英语阅读材料翻译为通顺、符合中文表达习惯的译文。' +
      '只返回译文本身，不要添加任何解释或标记。',
    user:
      '请将以下英文内容翻译为中文，要求：\n' +
      '1. 逐段对应原文，保持原意准确；\n' +
      '2. 语言通顺自然，符合中文表达习惯；\n' +
      '3. 不增译、不漏译；\n' +
      '4. 仅返回译文文本，不要包含原文或任何说明。\n\n' +
      `英文内容：\n${truncated}`,
  }
}

// 词汇提取 prompt
// 要求：识别中考高频词、附 phonetic/pos/definition/example/importance、返回 JSON 数组
// content 作为动态内容放在 user message 末尾
export function vocabularyPrompt(content: string): { system: string; user: string } {
  return {
    system:
      '你是一位初中英语词汇教学专家，熟悉中考高频词汇与考纲范围。' +
      '你只能输出严格的 JSON 数组。',
    user:
      '请从以下英文文章中提取中考高频词汇，要求如下：\n' +
      '1. 仅提取对初中生有学习价值的词汇（一般为中考考纲词汇或高频词），数量 8-15 个；\n' +
      '2. phonetic 字段为国际音标（如 /əˈpleɪ/）；\n' +
      '3. pos 字段为词性缩写（如 n. / v. / adj. / adv.）；\n' +
      '4. definition 字段为该词在文中的中文释义；\n' +
      '5. example 字段为原文中包含该词的句子（保留英文原句）；\n' +
      '6. exampleTranslation 字段：example 例句的中文翻译；\n' +
      '7. importance 字段为该词的重要性，使用 high / medium / low 之一（核心考纲词为 high）。\n\n' +
      `文章内容：\n${content}\n` +
      '仅返回 JSON：[{"word":"","phonetic":"","pos":"","definition":"","example":"","exampleTranslation":"","importance":""}]',
  }
}
