// 答题流程与练习生成
//
// 统一管理：阅读理解/语法填空作答与切换、阅读完成标记、练习题按需生成
// （含流式重试/降级状态）、语法填空交互式生成、词汇/语法重试、下一篇入口。
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import type { Article, Question } from '@/shared/types'
import type { QuizGenStage, TranslationMode, VocabularyItem } from '../types'
import { useReadingStore } from '../store'
import { articleService } from '../services/articleService'
import { questionService } from '../services/questionService'
import { vocabularyService } from '../services/vocabularyService'

interface UseQuizRunnerOptions {
  article: Article | null
  setArticle: Dispatch<SetStateAction<Article | null>>
  questions: Question[]
  setQuestions: Dispatch<SetStateAction<Question[]>>
  grammarQuestions: Question[]
  setGrammarQuestions: Dispatch<SetStateAction<Question[]>>
  setVocabularies: Dispatch<SetStateAction<VocabularyItem[]>>
  setGrammarAnswers: Dispatch<SetStateAction<Record<number, number>>>
  currentGrammarIdx: number
  setCurrentGrammarIdx: Dispatch<SetStateAction<number>>
  setGrammarGenError: Dispatch<SetStateAction<string | null>>
  setVocabGenError: Dispatch<SetStateAction<string | null>>
  setToast: Dispatch<SetStateAction<string | null>>
  setScrollTarget: Dispatch<SetStateAction<string | undefined>>
  setTranslationMode: Dispatch<SetStateAction<TranslationMode>>
  setShowDifficultyModal: Dispatch<SetStateAction<boolean>>
  speech: { stop: () => void }
  vocabListRef: RefObject<HTMLElement>
  mountedRef: MutableRefObject<boolean>
  abortControllerRef: MutableRefObject<AbortController | null>
  quizGenStage: QuizGenStage
  setQuizGenStage: Dispatch<SetStateAction<QuizGenStage>>
  generatingQuestions: boolean
  setGeneratingQuestions: Dispatch<SetStateAction<boolean>>
}

