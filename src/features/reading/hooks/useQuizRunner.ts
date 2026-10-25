// 答题流程统一入口：阅读理解/语法填空作答与切换、阅读完成标记、内容补充生成
//
// 生成相关逻辑拆分至 useContentGeneration，阅读完成处理拆分至 useMarkAsRead；
// 本 hook 负责答题导航与对外聚合，保持页面调用方式不变。
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { useCallback } from 'react'
import type { Article, Question } from '@/shared/types'
import type { QuizGenStage, TranslationMode, VocabularyItem } from '../types'
import { useReadingStore } from '../store'
import { useContentGeneration } from './useContentGeneration'
import { useMarkAsRead } from './useMarkAsRead'

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

  // 文章是否已读（readAt 不为空表示已读）
  const isArticleRead = article?.readAt != null

  // 语法填空 / 词汇生成与重试
  const {
    retryingGrammar,
    retryingVocab,
    grammarInterstitial,
    setGrammarInterstitial,
    generatingGrammar,
    handleRetryGrammar,
    handleGenerateGrammar,
    handleRetryVocab,
  } = useContentGeneration({
    article,
    setGrammarQuestions,
    setVocabularies,
    setGrammarGenError,
    setVocabGenError,
    setGrammarAnswers,
    setCurrentGrammarIdx,
    setView,
    mountedRef,
  })

  // 阅读完成：已读保存 + 练习题按需生成
  const { handleMarkAsRead } = useMarkAsRead({
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
  })

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
  }, [
    currentQuestionIndex,
    questions.length,
    grammarQuestions.length,
    nextQuestion,
    setView,
    setGrammarInterstitial,
  ])

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

  // 用户放弃语法填空：直接查看成绩单
  const handleSkipGrammar = useCallback(() => {
    setGrammarInterstitial(false)
    setView('result')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setGrammarInterstitial, setView])

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
