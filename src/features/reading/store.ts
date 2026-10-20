// 阅读模块状态管理
// 管理视图状态机、答题进度、计时器、逐句切换翻译状态
import { create } from 'zustand'

// 视图状态：阅读 / 答题 / 语法填空 / 成绩单
export type ReadingView = 'reading' | 'quiz' | 'grammar_quiz' | 'result'

interface ReadingState {
  // 当前视图
  view: ReadingView
  // 当前题目索引（quiz 视图单题切换）
  currentQuestionIndex: number
  // 用户作答：题号（在 questions 数组中的下标） -> 选中选项下标
  answers: Record<number, number>
  // 计时器开始时间戳（毫秒），0 表示未开始
  startTime: number
  // 累计暂停时长（毫秒），用于在 resume 时计算有效阅读时长
  pausedDuration: number
  // 暂时记录暂停开始时间戳，0 表示未在暂停中
  pauseStartedAt: number
  // 逐句切换模式下已切到译文的句子 key 集合
  // key 使用全局句子索引（按段落展开后顺序编号）
  sentenceTranslationVisible: Set<number>
  // 是否已记录本次阅读会话（避免重复写入）
  sessionRecorded: boolean

  // 切换视图
  setView: (view: ReadingView) => void
  // 设置某题的作答
  setAnswer: (questionIdx: number, optionIndex: number) => void
  // 下一题；最后一题时切换到 result 视图
  nextQuestion: (totalQuestions: number) => void
  // 上一题（可选支持回看）
  prevQuestion: () => void
  // 跳转到指定题目（用于 result 视图回看题目）
  goToQuestion: (idx: number) => void
  // 启动计时器
  startTimer: () => void
  // 暂停计时器（visibilitychange hidden 时）
  pauseTimer: () => void
  // 恢复计时器（visibilitychange visible 时）
  resumeTimer: () => void
  // 计算已用有效时长（秒），用于显示与记录
  getElapsedSec: () => number
  // 切换指定句子的翻译显示状态
  toggleSentenceTranslation: (sentenceIdx: number) => void
  // 重置全部状态（用于切换文章时）
  reset: () => void
  // 标记本次阅读会话已记录
  markSessionRecorded: () => void
}

const INITIAL_STATE = {
  view: 'reading' as ReadingView,
  currentQuestionIndex: 0,
  answers: {} as Record<number, number>,
  startTime: 0,
  pausedDuration: 0,
  pauseStartedAt: 0,
  sentenceTranslationVisible: new Set<number>(),
  sessionRecorded: false,
}

export const useReadingStore = create<ReadingState>((set, get) => ({
  ...INITIAL_STATE,

  setView: (view) => set({ view }),

  setAnswer: (questionIdx, optionIndex) =>
    set((state) => ({
      answers: { ...state.answers, [questionIdx]: optionIndex },
    })),

  nextQuestion: (totalQuestions) => {
    const { currentQuestionIndex } = get()
    const next = currentQuestionIndex + 1
    if (next >= totalQuestions) {
      // 最后一题，切到 result 视图
      set({ view: 'result' })
    } else {
      set({ currentQuestionIndex: next })
    }
  },

  prevQuestion: () => {
    const { currentQuestionIndex } = get()
    if (currentQuestionIndex > 0) {
      set({ currentQuestionIndex: currentQuestionIndex - 1 })
    }
  },

  goToQuestion: (idx) => set({ currentQuestionIndex: idx, view: 'quiz' }),

  startTimer: () => {
    // 仅在 startTime 为 0 时启动，避免重复启动
    if (get().startTime === 0) {
      set({ startTime: Date.now(), pausedDuration: 0, pauseStartedAt: 0 })
    }
  },

  pauseTimer: () => {
    const { startTime, pauseStartedAt } = get()
    if (startTime === 0 || pauseStartedAt !== 0) {
      // 未开始或已在暂停中，直接返回
      return
    }
    set({ pauseStartedAt: Date.now() })
  },

  resumeTimer: () => {
    const { pauseStartedAt, pausedDuration } = get()
    if (pauseStartedAt === 0) {
      // 未在暂停中，无需恢复
      return
    }
    // 累加暂停时长
    const newPaused = pausedDuration + (Date.now() - pauseStartedAt)
    set({ pauseStartedAt: 0, pausedDuration: newPaused })
  },

  getElapsedSec: () => {
    const { startTime, pauseStartedAt, pausedDuration } = get()
    if (startTime === 0) return 0
    // 若当前在暂停中，则不计入自暂停以来的时间
    const now = pauseStartedAt !== 0 ? pauseStartedAt : Date.now()
    const elapsedMs = now - startTime - pausedDuration
    return Math.max(0, Math.floor(elapsedMs / 1000))
  },

  toggleSentenceTranslation: (sentenceIdx) =>
    set((state) => {
      const newSet = new Set(state.sentenceTranslationVisible)
      if (newSet.has(sentenceIdx)) {
        newSet.delete(sentenceIdx)
      } else {
        newSet.add(sentenceIdx)
      }
      return { sentenceTranslationVisible: newSet }
    }),

  reset: () =>
    set({
      ...INITIAL_STATE,
      // 重置时 sentenceTranslationVisible 必须为新的 Set 实例
      sentenceTranslationVisible: new Set<number>(),
    }),

  markSessionRecorded: () => set({ sessionRecorded: true }),
}))
