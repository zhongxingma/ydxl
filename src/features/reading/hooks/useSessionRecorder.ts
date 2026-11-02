// 会话记录器 hook：在答题完成进入 result 视图时，将本次阅读会话写入 readingSessions 表
// - 计算正确率与用时，调用 statsService.recordReadingSession
// - 写入后触发成就检查（失败不影响主流程）
// - 通过 sessionRecorded 标志避免重复写入
import { logger } from '../../../shared/utils/logger'
import { useEffect, useState } from 'react'
import type { Achievement, Article, Question } from '@/shared/types'
import { statsService, checkAndUnlockAchievements } from '@/features/stats'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { ReadingView } from '../store'

export interface UseSessionRecorderParams {
  // 当前视图：仅 view === 'result' 时触发记录
  view: ReadingView
  // 当前文章（提供 id 与 wordCount）
  article: Article | null
  // 题目列表（用于计算正确率）
  questions: Question[]
  // 用户作答：题号 -> 选中选项下标
  answers: Record<number, number>
  // 是否已记录本次会话（避免重复写入）
  sessionRecorded: boolean
  // 计算已用有效时长（秒）
  getElapsedSec: () => number
  // 标记本次会话已记录
  markSessionRecorded: () => void
  // 阅读会话记录失败时的回调（用于向用户展示错误提示）
  onRecordError?: (message: string) => void
}

export interface UseSessionRecorderResult {
  // 本次新解锁的成就列表（用于触发 Toast 显示）
  unlockedAchievements: Achievement[]
  // 清空已展示的成就列表
  clearUnlockedAchievements: () => void
}

export function useSessionRecorder({
  view,
  article,
  questions,
  answers,
  sessionRecorded,
  getElapsedSec,
  markSessionRecorded,
  onRecordError,
}: UseSessionRecorderParams): UseSessionRecorderResult {
  const { t } = useTranslation()
  const [unlockedAchievements, setUnlockedAchievements] = useState<Achievement[]>([])

  // 提交答题后记录阅读会话
  useEffect(() => {
    if (view !== 'result' || !article || sessionRecorded) return
    // 防止组件卸载后对已卸载组件调用 setState
    let cancelled = false
    const correctCount = questions.filter(
      (q, idx) => answers[idx] === q.correctIndex,
    ).length
    const totalCount = questions.length
    const correctRate = totalCount > 0 ? correctCount / totalCount : 0
    const durationSec = getElapsedSec()
    void statsService
      .recordReadingSession(article.id, durationSec, article.wordCount, correctRate)
      .then(async () => {
        // 成就检查：在阅读会话记录写入后触发，失败不影响主流程
        try {
          const ctx = await statsService.buildAchievementContext()
          const newlyUnlocked = await checkAndUnlockAchievements(ctx, t)
          if (!cancelled && newlyUnlocked.length > 0) {
            setUnlockedAchievements(newlyUnlocked)
          }
        } catch (err) {
          logger.error('[Achievement]', err)
        }
      })
      .catch((err) => {
        logger.warn('[ReadingPage] 记录阅读会话失败', err)
        onRecordError?.(t('reading.session.record_failed'))
      })
      .finally(() => {
        // 标记已记录：store 状态，卸载后仍需标记避免重复写入
        markSessionRecorded()
      })
    return () => {
      cancelled = true
    }
  }, [view, article, questions, answers, sessionRecorded, getElapsedSec, markSessionRecorded, onRecordError, t])

  const clearUnlockedAchievements = () => setUnlockedAchievements([])

  return {
    unlockedAchievements,
    clearUnlockedAchievements,
  }
}
