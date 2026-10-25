// 阅读页内容补充生成：语法填空生成/重试、词汇重试
//
// 从 useQuizRunner 抽离，仅负责 AI 生成相关的状态与流程；
// 答题交互与阅读完成标记见 useQuizRunner / useMarkAsRead。
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import type { Article, Question } from '@/shared/types'
import type { VocabularyItem } from '../types'
import { questionService } from '../services/questionService'
import { vocabularyService } from '../services/vocabularyService'

interface UseContentGenerationOptions {
  article: Article | null
  setGrammarQuestions: Dispatch<SetStateAction<Question[]>>
  setVocabularies: Dispatch<SetStateAction<VocabularyItem[]>>
  setGrammarGenError: Dispatch<SetStateAction<string | null>>
  setVocabGenError: Dispatch<SetStateAction<string | null>>
  setGrammarAnswers: Dispatch<SetStateAction<Record<number, number>>>
  setCurrentGrammarIdx: Dispatch<SetStateAction<number>>
  setView: (view: 'grammar_quiz') => void
  mountedRef: MutableRefObject<boolean>
}

// 格式化 AI/服务错误为用户可读消息（供语法填空/词汇失败提示条展示）
function formatGenError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function useContentGeneration({
  article,
  setGrammarQuestions,
  setVocabularies,
  setGrammarGenError,
  setVocabGenError,
  setGrammarAnswers,
  setCurrentGrammarIdx,
  setView,
  mountedRef,
}: UseContentGenerationOptions) {
  // 重试进行中状态（按钮显示加载动画，防止重复点击）
  const [retryingGrammar, setRetryingGrammar] = useState(false)
  const [retryingVocab, setRetryingVocab] = useState(false)
  // 语法填空交互式生成选择页：阅读理解最后一题答完但语法填空未就绪时展示，供用户主动选择
  const [grammarInterstitial, setGrammarInterstitialState] = useState(false)
  const [generatingGrammar, setGeneratingGrammar] = useState(false)

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
        setGrammarInterstitialState(false)
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

  return {
    retryingGrammar,
    retryingVocab,
    grammarInterstitial,
    setGrammarInterstitial: setGrammarInterstitialState,
    generatingGrammar,
    handleRetryGrammar,
    handleGenerateGrammar,
    handleRetryVocab,
  }
}
