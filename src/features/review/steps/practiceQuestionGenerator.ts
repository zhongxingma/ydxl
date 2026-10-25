// 练习题目生成器（纯函数，与 React 无关）
//
// 题型从 7 种中随机抽取，每次练习 3-5 题：
// 1. def-to-word：释义 → 单词
// 2. word-to-def：单词 → 释义
// 3. fill-blank：例句填空
// 4. listen-choose-def：听音选义（播放发音，选释义）
// 5. def-choose-word：看义选音（释义选单词，可点击单词听发音）
// 6. synonym：选近义词
// 7. antonym：选反义词
//
// 干扰项来源：复习队列中的其他单词 + 预设词库；预设词库用于队列不足时补充，
// 避免出现「（其他释义 N）」这类占位选项。
import type { Word } from '@/shared/types'

// 题型枚举
export type QuestionType =
  | 'def-to-word'
  | 'word-to-def'
  | 'fill-blank'
  | 'listen-choose-def'
  | 'def-choose-word'
  | 'synonym'
  | 'antonym'

// 一道题的结构
export interface Question {
  type: QuestionType
  stem: string
  options: string[]
  correctIndex: number
  // 已被排除的选项索引（提示用）
  eliminated: Set<number>
  // 是否已显示首字母提示
  letterHintShown: boolean
  // 听音选义题：题干需要播放的文本
  stemAudio?: string
  // 看义选音题：选项为单词，可点击播放
  optionAudio?: boolean
}

// 题数随机区间
const MIN_QUESTIONS = 3
const MAX_QUESTIONS = 5

// 预设干扰词库（当复习队列干扰项不足时补充）
const PRESET_DISTRACTORS = [
  'acquire', 'adapt', 'adjust', 'analyze', 'approach', 'benefit', 'capable', 'circumstance',
  'communicate', 'complex', 'concept', 'consistent', 'context', 'contribute', 'creative',
  'culture', 'derive', 'determine', 'develop', 'economy', 'effective', 'element', 'emphasize',
  'establish', 'evaluate', 'evidence', 'factor', 'feature', 'final', 'focus', 'function',
  'identify', 'impact', 'indicate', 'interpret', 'involve', 'issue', 'maintain', 'method',
  'obtain', 'occur', 'participate', 'process', 'produce', 'require', 'research', 'respond',
  'significant', 'similar', 'source', 'specific', 'strategy', 'structure', 'theory', 'vary',
]

// 预设释义干扰词库（当复习队列释义不足时补充真实释义作为干扰项）
// 覆盖 PRESET_DISTRACTORS 中的常见词，避免使用"（其他释义 N）"占位符
const PRESET_DEFINITIONS: Record<string, string> = {
  acquire: '获得，取得',
  adapt: '适应，改编',
  adjust: '调整，调节',
  analyze: '分析',
  approach: '方法，接近',
  benefit: '益处，受益',
  capable: '有能力的',
  circumstance: '情况，环境',
  communicate: '交流，沟通',
  complex: '复杂的',
  concept: '概念',
  consistent: '一致的',
  context: '上下文，背景',
  contribute: '贡献，捐助',
  creative: '有创造力的',
  culture: '文化',
  derive: '源于，得到',
  determine: '决定，确定',
  develop: '发展，开发',
  economy: '经济',
  effective: '有效的',
  element: '元素，要素',
  emphasize: '强调',
  establish: '建立，确立',
  evaluate: '评估',
  evidence: '证据',
  factor: '因素',
  feature: '特征，特色',
  final: '最终的',
  focus: '集中，焦点',
  function: '功能，作用',
  identify: '识别，确认',
  impact: '影响',
  indicate: '表明，指示',
  interpret: '解释，口译',
  involve: '包含，涉及',
  issue: '问题，议题',
  maintain: '维持，保养',
  method: '方法',
  obtain: '获得',
  occur: '发生',
  participate: '参与',
  process: '过程，处理',
  produce: '生产，产生',
  require: '需要，要求',
  research: '研究',
  respond: '回应，响应',
  significant: '重要的，显著的',
  similar: '相似的',
  source: '来源，源泉',
  specific: '具体的，特定的',
  strategy: '策略',
  structure: '结构',
  theory: '理论',
  vary: '变化，不同',
}

