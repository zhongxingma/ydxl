// 五步生词背诵状态管理：状态机 + 复习队列
// 步骤顺序：learn → read → practice → spell → write
// 每完成一步解锁下一步；完成 'write' 步骤后由 UI 层（完成弹窗）调用
// applyWeightedReviewResult 触发 SM-2 算法更新单词
import { logger } from '../../shared/utils/logger'
import { create } from 'zustand'
import type { ReviewStep, Word } from '@/shared/types'
import { recordStepReview } from './services/reviewService'
import { getNextStep } from './types'
import type { StepResult } from './types'

// 复习状态接口
interface ReviewState {
  // 当前学习的单词
  currentWord: Word | null
  // 当前步骤
  currentStep: ReviewStep | null
  // 已解锁步骤
  unlockedSteps: Set<ReviewStep>
  // 已完成步骤
  completedSteps: Set<ReviewStep>
  // 待复习单词队列（包含当前词，reviewQueue[0] 即 currentWord）
  reviewQueue: Word[]
  // 每步结果
  stepResults: Partial<Record<ReviewStep, StepResult>>
  // 已复习单词数
  reviewedCount: number
  // 本次复习总数
  totalCount: number
  // 全部完成标志
  allComplete: boolean

  // 初始化队列，从队列首取一个词作为 currentWord，解锁 'learn' 步骤
  startReview: (words: Word[]) => void
  // 切换到指定步骤（仅当 step 已解锁时）
  goToStep: (step: ReviewStep) => void
  // 完成一步：标记完成、解锁下一步、记录结果、写入 Review 记录
  // 若 step === 'write'，调用 applyReviewResult 触发 SM-2 更新
  completeStep: (step: ReviewStep, result: StepResult) => Promise<void>
  // 取下一个词，重置步骤状态
  nextWord: () => void
  // 跳过当前词（不更新 word，不计入 reviewedCount）
  skipWord: () => void
  // 结束复习，清空状态
  endReview: () => void
}

// 初始步骤状态
const INITIAL_STEP_STATE = {
  currentStep: null as ReviewStep | null,
  unlockedSteps: new Set<ReviewStep>(),
  completedSteps: new Set<ReviewStep>(),
  stepResults: {} as Partial<Record<ReviewStep, StepResult>>,
}

// 重置步骤状态为开始复习某个新词的初始态
function getFreshStepState(): Pick<ReviewState, 'currentStep' | 'unlockedSteps' | 'completedSteps' | 'stepResults'> {
  return {
    currentStep: 'learn',
    unlockedSteps: new Set<ReviewStep>(['learn']),
    completedSteps: new Set<ReviewStep>(),
    stepResults: {},
  }
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  currentWord: null,
  ...INITIAL_STEP_STATE,
  reviewQueue: [],
  reviewedCount: 0,
  totalCount: 0,
  allComplete: false,

  startReview: (words) => {
    if (words.length === 0) {
      set({
        currentWord: null,
        ...INITIAL_STEP_STATE,
        reviewQueue: [],
        reviewedCount: 0,
        totalCount: 0,
        allComplete: true,
      })
      return
    }
    set({
      reviewQueue: words,
      currentWord: words[0],
      ...getFreshStepState(),
      reviewedCount: 0,
      totalCount: words.length,
      allComplete: false,
    })
  },

  goToStep: (step) => {
    const { unlockedSteps } = get()
    if (!unlockedSteps.has(step)) {
      logger.warn('[reviewStore] 步骤未解锁，无法切换', step)
      return
    }
    set({ currentStep: step })
  },

  completeStep: async (step, result) => {
    const state = get()
    const { currentWord, completedSteps, stepResults } = state
    if (!currentWord) {
      logger.warn('[reviewStore] 无当前单词，无法完成步骤')
      return
    }

    // 1. 标记完成
    const newCompleted = new Set(completedSteps)
    newCompleted.add(step)

    // 2. 记录结果
    const newResults = { ...stepResults, [step]: result }

    // 3. 解锁下一步
    const nextStep = getNextStep(step)
    const newUnlocked = new Set(state.unlockedSteps)
    if (nextStep) {
      newUnlocked.add(nextStep as ReviewStep)
    }

    // 4. 写入单步 Review 记录（异步，不阻塞状态推进）
    void recordStepReview(currentWord.id, step, result)

    // 5. 更新状态：完成集合、结果、解锁、自动推进
    set({
      completedSteps: newCompleted,
      stepResults: newResults,
      unlockedSteps: newUnlocked,
      // write 是最后一步，完成后 currentStep 置空（标记本词完成）
      currentStep: nextStep ? (nextStep as ReviewStep) : null,
    })

    // 6. SM-2 更新交由 UI 层（ReviewPage 完成弹窗）根据用户评价调用
    //    applyWeightedReviewResult，避免双写与覆盖用户主观反馈
  },

  nextWord: () => {
    const state = get()
    const { reviewQueue, reviewedCount } = state
    // 移除当前词（队首）
    const remaining = reviewQueue.slice(1)
    const newReviewed = reviewedCount + 1

    if (remaining.length === 0) {
      // 队列为空，全部完成
      set({
        reviewQueue: [],
        currentWord: null,
        ...INITIAL_STEP_STATE,
        reviewedCount: newReviewed,
        allComplete: true,
      })
      return
    }

    // 取下一个词
    set({
      reviewQueue: remaining,
      currentWord: remaining[0],
      ...getFreshStepState(),
      reviewedCount: newReviewed,
      allComplete: false,
    })
  },

  skipWord: () => {
    const state = get()
    const { reviewQueue } = state
    // 跳过当前词：移除队首，但不增加 reviewedCount
    const remaining = reviewQueue.slice(1)

    if (remaining.length === 0) {
      set({
        reviewQueue: [],
        currentWord: null,
        ...INITIAL_STEP_STATE,
        allComplete: true,
      })
      return
    }

    set({
      reviewQueue: remaining,
      currentWord: remaining[0],
      ...getFreshStepState(),
    })
  },

  endReview: () => {
    set({
      currentWord: null,
      ...INITIAL_STEP_STATE,
      reviewQueue: [],
      reviewedCount: 0,
      totalCount: 0,
      allComplete: false,
    })
  },
}))
