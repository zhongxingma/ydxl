// 单词复习页 - 待复习列表 + 五步流程集成视图
// 视图状态机：
//   'list'     - 待复习列表（默认）：展示今日待复习队列，按紧急度排序
//   'review'   - 五步流程视图：识记 → 朗读 → 练习 → 拼写 → 默写
//   'complete' - 完成评价弹窗：用户主观反馈"已掌握"/"还需复习"，调用 applyWeightedReviewResult
//
// 本文件仅做三视图状态机路由与跨视图共享的庆祝/成就 overlay，
// 具体渲染逻辑下沉至：
//   - ReviewListView：列表视图
//   - ReviewSessionView：五步流程视图
//   - ReviewCompleteView：完成评价弹窗
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Achievement, ReviewStep, Word } from '@/shared/types'
import { cn } from '@/shared/utils/cn'
import Celebration from '@/shared/components/Celebration'
import { checkAndUnlockAchievements, statsService, AchievementUnlockToast } from '@/features/stats'
import { wordbookService } from '@/features/wordbook'
import { useReviewStore } from '../store'
import {
  applyWeightedReviewResult,
  getTodayReviewQueueInfo,
} from '../services/reviewService'
import type { TodayReviewQueueInfo } from '../services/reviewService'
import type { WeightedReviewInput } from '../services/sm2'
import ReviewListView, { type LoadStatus } from '../components/ReviewListView'
import ReviewSessionView from '../components/ReviewSessionView'
import ReviewCompleteView, { type Rating } from '../components/ReviewCompleteView'
import { STEP_LABEL, type StepResult } from '../types'

// 视图状态
type View = 'list' | 'review' | 'complete'

// 庆祝动画正向反馈文案池：每次"已掌握"评价后随机挑选一条
const CELEBRATION_TEXTS = [
  '太棒了！这个单词已经牢牢记住',
  '完美！继续保持',
  '你真厉害！又掌握一个单词',
  '出色！记忆越来越稳固',
  '满分！你正在快速进步',
]

// 将 correctRate（0-1）转换为正确数（基数 10，便于保留小数精度）
function toCount(rate: number, total = 10): number {
  return Math.round(rate * total)
}

