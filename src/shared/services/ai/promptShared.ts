// Prompt 共享常量与映射表
//
// 集中定义所有 prompt 共用的输出规则、文体/题材/难度映射与创作风格预设，
// 供 articlePrompts.ts 与 wordPrompts.ts 复用。
import type { Difficulty, Topic } from '@/shared/types'
import type { Genre } from './types'

// 共享：JSON 输出规则常量
// 所有 JSON 输出场景的 system message 末尾使用此常量，确保前缀稳定
// 注：jsonMode 已强制 JSON Output，无需再声明「不要包含 markdown 代码块标记」
export const JSON_OUTPUT_RULE = '你只能输出严格的 JSON。'

// 文体中文名映射，便于在 prompt 中给出明确文体要求
export const GENRE_LABEL: Record<Genre, string> = {
  narrative: '记叙文（narrative）',
  expository: '说明文（expository）',
  practical: '应用文（practical）',
  argumentative: '议论文（argumentative）',
}

// 题材中文名映射，对应 Topic 类型
export const TOPIC_LABEL: Record<Topic, string> = {
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
export const TOPIC_BRIEF: Partial<Record<Topic, string>> = {
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
export const DIFFICULTY_CONFIG: Record<
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
export const VARIATION_PRESETS = [
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
export function pickVariation(): (typeof VARIATION_PRESETS)[number] {
  return VARIATION_PRESETS[Math.floor(Math.random() * VARIATION_PRESETS.length)]!
}