export function useQuizRunner({
  article,
  setArticle,
  questions,
  setQuestions,
  grammarQuestions,
  setGrammarQuestions,
  setVocabularies,
  setGrammarAnswers,
  currentGrammarIdx,
  setCurrentGrammarIdx,
  setGrammarGenError,
  setVocabGenError,
  setToast,
  setScrollTarget,
  setTranslationMode,
  setShowDifficultyModal,
  speech,
  vocabListRef,
  mountedRef,
  abortControllerRef,
  quizGenStage,
  setQuizGenStage,
  generatingQuestions,
  setGeneratingQuestions,
}: UseQuizRunnerOptions) {
  const currentQuestionIndex = useReadingStore((s) => s.currentQuestionIndex)
  const setView = useReadingStore((s) => s.setView)
  const setAnswer = useReadingStore((s) => s.setAnswer)
  const nextQuestion = useReadingStore((s) => s.nextQuestion)
  const resetStore = useReadingStore((s) => s.reset)

  // 是否正在生成练习题（阅读完成但无题目时按需生成）与生成阶段由页面持有，
  // 便于打印流程与文章加载复用（见 options）

  // 重试进行中状态（按钮显示加载动画，防止重复点击）
  const [retryingGrammar, setRetryingGrammar] = useState(false)
  const [retryingVocab, setRetryingVocab] = useState(false)
  // 语法填空交互式生成选择页：阅读理解最后一题答完但语法填空未就绪时展示，供用户主动选择
  const [grammarInterstitial, setGrammarInterstitial] = useState(false)
  const [generatingGrammar, setGeneratingGrammar] = useState(false)

  // 文章是否已读（readAt 不为空表示已读）
  const isArticleRead = article?.readAt != null

  // 格式化 AI/服务错误为用户可读消息（供语法填空/词汇失败提示条展示）
  const formatGenError = (err: unknown, fallback: string): string => {
    return err instanceof Error && err.message ? err.message : fallback
  }

  // 处理答题变化
  const handleAnswer = useCallback(
    (questionIdx: number, optionIndex: number) => {
      setAnswer(questionIdx, optionIndex)
    },
    [setAnswer],
  )

  // 下一题或查看成绩（阅读理解最后一题时：有语法填空题则进入 grammar_quiz，否则进入 result）
  const handleNext = useCallback(() => {
    const isLast = currentQuestionIndex >= questions.length - 1
    if (isLast) {
      if (grammarQuestions.length > 0) {
        setView('grammar_quiz')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        // 语法填空未就绪：不再静默跳过，弹出交互式选择页供用户自行决定
        // （修复「语法填空有时自动不生成导致分区无声消失」的体验问题）
        setGrammarInterstitial(true)
        setView('result')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } else {
      nextQuestion(questions.length)
    }
  }, [currentQuestionIndex, questions.length, grammarQuestions.length, nextQuestion, setView])

  // 重新答题（重置阅读理解 + 语法填空全部作答状态）
  const handleRetry = useCallback(() => {
    resetStore()
    setGrammarAnswers({})
    setCurrentGrammarIdx(0)
    setView('quiz')
  }, [resetStore, setGrammarAnswers, setCurrentGrammarIdx, setView])

  // 语法填空：选择某题的某选项
  const handleGrammarAnswer = useCallback(
    (questionIdx: number, optionIndex: number) => {
      setGrammarAnswers((prev) => ({ ...prev, [questionIdx]: optionIndex }))
    },
    [setGrammarAnswers],
  )

  // 语法填空：下一题或查看成绩
  const handleGrammarNext = useCallback(() => {
    const isLast = currentGrammarIdx >= grammarQuestions.length - 1
    if (isLast) {
      setView('result')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      setCurrentGrammarIdx((prev) => prev + 1)
    }
  }, [currentGrammarIdx, grammarQuestions.length, setCurrentGrammarIdx, setView])

  // 切换到答题视图
  const handleStartQuiz = useCallback(() => {
    setView('quiz')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setView])

  // 切换到阅读视图
  const handleBackToReading = useCallback(() => {
    setView('reading')
  }, [setView])

  // 跳转回原文对应位置（从答题反馈触发）
  const handleLocateInArticle = useCallback(
    (locationClue: string) => {
      setScrollTarget(locationClue)
      setView('reading')
      // 5 秒后清除跳转目标，避免下次进入仍触发滚动
      window.setTimeout(() => setScrollTarget(undefined), 5000)
    },
    [setScrollTarget, setView],
  )

  // 查看全文翻译：切回 reading 视图并切到逐句切换模式
  const handleViewTranslation = useCallback(() => {
    speech.stop()
    setTranslationMode('toggle')
    setView('reading')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setTranslationMode, setView, speech])

  // 学习本文生词：切回 reading 视图并滚动到词汇区
  const handleStudyVocabulary = useCallback(() => {
    setView('reading')
    window.setTimeout(() => {
      vocabListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [setView, vocabListRef])

  // 重试生成语法填空题：清错后重新调用（本地已有语法题时直接返回，不消耗 AI）
  const handleRetryGrammar = useCallback(async () => {
    if (!article || retryingGrammar) return
    setRetryingGrammar(true)
    setGrammarGenError(null)
    try {
      const gqs = await questionService.getGrammarFillQuestionsForArticle(article)
      if (!mountedRef.current) return
      if (gqs.length > 0) {
        setGrammarQuestions(gqs)
      } else {
        setGrammarGenError('语法填空题生成失败，请稍后重试')
      }
    } catch (err) {
      if (!mountedRef.current) return
      if (err instanceof Error && err.name === 'AbortError') return
      console.warn('[ReadingPage] 重试生成语法填空题失败', err)
      setGrammarGenError(formatGenError(err, '语法填空题生成失败'))
    } finally {
      if (mountedRef.current) setRetryingGrammar(false)
    }
  }, [article, retryingGrammar, setGrammarGenError, setGrammarQuestions, mountedRef])

  // 交互式生成语法填空：从选择页触发，生成中显示加载态，成功后直接进入语法填空答题
  // （覆盖所有语法填空生成入口，复用 questionService 缓存逻辑：本地已有时零 AI 消耗）
  const handleGenerateGrammar = useCallback(async () => {
    if (!article || generatingGrammar) return
    setGeneratingGrammar(true)
    setGrammarGenError(null)
    try {
      const gqs = await questionService.getGrammarFillQuestionsForArticle(article)
      if (!mountedRef.current) return
      if (gqs.length > 0) {
        setGrammarQuestions(gqs)
        // 生成成功：关闭选择页，直接进入语法填空答题
        setGrammarInterstitial(false)
        setCurrentGrammarIdx(0)
        setGrammarAnswers({})
        setView('grammar_quiz')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setGrammarGenError('语法填空题生成失败，请稍后重试')
      }
    } catch (err) {
      if (!mountedRef.current) return
      if (err instanceof Error && err.name === 'AbortError') return
      console.warn('[ReadingPage] 交互式生成语法填空题失败', err)
      setGrammarGenError(formatGenError(err, '语法填空题生成失败'))
    } finally {
      if (mountedRef.current) setGeneratingGrammar(false)
    }
  }, [
    article,
    generatingGrammar,
    setGrammarGenError,
    setGrammarQuestions,
    setCurrentGrammarIdx,
    setGrammarAnswers,
    setView,
    mountedRef,
  ])

  // 用户放弃语法填空：直接查看成绩单
  const handleSkipGrammar = useCallback(() => {
    setGrammarInterstitial(false)
    setView('result')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setView])

  // 重试提取重点词汇：失败不写缓存，重试会重新调用 AI
  const handleRetryVocab = useCallback(async () => {
    if (!article || retryingVocab) return
    setRetryingVocab(true)
    setVocabGenError(null)
    try {
      const vocabs = await vocabularyService.extractAndCacheVocabulary(article)
      if (!mountedRef.current) return
      if (vocabs.length > 0) {
        setVocabularies(vocabs)
      } else {
        setVocabGenError('词汇提取失败，请稍后重试')
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.warn('[ReadingPage] 重试提取词汇失败', err)
      setVocabGenError(formatGenError(err, '词汇提取失败'))
    } finally {
      if (mountedRef.current) setRetryingVocab(false)
    }
  }, [article, retryingVocab, setVocabGenError, setVocabularies, mountedRef])

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

  // 阅读下一篇：弹出难度选择弹窗，用户选择难度后生成新文章
  const loadNextArticle = useCallback(() => {
    // 停止正在进行的朗读
    speech.stop()
    setShowDifficultyModal(true)
  }, [setShowDifficultyModal, speech])

  return {
    quizGenStage,
    setQuizGenStage,
    generatingQuestions,
    retryingGrammar,
    retryingVocab,
    grammarInterstitial,
    generatingGrammar,
    isArticleRead,
    handleAnswer,
    handleNext,
    handleRetry,
    handleGrammarAnswer,
    handleGrammarNext,
    handleStartQuiz,
    handleBackToReading,
    handleLocateInArticle,
    handleViewTranslation,
    handleStudyVocabulary,
    handleRetryGrammar,
    handleGenerateGrammar,
    handleSkipGrammar,
    handleRetryVocab,
    handleMarkAsRead,
    loadNextArticle,
  }
}
