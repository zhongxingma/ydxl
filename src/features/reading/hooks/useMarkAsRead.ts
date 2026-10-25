// 阅读完成处理：保存已读状态、按需生成练习题、后台生成语法填空
//
// 从 useQuizRunner 抽离，避免答题交互与 AI 生成流程混杂在同一 hook。
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback } from 'react'
import type { Article, Question } from '@/shared/types'
import type { QuizGenStage } from '../types'
import { articleService } from '../services/articleService'
import { questionService } from '../services/questionService'

interface UseMarkAsReadOptions {
  article: Article | null
  isArticleRead: boolean
  questions: Question[]
  grammarQuestions: Question[]
  setArticle: Dispatch<SetStateAction<Article | null>>
  setQuestions: Dispatch<SetStateAction<Question[]>>
  setGrammarQuestions: Dispatch<SetStateAction<Question[]>>
  setGrammarGenError: Dispatch<SetStateAction<string | null>>
  setToast: Dispatch<SetStateAction<string | null>>
  setView: (view: 'quiz') => void
  setQuizGenStage: Dispatch<SetStateAction<QuizGenStage>>
  setGeneratingQuestions: Dispatch<SetStateAction<boolean>>
  mountedRef: MutableRefObject<boolean>
  abortControllerRef: MutableRefObject<AbortController | null>
}

// 格式化 AI/服务错误为用户可读消息
function formatGenError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function useMarkAsRead({
  article,
  isArticleRead,
  questions,
  grammarQuestions,
  setArticle,
  setQuestions,
  setGrammarQuestions,
  setGrammarGenError,
  setToast,
  setView,
  setQuizGenStage,
  setGeneratingQuestions,
  mountedRef,
  abortControllerRef,
}: UseMarkAsReadOptions) {
  // 阅读完成：标记当前文章为已读
  // - 题目已加载（questions.length > 0）时自动切换到 quiz 视图并滚动到顶部
  // - 无题目时按需生成初中阶段阅读理解练习（主旨/细节/推断/词义猜测题型），
  //   生成成功后进入答题视图；生成失败时提示用户可手动重试
  // - 已读文章再次调用时跳过 markAsRead，仅按需生成练习题（供"生成练习题"按钮使用）
  const handleMarkAsRead = useCallback(async () => {
    if (!article) return

    // 已读文章不重复标记，仅生成练习题
    if (!isArticleRead) {
      try {
        const saved = await articleService.markAsRead(article.id)
        if (!saved) {
          setToast('阅读记录保存失败，请稍后重试')
          return
        }
        // 更新本地 article 状态，触发按钮变为已完成
        setArticle({ ...article, readAt: Date.now() })
      } catch (err) {
        console.warn('[ReadingPage] markAsRead 失败', err)
        setToast('阅读记录保存失败，请稍后重试')
        return
      }
    }

    if (questions.length > 0) {
      // 题目已加载：直接进入答题
      setView('quiz')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      if (!isArticleRead) setToast('阅读已记录 ✓ 进入答题')
      // 语法填空题未加载时后台生成（不阻塞进入答题）
      if (grammarQuestions.length === 0) {
        void questionService
          .getGrammarFillQuestionsForArticle(article)
          .then((gqs) => {
            if (mountedRef.current && gqs.length > 0) {
              setGrammarQuestions(gqs)
            }
          })
          .catch((err) => {
            if (err instanceof Error && err.name !== 'AbortError') {
              console.warn('[ReadingPage] 后台生成语法填空题失败', err)
              if (mountedRef.current) {
                setGrammarGenError(formatGenError(err, '语法填空题生成失败'))
              }
            }
          })
      }
    } else {
      // 无题目：按需生成初中阶段阅读理解练习
      setGeneratingQuestions(true)
      setQuizGenStage('generating')
      setToast('正在生成练习题...')
      // Phase 3：创建 AbortController 支持中断
      // 组件卸载时 useEffect cleanup 会调用 abortControllerRef.current?.abort()
      // 重新发起请求前取消上一次请求（理论上不会并发，但防御性处理）
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      // onChunk 回调：检测重试/降级事件（callChatStream / generateQuestions 透传）
      // 空信号（delta==='' && fullText===''）表示流式失败后的重试或降级重置：
      // - 第 1 次空信号：retryWithBackoff 触发的重试（callChatStream 内部最多重试 2 次）
      // - 第 2 次空信号：流式彻底失败后降级到非流式（generateQuestions/generateArticle 触发）
      let resetCount = 0
      try {
        const generated = await questionService.getQuestionsForArticle(article, {
          signal: controller.signal,
          onChunk: (delta, fullText) => {
            // 空信号（delta==='' && fullText===''）表示重试或降级重置
            if (delta === '' && fullText === '') {
              resetCount++
              if (resetCount === 1) {
                setQuizGenStage('retrying')
                setToast('正在重试...')
              } else {
                setQuizGenStage('fallback')
                setToast('正在使用备选方案...')
              }
            }
          },
        })
        // 组件已卸载则丢弃结果
        if (!mountedRef.current) return
        // 请求被中断则丢弃结果（用户切换页面或重新发起请求）
        if (controller.signal.aborted) return
        if (generated.length > 0) {
          setQuestions(generated)
          setView('quiz')
          window.scrollTo({ top: 0, behavior: 'smooth' })
          setToast('练习题已生成 ✓ 进入答题')
          setQuizGenStage('idle')
          // 语法填空题后台生成（不阻塞答题，完成后自动更新 grammarQuestions 状态）
          if (grammarQuestions.length === 0) {
            void questionService
              .getGrammarFillQuestionsForArticle(article, { signal: controller.signal })
              .then((gqs) => {
                if (mountedRef.current && !controller.signal.aborted && gqs.length > 0) {
                  setGrammarQuestions(gqs)
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name !== 'AbortError') {
                  console.warn('[ReadingPage] 后台生成语法填空题失败', err)
                  if (mountedRef.current) {
                    setGrammarGenError(formatGenError(err, '语法填空题生成失败'))
                  }
                }
              })
          }
        } else {
          // 理论不可达：getQuestionsForArticle 失败时抛错，成功时返回非空数组
          setToast('练习题生成失败，请稍后重试')
          setQuizGenStage('error')
        }
      } catch (genErr) {
        // 中断错误静默处理（用户已离开页面或重新发起请求）
        if (genErr instanceof Error && genErr.name === 'AbortError') {
          if (import.meta.env.DEV)
            console.debug('[ReadingPage] 练习题生成被中断（用户离开或重新发起）')
          setQuizGenStage('idle')
          return
        }
        console.warn('[ReadingPage] 练习题生成失败', genErr)
        if (!mountedRef.current) return
        // 透传真实错误原因（如"AI 服务未配置"、"余额不足"等），便于用户排查
        const reason = genErr instanceof Error ? genErr.message : ''
        setToast(reason ? `练习题生成失败：${reason}` : '练习题生成失败，请稍后重试')
        setQuizGenStage('error')
      } finally {
        if (mountedRef.current) setGeneratingQuestions(false)
      }
    }
  }, [
    article,
    isArticleRead,
    questions.length,
    grammarQuestions.length,
    setArticle,
    setQuestions,
    setGrammarQuestions,
    setGrammarGenError,
    setToast,
    setView,
    setQuizGenStage,
    setGeneratingQuestions,
    mountedRef,
    abortControllerRef,
  ])

  return { handleMarkAsRead }
}