// 预设近义词词典（小规模，覆盖常见词；不在词典中的词跳过近义题型）
const SYNONYM_MAP: Record<string, string[]> = {
  happy: ['glad', 'joyful', 'cheerful', 'delighted'],
  big: ['large', 'huge', 'enormous', 'gigantic'],
  small: ['tiny', 'little', 'petite', 'miniature'],
  fast: ['quick', 'rapid', 'swift', 'speedy'],
  slow: ['sluggish', 'leisurely', 'gradual', 'unhurried'],
  smart: ['clever', 'intelligent', 'bright', 'wise'],
  beautiful: ['pretty', 'lovely', 'gorgeous', 'attractive'],
  important: ['significant', 'crucial', 'vital', 'essential'],
  difficult: ['hard', 'tough', 'challenging', 'complex'],
  begin: ['start', 'commence', 'initiate', 'launch'],
  end: ['finish', 'conclude', 'complete', 'terminate'],
  help: ['assist', 'support', 'aid', 'facilitate'],
  show: ['display', 'reveal', 'exhibit', 'demonstrate'],
  buy: ['purchase', 'acquire', 'obtain', 'procure'],
}

// 预设反义词词典
const ANTONYM_MAP: Record<string, string[]> = {
  happy: ['sad', 'unhappy', 'miserable', 'upset'],
  big: ['small', 'tiny', 'little', 'miniature'],
  small: ['big', 'large', 'huge', 'enormous'],
  fast: ['slow', 'sluggish', 'leisurely', 'gradual'],
  slow: ['fast', 'quick', 'rapid', 'swift'],
  smart: ['foolish', 'silly', 'ignorant', 'dull'],
  beautiful: ['ugly', 'plain', 'unattractive', 'hideous'],
  important: ['trivial', 'insignificant', 'minor', 'unimportant'],
  difficult: ['easy', 'simple', 'effortless', 'straightforward'],
  begin: ['end', 'finish', 'conclude', 'terminate'],
  end: ['begin', 'start', 'commence', 'initiate'],
  help: ['hinder', 'obstruct', 'impede', 'hamper'],
  show: ['hide', 'conceal', 'cover', 'mask'],
  buy: ['sell', 'trade', 'barter', 'auction'],
}

// 打乱数组（Fisher-Yates）
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 从干扰词库 + 其他单词中随机抽取 n 个不重复的干扰项
function pickDistractors(correct: string, pool: string[], n: number): string[] {
  const filtered = pool.filter((w) => w.toLowerCase() !== correct.toLowerCase())
  return shuffle(filtered).slice(0, n)
}

