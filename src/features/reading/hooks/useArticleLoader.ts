// 文章加载与题目/词汇并行获取
//
// 统一管理：今日文章生成、历史文章加载、题目/语法填空/词汇并行结果、
// 加载阶段与错误状态、读取状态重置、历史文章短语补全。
// 竞态保护：调用方传入 loadTokenRef 与 mountedRef，过期结果直接丢弃。
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { Article, Difficulty, Question, Topic } from '@/shared/types'
import type { VocabularyItem, QuizGenStage } from '../types'
import { articleService, ArticleNotFoundError } from '../services/articleService'
import { questionService } from '../services/questionService'
import { vocabularyService } from '../services/vocabularyService'

export type LoadStatus = 'loading' | 'success' | 'error'

// 文章加载阶段（用于加载骨架屏的阶段进度文案）
export type LoadStage = 'checking' | 'generating' | 'loading'

interface UseArticleLoaderOptions {
  articleId: string | null
  mountedRef: MutableRefObject<boolean>
  loadTokenRef: MutableRefObject<number>
  markedReadRef: MutableRefObject<string | null>
  selectedDifficultyRef: MutableRefObject<Difficulty | undefined>
  selectedTopicRef: MutableRefObject<Topic | undefined>
  resetStore: () => void
  startTimer: () => void
  setQuizGenStage: Dispatch<SetStateAction<QuizGenStage>>
}

export interface UseArticleLoaderResult {
  article: Article | null
  setArticle: Dispatch<SetStateAction<Article | null>>
  questions: Question[]
  setQuestions: Dispatch<SetStateAction<Question[]>>
  grammarQuestions: Question[]
  setGrammarQuestions: Dispatch<SetStateAction<Question[]>>
  vocabularies: VocabularyItem[]
  setVocabularies: Dispatch<SetStateAction<VocabularyItem[]>>
  grammarAnswers: Record<number, number>
  setGrammarAnswers: Dispatch<SetStateAction<Record<number, number>>>
  currentGrammarIdx: number
  setCurrentGrammarIdx: Dispatch<SetStateAction<number>>
  status: LoadStatus
  loadStage: LoadStage
  errorMsg: string
  grammarGenError: string | null
  setGrammarGenError: Dispatch<SetStateAction<string | null>>
  vocabGenError: string | null
  setVocabGenError: Dispatch<SetStateAction<string | null>>
  phrasesLoading: boolean
  loadToday: (difficulty?: Difficulty, topic?: Topic) => Promise<void>
  loadArticleById: (id: string) => Promise<void>
  reload: () => void
}

