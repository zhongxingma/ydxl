// AI Prompt 模板集中定义
// DeepSeek Provider 使用此处的 prompt，结构遵循「稳定前缀 + 动态变量后置」原则
// 以最大化 DeepSeek Context Cache（上下文硬盘缓存）命中率，降低 Token 成本
import type { Difficulty, Topic } from '@/shared/types'
import type { Genre } from './types'

// 共享：JSON 输出规则常量
// 所有 JSON 输出场景的 system message 末尾使用此常量，确保前缀稳定
// 注：jsonMode 已强制 JSON Output，无需再声明「不要包含 markdown 代码块标记」
const JSON_OUTPUT_RULE = '你只能输出严格的 JSON。'

// 文体中文名映射，便于在 prompt 中给出明确文体要求
const GENRE_LABEL: Record<Genre, string> = {
  narrative: '记叙文（narrative）',
  expository: '说明文（expository）',
  practical: '应用文（practical）',
  argumentative: '议论文（argumentative）',
}

// 题材中文名映射，对应 Topic 类型
const TOPIC_LABEL: Record<Topic, string> = {
  campus: '校园',
  science: '科普',
  culture: '文化',
  biography: '人物故事',
  travel: '旅行',
  sports: '体育',
  technology: '科技',
  nature: '自然',
  news: '新闻时事',
  // 新课标三大主题
  self: '人与自我（生活与学习）',
  society: '人与社会（历史、科技、人际交往）',
  nature_theme: '人与自然（环境保护、宇宙探索）',
  // 生活化题材（附专属创作简报，见 TOPIC_BRIEF）
  traditional_culture: '中华传统文化',
  ai_life: '人工智能与生活',
  personal_growth: '个人成长与真实体验',
}

// 生活化题材专属创作简报（防套话/防千篇一律）
//
// 背景：通用命题式 prompt 容易让模型在这些题材上产出模板化内容
//（如 AI 题材写成利弊议论文、传统文化题材写成节日百科、成长题材结尾喊口号）。
// 为每个题材注入「写具体经历、禁套话」的结构化简报，强制第一人称真实叙事。
// 参考要求保持 200-300 词的中考素材约束（通用要求第 5 条），此处仅追加题材专属要求。
const TOPIC_BRIEF: Partial<Record<Topic, string>> = {
  ai_life:
    '题材专属要求（人工智能与生活，务必遵循）：\n' +
    '写「我使用 AI 工具的一次具体经历」的第一人称记叙文，禁止写成 AI 利弊议论文。\n' +
    '必须包含全部要素：① 具体的工具名；② 我原本要做什么；③ AI 帮我做了什么；' +
    '④ 一个出错、尴尬或让我过度依赖的问题；⑤ 我最后怎么调整。\n' +
    '禁止使用 "AI is a double-edged sword"、"With the development of AI"、"AI makes our life easier" 等套话开头或总结。\n' +
    '关键：写一次具体经历，不是「AI 的好处和坏处」。genre 字段填 narrative。',
  traditional_culture:
    '题材专属要求（中华传统文化，务必遵循）：\n' +
    '以初中生身份给外国笔友写一封邮件，介绍我参加的一次传统文化活动（如包粽子、写春联、做灯笼、学剪纸、茶艺体验等，自选一个具体活动）。\n' +
    '必须包含全部要素：① 活动名称；② 时间地点；③ 我动手做了什么；④ 遇到的小困难；⑤ 谁帮了我；⑥ 我当时真实的感受。\n' +
    '禁止从历史来源、朝代典故角度介绍，禁止喊「传承文化」「cultural heritage is important」之类的口号。\n' +
    '关键：写「我参与的过程」，不是「节日百科」。genre 字段填 practical。',
  personal_growth:
    '题材专属要求（个人成长与真实体验，务必遵循）：\n' +
    '写一篇英语日记，讲述一次让我成长的经历（如一次比赛失利、一次上台紧张、一次弄丢物品等，自选具体场景）。开头直接进入场景，不要总起句。\n' +
    '必须包含全部要素：① 一个失败或尴尬的瞬间；② 身体感受（心跳加速、手心出汗、脸发烫等至少一处）；' +
    '③ 一句对话（引号直接引语）；④ 一个小改变。\n' +
    '结尾禁止写「我明白了……」「This experience taught me...」之类的大道理总结，必须用一个具体动作或一个具体想法收尾。\n' +
    '关键：写「具体挫折和转折」，不是「我学会了坚持」。genre 字段填 narrative。',
}

// 难度等级与蓝思值范围映射
// easy: 600-700L、medium: 700-800L、hard: 800-900L
const DIFFICULTY_CONFIG: Record<
  Difficulty,
  { label: string; lexileMin: number; lexileMax: number }
> = {
  easy: { label: '简单', lexileMin: 600, lexileMax: 700 },
  medium: { label: '中等', lexileMin: 700, lexileMax: 800 },
  hard: { label: '困难', lexileMin: 800, lexileMax: 900 },
}

// 创作风格随机化预设（打破 AI 文章模板化/千篇一律）
//
// 根因：文章生成的 prompt 高度「命题式」（14 条结构约束 + 强制文体四段结构 +
// thinkingDisabled 关闭思考），模型的优化目标退化为「满足约束的最安全解」而非创作，
// 导致即使题材/文体不同，行文结构仍高度趋同（固定套路如
// "It was a sunny day..." 开头 / "However" 转折 / "In conclusion" 结尾）。
//
// 手段：每次生成时随机选择一组「叙事视角 + 开头策略 + 结尾策略」，注入 user message，
// 从源头打破确定性的套路写作。该段为动态内容，置于 user message 末尾，
// 保持 system 前缀稳定以最大化 DeepSeek Context Cache 命中。
const VARIATION_PRESETS = [
  {
    perspective: '第一人称（讲述"我"的亲身经历或见闻）',
    opening: '以一个具体场景或画面开场，直接切入正在发生的事件',
    ending: '自然收束，不刻意总结，给读者留白或回味空间',
  },
  {
    perspective: '第三人称（旁观者视角讲述人物故事）',
    opening: '以人物对话开场，通过对话引出人物与事件',
    ending: '以一个反转或意外结局收尾',
  },
  {
    perspective: '书信或日记体（以日期、称呼或内心独白展开）',
    opening: '以日期、称呼或第一句内心独白开场',
    ending: '以感悟或情感升华收尾',
  },
  {
    perspective: '第三人称倒叙（先呈现结果或高潮，再回溯经过）',
    opening: '以悬念或疑问句开场，设置问题吸引读者',
    ending: '开放式结局，留给读者想象空间',
  },
  {
    perspective: '回忆性叙述（现在与过去交织）',
    opening: '以一句凝练的观点、名言或设问开场',
    ending: '回扣标题或开头，首尾呼应',
  },
] as const

// 随机选取一组创作风格（运行时随机，避免文章单调）
function pickVariation(): (typeof VARIATION_PRESETS)[number] {
  return VARIATION_PRESETS[Math.floor(Math.random() * VARIATION_PRESETS.length)]!
}

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