// 生成单道题目
function generateQuestion(
  type: QuestionType,
  word: Word,
  wordPool: string[],
  defPool: string[],
): Question | null {
  switch (type) {
    case 'def-to-word': {
      // definition 为空时跳过该题型（不显示 word 作为释义 fallback）
      if (!word.definition) return null
      // 题干：中文释义；选项：英文单词
      const options = pickDistractors(word.word, wordPool, 3)
      const allOptions = shuffle([word.word, ...options])
      return {
        type,
        stem: `下列哪个单词的意思是「${word.definition}」？`,
        options: allOptions,
        correctIndex: allOptions.indexOf(word.word),
        eliminated: new Set<number>(),
        letterHintShown: false,
      }
    }
    case 'word-to-def': {
      // 题干：英文单词；选项：中文释义
      if (!word.definition) return null
      const options = pickDistractors(word.definition, defPool, 3)
      // 防御性补充：极端情况下 defPool 仍不足时从预设释义补充
      while (options.length < 3) {
        const presetDefs = Object.values(PRESET_DEFINITIONS)
        const fallback = presetDefs.find((d) => !options.includes(d) && d !== word.definition)
        if (fallback) options.push(fallback)
        else break
      }
      const allOptions = shuffle([word.definition, ...options])
      return {
        type,
        stem: `单词「${word.word}」的中文释义是？`,
        options: allOptions,
        correctIndex: allOptions.indexOf(word.definition),
        eliminated: new Set<number>(),
        letterHintShown: false,
      }
    }
    case 'fill-blank': {
      // 例句填空
      if (!word.example) return null
      const blanked = word.example.replace(new RegExp(word.word, 'gi'), '______')
      if (blanked === word.example) return null
      const options = pickDistractors(word.word, wordPool, 3)
      const allOptions = shuffle([word.word, ...options])
      return {
        type,
        stem: `根据例句填空：${blanked}`,
        options: allOptions,
        correctIndex: allOptions.indexOf(word.word),
        eliminated: new Set<number>(),
        letterHintShown: false,
      }
    }
    case 'listen-choose-def': {
      // 听音选义：播放发音，选释义
      if (!word.definition) return null
      const options = pickDistractors(word.definition, defPool, 3)
      // 防御性补充：极端情况下 defPool 仍不足时从预设释义补充
      while (options.length < 3) {
        const presetDefs = Object.values(PRESET_DEFINITIONS)
        const fallback = presetDefs.find((d) => !options.includes(d) && d !== word.definition)
        if (fallback) options.push(fallback)
        else break
      }
      const allOptions = shuffle([word.definition, ...options])
      return {
        type,
        stem: '🔊 听发音，选出对应的中文释义',
        options: allOptions,
        correctIndex: allOptions.indexOf(word.definition),
        eliminated: new Set<number>(),
        letterHintShown: false,
        stemAudio: word.word,
      }
    }
    case 'def-choose-word': {
      // 看义选音：释义选单词，可点击单词听发音
      const options = pickDistractors(word.word, wordPool, 3)
      const allOptions = shuffle([word.word, ...options])
      return {
        type,
        stem: `哪个单词表示「${word.definition || word.word}」？点击可试听`,
        options: allOptions,
        correctIndex: allOptions.indexOf(word.word),
        eliminated: new Set<number>(),
        letterHintShown: false,
        optionAudio: true,
      }
    }
    case 'synonym':
    case 'antonym': {
      // 近义词 / 反义词配对
      const map = type === 'synonym' ? SYNONYM_MAP : ANTONYM_MAP
      const key = word.word.toLowerCase()
      const candidates = map[key]
      if (!candidates || candidates.length === 0) return null
      const correct = candidates[0]
      // 干扰项：同词典中其他词 + 预设词库
      const distractorPool = [
        ...candidates.slice(1),
        ...wordPool.filter((w) => w.toLowerCase() !== correct.toLowerCase()),
      ]
      const options = pickDistractors(correct, distractorPool, 3)
      // 防御性补充：从预设干扰词库补充真实英文单词
      while (options.length < 3) {
        const fallback = PRESET_DISTRACTORS.find(
          (w) => !options.includes(w) && w.toLowerCase() !== correct.toLowerCase()
        )
        if (fallback) options.push(fallback)
        else break
      }
      const allOptions = shuffle([correct, ...options])
      return {
        type,
        stem: `选出「${word.word}」的${type === 'synonym' ? '近义词' : '反义词'}`,
        options: allOptions,
        correctIndex: allOptions.indexOf(correct),
        eliminated: new Set<number>(),
        letterHintShown: false,
      }
    }
    default:
      return null
  }
}

// 生成题目列表：随机 3-5 题
export function generateQuestions(word: Word, distractorWords: Word[]): Question[] {
  const wordPool = [...distractorWords.map((w) => w.word), ...PRESET_DISTRACTORS]
  // 释义干扰池：复习队列释义 + 预设释义（避免释义不足时使用占位符）
  const defPool = [
    ...distractorWords.map((w) => w.definition).filter(Boolean),
    ...Object.values(PRESET_DEFINITIONS),
  ]

  // 候选题型
  const candidateTypes: QuestionType[] = [
    'def-to-word',
    'word-to-def',
    'fill-blank',
    'listen-choose-def',
    'def-choose-word',
    'synonym',
    'antonym',
  ]
  const shuffledTypes = shuffle(candidateTypes)

  const target = MIN_QUESTIONS + Math.floor(Math.random() * (MAX_QUESTIONS - MIN_QUESTIONS + 1))
  const questions: Question[] = []

  // 第一轮：尽量不重复题型
  for (const type of shuffledTypes) {
    if (questions.length >= target) break
    const q = generateQuestion(type, word, wordPool, defPool)
    if (q) {
      questions.push(q)
    }
  }

  // 不足目标数：放宽题型重复限制（用 def-to-word 兜底）
  while (questions.length < MIN_QUESTIONS) {
    const q = generateQuestion('def-to-word', word, wordPool, defPool)
    if (q) questions.push(q)
    else break
  }

  return questions.slice(0, target)
}

// 题型中文标签
export const TYPE_LABEL: Record<QuestionType, string> = {
  'def-to-word': '释义 → 单词',
  'word-to-def': '单词 → 释义',
  'fill-blank': '例句填空',
  'listen-choose-def': '听音选义',
  'def-choose-word': '看义选音',
  synonym: '选近义词',
  antonym: '选反义词',
}