function formatGenError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function useArticleLoader({
  articleId,
  mountedRef,
  loadTokenRef,
  markedReadRef,
  selectedDifficultyRef,
  selectedTopicRef,
  resetStore,
  startTimer,
  setQuizGenStage,
}: UseArticleLoaderOptions): UseArticleLoaderResult {
  const [article, setArticle] = useState<Article | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [grammarQuestions, setGrammarQuestions] = useState<Question[]>([])
  const [grammarAnswers, setGrammarAnswers] = useState<Record<number, number>>({})
  const [currentGrammarIdx, setCurrentGrammarIdx] = useState(0)
  const [vocabularies, setVocabularies] = useState<VocabularyItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadStage, setLoadStage] = useState<LoadStage>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [grammarGenError, setGrammarGenError] = useState<string | null>(null)
  const [vocabGenError, setVocabGenError] = useState<string | null>(null)
  const [phrasesLoading, setPhrasesLoading] = useState(false)

  // 应用并行生成结果（loadToday / loadArticleById 共用）：
  // - rejected 或空数组（vocabularyService 失败返回 [] 而非抛错，文章必有重点词汇，空即失败）
  //   记录错误消息，由 UI 展示提示条与重试入口，不再静默降级无声消失
  const applyParallelResults = useCallback(
    (
      questionsResult: PromiseSettledResult<Question[]>,
      grammarResult: PromiseSettledResult<Question[]>,
      vocabsResult: PromiseSettledResult<VocabularyItem[]>,
    ) => {
      const qs = questionsResult.status === 'fulfilled' ? questionsResult.value : []
      if (questionsResult.status === 'rejected') {
        console.warn('[ReadingPage] 题目加载失败', questionsResult.reason)
      }
      const gqs = grammarResult.status === 'fulfilled' ? grammarResult.value : []
      if (grammarResult.status === 'rejected') {
        console.warn('[ReadingPage] 语法填空题加载失败', grammarResult.reason)
        setGrammarGenError(formatGenError(grammarResult.reason, '语法填空题生成失败'))
      } else {
        setGrammarGenError(null)
      }
      const vocabs = vocabsResult.status === 'fulfilled' ? vocabsResult.value : []
      if (vocabsResult.status === 'rejected') {
        console.warn('[ReadingPage] 词汇加载失败', vocabsResult.reason)
        setVocabGenError(formatGenError(vocabsResult.reason, '词汇提取失败'))
      } else if (vocabs.length === 0) {
        // 空 = AI 提取失败（失败不写缓存，成功结果非空）
        setVocabGenError('词汇提取失败，请稍后重试')
      } else {
        setVocabGenError(null)
      }
      setQuestions(qs)
      setGrammarQuestions(gqs)
      setGrammarAnswers({})
      setCurrentGrammarIdx(0)
      setVocabularies(vocabs)
    },
    [],
  )

  // 加载今日文章与题目
  // difficulty / topic 由选择弹窗传入，控制 AI 生成文章的难易等级与题材
  const loadToday = useCallback(
    async (difficulty?: Difficulty, topic?: Topic) => {
      setStatus('loading')
      setLoadStage('checking')
      setErrorMsg('')
      // 清空旧文章状态：避免历史文章模式下显示上一篇（竞态保护）
      setArticle(null)
      // 重置练习题生成阶段：避免上一篇的 error 状态残留到新文章
      setQuizGenStage('idle')
      resetStore()
      // 加载令牌：每次开始自增并捕获，用于丢弃过期加载结果
      const token = ++loadTokenRef.current

      // today YYYY-MM-DD
      const today = new Date().toISOString().slice(0, 10)

      try {
        // 查询今日已读文章数，若 > 0 则强制生成新文章（避免返回已读文章）
        let forceNew = false
        try {
          const todayReadCount = await articleService.getTodayReadCount()
          forceNew = todayReadCount > 0
        } catch (err) {
          // 查询失败时降级为 false（best-effort，不阻塞阅读）
          console.warn('[ReadingPage] getTodayReadCount 查询失败，降级为非 forceNew', err)
        }
        setLoadStage('generating')
        const art = await articleService.getDailyArticle(today, { forceNew, difficulty, topic })
        // 加载令牌过期（期间又触发了新加载）则丢弃此次结果
        if (token !== loadTokenRef.current) return
        // 组件已卸载则放弃更新，避免对已卸载组件写入 state
        if (!mountedRef.current) return
        setArticle(art)
        setStatus('success')

        // 记录开始阅读时间戳（best-effort，不阻塞主流程）
        void articleService.recordReadingStart(art.id)

        // 启动计时器
        startTimer()

        // 并行：题目 + 语法填空题 + 词汇（使用 allSettled 隔离错误，单个失败不阻塞另一个）
        const [qsResult, grammarResult, vocabsResult] = await Promise.allSettled([
          questionService.getQuestionsForArticle(art),
          questionService.getGrammarFillQuestionsForArticle(art),
          vocabularyService.extractAndCacheVocabulary(art),
        ])
        // 加载令牌过期则丢弃此次结果
        if (token !== loadTokenRef.current) return
        // 组件已卸载则放弃更新
        if (!mountedRef.current) return
        applyParallelResults(qsResult, grammarResult, vocabsResult)
      } catch (err) {
        console.error('[ReadingPage] 加载失败', err)
        // 组件已卸载则放弃更新
        if (!mountedRef.current) return
        setErrorMsg(err instanceof Error ? err.message : '加载失败，请重试')
        setStatus('error')
      }
    },
    [applyParallelResults, loadTokenRef, mountedRef, resetStore, setQuizGenStage, startTimer],
  )

  // 加载历史文章（通过 articleId 查询参数指定）
  // 与 loadToday 的区别：
  // - 调用 articleService.getArticleById 而非 getDailyArticle，不生成新文章
  // - ArticleNotFoundError 时展示「文章不存在或已被删除」友好提示
  // - 已读文章（readAt 已存在）不重复标记为已读：将 article.id 写入 markedReadRef，
  //   使 result 视图 effect 跳过 markAsRead 调用
  const loadArticleById = useCallback(
    async (id: string) => {
      setStatus('loading')
      setLoadStage('loading')
      setErrorMsg('')
      // 清空旧文章状态：避免历史文章切换时短暂显示上一篇（竞态保护）
      setArticle(null)
      // 重置练习题生成阶段：避免上一篇的 error 状态残留到当前文章
      setQuizGenStage('idle')
      resetStore()
      // 加载令牌：每次开始自增并捕获，用于丢弃过期加载结果
      const token = ++loadTokenRef.current

      try {
        const art = await articleService.getArticleById(id)
        // 加载令牌过期（期间又触发了新加载）则丢弃此次结果
        if (token !== loadTokenRef.current) return
        // 组件已卸载则放弃更新，避免对已卸载组件写入 state
        if (!mountedRef.current) return
        setArticle(art)
        setStatus('success')
        // 已读文章不重复标记：readAt 已存在时记录到 markedReadRef，
        // 避免 result 视图 effect 再次调用 markAsRead
        if (art.readAt != null) {
          markedReadRef.current = art.id
        }

        // 记录开始阅读时间戳（best-effort，不阻塞主流程）
        void articleService.recordReadingStart(art.id)

        // 启动计时器
        startTimer()

        // 并行：题目 + 语法填空题 + 词汇（使用 allSettled 隔离错误，单个失败不阻塞另一个）
        const [qsResult, grammarResult, vocabsResult] = await Promise.allSettled([
          questionService.getQuestionsForArticle(art),
          questionService.getGrammarFillQuestionsForArticle(art),
          vocabularyService.extractAndCacheVocabulary(art),
        ])
        // 加载令牌过期则丢弃此次结果
        if (token !== loadTokenRef.current) return
        // 组件已卸载则放弃更新
        if (!mountedRef.current) return
        applyParallelResults(qsResult, grammarResult, vocabsResult)
      } catch (err) {
        console.error('[ReadingPage] 加载历史文章失败', err)
        // 组件已卸载则放弃更新
        if (!mountedRef.current) return
        // ArticleNotFoundError：文章不存在或已被删除；其他错误：加载失败通用提示
        if (err instanceof ArticleNotFoundError) {
          setErrorMsg('文章不存在或已被删除')
        } else {
          setErrorMsg(err instanceof Error ? err.message : '加载失败，请稍后重试')
        }
        setStatus('error')
      }
    },
    [applyParallelResults, loadTokenRef, markedReadRef, mountedRef, resetStore, setQuizGenStage, startTimer],
  )

  // 重新加载：历史文章模式重载对应 articleId，今日模式使用已选题材与难度重新加载
  const reload = useCallback(() => {
    if (articleId) {
      void loadArticleById(articleId)
    } else {
      void loadToday(selectedDifficultyRef.current, selectedTopicRef.current)
    }
  }, [articleId, loadArticleById, loadToday, selectedDifficultyRef, selectedTopicRef])

  // 历史文章短语补全：文章加载后若缺失 phrases，自动调用 AI 提取
  // 新文章已有 phrases（articlePrompt 生成），历史文章需补全
  // 仅依赖 article.id，避免 article 对象变化触发重复执行
  useEffect(() => {
    if (!article?.id) return
    // 已有短语则跳过
    if (article.phrases && article.phrases.length > 0) return

    let cancelled = false
    setPhrasesLoading(true)

    void articleService
      .ensureArticlePhrases(article)
      .then((phrases) => {
        if (cancelled || phrases.length === 0) return
        // 更新 article state 以触发短语区块渲染
        setArticle((prev) => (prev ? { ...prev, phrases } : prev))
      })
      .catch((err) => {
        if (!cancelled) console.warn('[ReadingPage] 短语补全失败', err)
      })
      .finally(() => {
        if (!cancelled) setPhrasesLoading(false)
      })

    return () => {
      cancelled = true
    }
    // 仅依赖 article.id：避免 article 对象变化（如 setArticle 写回短语）触发重复执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id])

  return {
    article,
    setArticle,
    questions,
    setQuestions,
    grammarQuestions,
    setGrammarQuestions,
    vocabularies,
    setVocabularies,
    grammarAnswers,
    setGrammarAnswers,
    currentGrammarIdx,
    setCurrentGrammarIdx,
    status,
    loadStage,
    errorMsg,
    grammarGenError,
    setGrammarGenError,
    vocabGenError,
    setVocabGenError,
    phrasesLoading,
    loadToday,
    loadArticleById,
    reload,
  }
}