export default function ReviewPage() {
  // 从 store 获取状态与 actions
  const currentWord = useReviewStore((s) => s.currentWord)
  const currentStep = useReviewStore((s) => s.currentStep)
  const unlockedSteps = useReviewStore((s) => s.unlockedSteps)
  const completedSteps = useReviewStore((s) => s.completedSteps)
  const reviewQueue = useReviewStore((s) => s.reviewQueue)
  const startReview = useReviewStore((s) => s.startReview)
  const goToStep = useReviewStore((s) => s.goToStep)
  const completeStep = useReviewStore((s) => s.completeStep)
  const endReview = useReviewStore((s) => s.endReview)

  // 视图状态
  const [view, setView] = useState<View>('list')
  // 待复习队列信息
  const [queueInfo, setQueueInfo] = useState<TodayReviewQueueInfo | null>(null)
  // 加载状态
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // 庆祝动画可见性 & 当前文案
  const [celebrating, setCelebrating] = useState(false)
  const [celebrationText, setCelebrationText] = useState('')
  // 本次新解锁的成就列表（用于触发 Toast 显示）
  const [unlockedAchievements, setUnlockedAchievements] = useState<Achievement[]>([])
  // 本次会话已复习单词数：用于队列清空时区分"已完成复习"与"本就无待复习"
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0)
  // 组件挂载状态标志：用于在异步补全完成前组件已卸载时跳过 setQueueInfo，避免状态泄漏
  const mountedRef = useRef(true)

  // 组件卸载时翻转挂载标志，供异步补全逻辑在写回 state 前做守卫
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 加载待复习列表
  const loadList = useCallback(async () => {
    setStatus('loading')
    try {
      const info = await getTodayReviewQueueInfo()
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      setQueueInfo(info)
      if (info.words.length === 0) {
        setStatus('empty')
      } else {
        setStatus('ready')
      }

      // 异步补全字段缺失的单词（best-effort，不阻塞复习流程）
      // 判断标准：phonetic/definition/example 任一为空字符串（enrichWord 内部会处理占位值 /-/、未知、暂未收录）
      const wordsNeedingEnrich = info.words.filter(
        (w) => !w.phonetic || !w.definition || !w.example
      )
      if (wordsNeedingEnrich.length > 0) {
        // 使用 cancelled 标志防止组件卸载后调用 setQueueInfo
        // Promise.allSettled 并行补全，单个失败仅 warn 不抛错
        void (async () => {
          const results = await Promise.allSettled(
            wordsNeedingEnrich.map((w) => wordbookService.enrichWord(w.id))
          )
          // 组件已卸载则放弃更新，避免对已卸载组件写入 state
          if (!mountedRef.current) return
          // 使用函数式更新确保基于最新 prev 合并，保留 queueInfo 其他字段
          setQueueInfo((prev) => {
            if (!prev) return prev
            const updatedWords = prev.words.map((w) => {
              const idx = wordsNeedingEnrich.findIndex((wn) => wn.id === w.id)
              if (idx === -1) return w
              const result = results[idx]
              if (result.status === 'fulfilled') return result.value
              // 补全失败：保留原单词，仅 warn 不抛错
              console.warn(
                '[ReviewPage] enrichWord 补全失败',
                w.word,
                result.reason
              )
              return w
            })
            return { ...prev, words: updatedWords }
          })
        })()
      }
    } catch (err) {
      console.warn('[ReviewPage] 加载复习队列失败', err)
      // 组件已卸载则放弃更新
      if (!mountedRef.current) return
      setErrorMsg('加载复习队列失败，请稍后重试')
      setStatus('error')
    }
  }, [])

  // 初次挂载：加载待复习列表
  useEffect(() => {
    void loadList()
  }, [loadList])

  // 卸载时清理 store，避免状态泄漏到下次进入
  useEffect(() => {
    return () => {
      endReview()
    }
  }, [endReview])

  // 点击列表项进入五步流程
  const handleWordClick = (word: Word) => {
    // 将该词置于队列首位；其余词作为练习干扰项来源
    const others = (queueInfo?.words ?? []).filter((w) => w.id !== word.id)
    startReview([word, ...others])
    setView('review')
  }

  // 完成步骤回调
  const handleComplete = async (step: ReviewStep, result: StepResult) => {
    await completeStep(step, result)
    // 五步全部完成（write 完成后 currentStep 置空）→ 进入评价弹窗
    const state = useReviewStore.getState()
    if (state.currentStep === null && step === 'write') {
      setView('complete')
    }
  }

  // 返回列表（中途退出或完成后）
  const handleBackToList = () => {
    endReview()
    setView('list')
    void loadList()
  }

  // 评价弹窗选择：调用 applyWeightedReviewResult 并返回列表
  const handleRating = async (rating: Rating) => {
    const state = useReviewStore.getState()
    const word = state.currentWord
    if (!word) {
      handleBackToList()
      return
    }

    // 根据评价构造三环节加权输入
    const weightedInput: WeightedReviewInput =
      rating === 'mastered'
        ? {
            // 已掌握：使用 store 中累计的实际正确率
            practiceCorrect: toCount(state.stepResults.practice?.correctRate ?? 0),
            practiceTotal: 10,
            spellCorrect: toCount(state.stepResults.spell?.correctRate ?? 0),
            spellTotal: 10,
            writeCorrect: toCount(state.stepResults.write?.correctRate ?? 0),
            writeTotal: 10,
          }
        : {
            // 还需复习：全 0 正确率，SM-2 会重置间隔为 1 天
            practiceCorrect: 0,
            practiceTotal: 10,
            spellCorrect: 0,
            spellTotal: 10,
            writeCorrect: 0,
            writeTotal: 10,
          }

    try {
      await applyWeightedReviewResult(word.id, weightedInput)

      // 乐观更新：立即从本地队列移除已复习单词并累加会话计数，
      // 确保复习流程即时闭合（loadList 随后全量刷新，此处仅保证 UI 不显示陈旧数据）
      setSessionReviewedCount((c) => c + 1)
      setQueueInfo((prev) => {
        if (!prev) return prev
        const words = prev.words.filter((w) => w.id !== word.id)
        const total = Math.max(0, prev.total - 1)
        return { ...prev, words, total, reachedLimit: prev.limit > 0 && total > prev.limit }
      })

      // "已掌握"时触发庆祝动画与成就检查（失败不影响主流程）
      if (rating === 'mastered') {
        const idx = Math.floor(Math.random() * CELEBRATION_TEXTS.length)
        setCelebrationText(CELEBRATION_TEXTS[idx])
        setCelebrating(true)
        try {
          const ctx = await statsService.buildAchievementContext()
          const newlyUnlocked = await checkAndUnlockAchievements(ctx)
          if (newlyUnlocked.length > 0) {
            setUnlockedAchievements(newlyUnlocked)
          }
        } catch (err) {
          console.error('[Achievement]', err)
        }
      }
    } catch (err) {
      console.warn('[ReviewPage] 应用复习结果失败', err)
    } finally {
      // 立即返回列表并刷新
      endReview()
      setView('list')
      void loadList()
    }
  }

  // 庆祝动画结束回调
  const handleCelebrationComplete = () => {
    setCelebrating(false)
  }

  // 复习进度计算（SubTask 7.1：从 sessionReviewedCount 与 queueInfo.total 派生）
  // 初始总数 = 已复习数 + 当前剩余数（复习过程中两者此消彼长，和恒定为初始快照）
  const currentQueueTotal = queueInfo?.total ?? 0
  const initialTotal = sessionReviewedCount + currentQueueTotal
  const reviewProgress = initialTotal > 0
    ? Math.min(100, Math.round((sessionReviewedCount / initialTotal) * 100))
    : 0
  // 复习完成：有复习记录且当前队列为空
  const isReviewComplete = sessionReviewedCount > 0 && currentQueueTotal === 0
  // 当前阶段标签（SubTask 7.2）
  const stageLabel =
    view === 'review' && currentStep
      ? STEP_LABEL[currentStep]
      : view === 'complete'
        ? '完成评价'
        : isReviewComplete
          ? '已完成'
          : sessionReviewedCount > 0
            ? '复习中'
            : '待复习'

  return (
    <div className="space-y-4 pb-8">
      {/* 庆祝动画覆盖层（fixed 定位，不参与下方布局） */}
      <Celebration
        visible={celebrating}
        onComplete={handleCelebrationComplete}
        text={celebrationText}
      />

      {/* 成就解锁 Toast：本次新解锁时弹出，3 秒后自动关闭 */}
      <AchievementUnlockToast
        achievements={unlockedAchievements}
        onClose={() => setUnlockedAchievements([])}
      />

      {/* 复习进度条（SubTask 7.2-7.4）：sticky 顶部，参考 ReadingPage 阅读进度条样式 */}
      {/* 仅在有待复习内容（initialTotal > 0）时显示 */}
      {initialTotal > 0 && (
        <header className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {isReviewComplete
                ? '今日复习已完成 🎉'
                : `已复习 ${sessionReviewedCount} / ${initialTotal} · ${reviewProgress}%`}
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {stageLabel}
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            role="progressbar"
            aria-valuenow={sessionReviewedCount}
            aria-valuemin={0}
            aria-valuemax={initialTotal}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                isReviewComplete
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 dark:from-emerald-400 dark:to-green-400'
                  : 'bg-gradient-to-r from-blue-500 to-indigo-500 dark:from-blue-400 dark:to-indigo-400'
              )}
              style={{ width: `${reviewProgress}%` }}
            />
          </div>
        </header>
      )}

      {view === 'list' && (
        <ReviewListView
          queueInfo={queueInfo}
          status={status}
          errorMsg={errorMsg}
          sessionReviewedCount={sessionReviewedCount}
          onWordClick={handleWordClick}
          onReload={() => void loadList()}
        />
      )}

      {view === 'review' && currentWord && currentStep && (
        <ReviewSessionView
          currentWord={currentWord}
          currentStep={currentStep}
          unlockedSteps={unlockedSteps}
          completedSteps={completedSteps}
          reviewQueue={reviewQueue}
          goToStep={goToStep}
          onBackToList={handleBackToList}
          onComplete={handleComplete}
        />
      )}

      {view === 'complete' && (
        <ReviewCompleteView
          word={currentWord}
          onRating={handleRating}
          onBackToList={handleBackToList}
        />
      )}
    </div>
  )
}
