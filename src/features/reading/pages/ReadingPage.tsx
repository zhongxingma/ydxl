// 每日阅读主页面（分区式布局）
// 视图状态机：'reading' | 'quiz' | 'result'
// - reading：顶部固定栏（题材/难度/词数/预估时长） + 阅读进度条 + 计时器 + 正文 + 高亮词
// - quiz：单题切换答题区，选后立即反馈
// - result：成绩单 + 每题详解入口 + 查看翻译/学习生词按钮
//
// 计时器/进度/会话记录逻辑下沉至 hooks/：
//   - useReadingTimer：累计阅读时长
//   - useReadingProgress：阅读进度百分比 + 是否到底部
//   - useSessionRecorder：会话写入 + 成就解锁
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, useNavigate } from 'react-router-dom'
import type { Article, Difficulty, Question, Topic } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { AchievementUnlockToast } from '@/features/stats'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import type { QuizGenStage, TranslationMode, VocabularyItem } from '../types'
import { DIFFICULTY_LABEL, DIFFICULTY_STYLE, TOPIC_LABEL } from '../types'
import { articleService, ArticleNotFoundError } from '../services/articleService'
import { questionService } from '../services/questionService'
import { vocabularyService } from '../services/vocabularyService'
import ArticleView from '../components/ArticleView'
import QuestionPanel from '../components/QuestionPanel'
import AnswerFeedback from '../components/AnswerFeedback'
import PerformanceAnalysis from '../components/PerformanceAnalysis'
import TranslationToggle from '../components/TranslationToggle'
import VocabularyList from '../components/VocabularyList'
import SpeechControls from '../components/SpeechControls'
import DifficultySelectModal from '../components/DifficultySelectModal'
import PrintableWorksheet from '../components/PrintableWorksheet'
import ReadingHeader from '../components/ReadingHeader'
import ArticlePhrasesSection from '../components/ArticlePhrasesSection'
import ReadingActions from '../components/ReadingActions'
import { splitIntoParagraphs } from '../components/articleUtils'
import { useReadingStore } from '../store'
import { useReadingTimer, formatDuration } from '../hooks/useReadingTimer'
import { useReadingProgress } from '../hooks/useReadingProgress'
import { useSessionRecorder } from '../hooks/useSessionRecorder'
import { useArticleSpeech } from '../hooks/useArticleSpeech'

// 加载状态
type LoadStatus = 'loading' | 'success' | 'error'

// 文章加载阶段（用于加载骨架屏的阶段进度文案）
type LoadStage = 'checking' | 'generating' | 'loading'

// 各加载阶段对应的展示文案
const LOAD_STAGE_TEXT: Record<LoadStage, string> = {
  checking: '正在检查今日阅读记录...',
  generating: '正在生成文章（AI 创作中，请稍候）...',
  loading: '正在加载文章...',
}

// 练习题生成阶段（多阶段 UI 提示）见 ../types.ts 的 QuizGenStage

export default function ReadingPage() {
  // 解析 ?articleId=xxx 查询参数：首页历史阅读记录跳转携带，存在时进入「历史文章模式」
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const articleId = searchParams.get('articleId')
  // 是否为历史文章模式（articleId 存在即视为历史文章，区别于今日新文章）
  const isHistoryMode = articleId != null

  // 文章与题目状态
  const [article, setArticle] = useState<Article | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  // 语法填空题（独立分区，阅读理解题答完后进入）
  const [grammarQuestions, setGrammarQuestions] = useState<Question[]>([])
  const [grammarAnswers, setGrammarAnswers] = useState<Record<number, number>>({})
  const [currentGrammarIdx, setCurrentGrammarIdx] = useState(0)
  const [vocabularies, setVocabularies] = useState<VocabularyItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadStage, setLoadStage] = useState<LoadStage>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  // 翻译模式（默认纯英文，沉浸式阅读体验）
  const [translationMode, setTranslationMode] = useState<TranslationMode>('english')

  // 跳转目标：用于答题反馈跳转回原文（包含 locationClue 文本）
  const [scrollTarget, setScrollTarget] = useState<string | undefined>(undefined)

  // 阅读记录保存失败的错误提示（3 秒后自动消失）
  const [toast, setToast] = useState<string | null>(null)

  // 是否正在加载下一篇新文章
  const [loadingNext] = useState(false)
  // 是否正在生成练习题（阅读完成但无题目时按需生成）
  const [generatingQuestions, setGeneratingQuestions] = useState(false)
  // 练习题生成阶段：用于多阶段 UI 提示（生成中/重试中/降级中/失败）
  const [quizGenStage, setQuizGenStage] = useState<QuizGenStage>('idle')
  // 语法填空/词汇生成失败状态：allSettled 静默降级为空数组会导致板块无声消失，
  // 记录错误消息供 UI 展示提示条与重试入口（2026-08-29 修复「板块时有时无」）
  const [grammarGenError, setGrammarGenError] = useState<string | null>(null)
  const [vocabGenError, setVocabGenError] = useState<string | null>(null)
  // 重试进行中状态（按钮显示加载动画，防止重复点击）
  const [retryingGrammar, setRetryingGrammar] = useState(false)
  const [retryingVocab, setRetryingVocab] = useState(false)
  // 语法填空交互式生成选择页：阅读理解最后一题答完但语法填空未就绪时展示，供用户主动选择
  const [grammarInterstitial, setGrammarInterstitial] = useState(false)
  const [generatingGrammar, setGeneratingGrammar] = useState(false)
  // 历史文章短语补全中（article.phrases 缺失时调用 AI 提取，骨架屏占位）
  const [phrasesLoading, setPhrasesLoading] = useState(false)
  // 难度选择弹窗：进入每日阅读时弹出，选择后传入 loadToday 生成对应难度文章
  const [showDifficultyModal, setShowDifficultyModal] = useState(false)
  // 打印工作表：true 时通过 Portal 挂载 PrintableWorksheet 并自动唤起浏览器打印
  const [printOpen, setPrintOpen] = useState(false)
  // 打印准备中：题目懒生成（点「开始答题」时才调 AI），打印前需先补齐缺失题目
  const [preparingPrint, setPreparingPrint] = useState(false)
  // 打印结束回调（稳定引用，避免 PrintableWorksheet 内 effect 因回调变化重跑）
  const closePrint = useCallback(() => setPrintOpen(false), [])

  // 一键打印完整练习：题目未生成时先补齐再打印（生成失败降级打印无题版本）
  // 注意：不复用 handleMarkAsRead（含标记已读/切换视图副作用），此处仅生成数据不改视图
  const handlePrint = useCallback(async () => {
    if (!article || preparingPrint || generatingQuestions) return
    // 题目均已就绪（或已尝试过生成）：直接打印
    if (questions.length > 0 && grammarQuestions.length > 0) {
      setPrintOpen(true)
      return
    }
    setPreparingPrint(true)
    setToast('正在准备打印（生成练习题中，约需 1 分钟）...')
    try {
      const tasks: Promise<unknown>[] = []
      if (questions.length === 0) {
        tasks.push(
          questionService
            .getQuestionsForArticle(article)
            .then((qs) => {
              if (mountedRef.current && qs.length > 0) setQuestions(qs)
            }),
        )
      }
      if (grammarQuestions.length === 0) {
        tasks.push(
          questionService
            .getGrammarFillQuestionsForArticle(article)
            .then((gqs) => {
              if (mountedRef.current && gqs.length > 0) setGrammarQuestions(gqs)
            }),
        )
      }
      const results = await Promise.allSettled(tasks)
      // 组件已卸载则放弃提示（打印打开动作在 finally 中也受 mountedRef 保护）
      if (!mountedRef.current) return
      // 阅读理解题生成失败时提示（语法题失败静默降级，不阻塞打印）
      // questions.length 取闭包生成前的值：为 0 时 tasks[0] 必为阅读题任务
      const readingFailed = questions.length === 0 && results[0]?.status === 'rejected'
      if (readingFailed) {
        setToast('练习题生成失败，仅打印文章内容')
      }
    } catch (err) {
      console.warn('[ReadingPage] 打印前生成练习题失败，降级打印', err)
      if (mountedRef.current) setToast('练习题生成失败，仅打印文章内容')
    } finally {
      if (mountedRef.current) {
        setPreparingPrint(false)
        // 无论生成成功与否都打开打印（失败时打印原文+单词+短语+翻译版本）
        setPrintOpen(true)
      }
    }
  }, [article, preparingPrint, generatingQuestions, questions.length, grammarQuestions.length])

  // 从 Zustand store 读取视图状态与 actions
  const view = useReadingStore((s) => s.view)
  const currentQuestionIndex = useReadingStore((s) => s.currentQuestionIndex)
  const answers = useReadingStore((s) => s.answers)
  const sessionRecorded = useReadingStore((s) => s.sessionRecorded)
  const sentenceTranslationVisible = useReadingStore((s) => s.sentenceTranslationVisible)
  const setView = useReadingStore((s) => s.setView)
  const setAnswer = useReadingStore((s) => s.setAnswer)
  const nextQuestion = useReadingStore((s) => s.nextQuestion)
  const startTimer = useReadingStore((s) => s.startTimer)
  const getElapsedSec = useReadingStore((s) => s.getElapsedSec)
  const toggleSentenceTranslation = useReadingStore((s) => s.toggleSentenceTranslation)
  const resetStore = useReadingStore((s) => s.reset)
  const markSessionRecorded = useReadingStore((s) => s.markSessionRecorded)

  // 文章正文区与底部哨兵元素引用
  const articleAreaRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const vocabListRef = useRef<HTMLElement>(null)
  // 已标记为已读的文章 id，避免重复调用 markAsRead
  const markedReadRef = useRef<string | null>(null)
  // 组件挂载状态标志：防止卸载后调用 setState
  const mountedRef = useRef(true)
  // 加载令牌：每次 loadToday / loadArticleById 自增，用于丢弃过期加载结果（竞态保护）
  const loadTokenRef = useRef(0)
  // Phase 3：AI 请求中断控制器，组件卸载或重新发起请求时取消进行中的 AI 调用
  // 用于 handleMarkAsRead 生成练习题场景，避免用户切换页面后请求继续消耗 token
  const abortControllerRef = useRef<AbortController | null>(null)
  // 已选择的难度与题材（用于错误重试时保持同一选项）
  const selectedDifficultyRef = useRef<Difficulty | undefined>(undefined)
  const selectedTopicRef = useRef<Topic | undefined>(undefined)

  // ---- 缓存事件回调使用的 ref（避免 stale closure 导致历史文章覆盖问题）----
  // useCacheInvalidated 的 callback 通过 callbackRef 每次渲染更新，
  // 但 cache event 可能在两次渲染之间触发（URL 已变但 React 尚未 re-render），
  // 此时闭包中的 article/status/articleId 仍为旧值，会导致重读旧文章并 setArticle 覆盖新文章。
  // 通过 ref 始终读取最新值，彻底消除 stale closure 窗口。
  const articleIdRef = useRef(articleId)
  articleIdRef.current = articleId
  const statusRef = useRef(status)
  statusRef.current = status
  const currentArticleRef = useRef(article)
  currentArticleRef.current = article

  // 计时器：累计阅读时长（每秒刷新 + visibilitychange 暂停/恢复）
  const { elapsedSec } = useReadingTimer()

  // 阅读进度：滚动百分比 + 是否到底部
  // 传入 status === 'success' 作为 ready 标志：文章加载完成后哨兵 DOM 才挂载，
  // 此时 effect 才能建立 IntersectionObserver（详见 useReadingProgress 注释）
  const { readingProgress, reachedBottom } = useReadingProgress(
    view,
    articleAreaRef,
    bottomSentinelRef,
    status === 'success',
  )

  // 会话记录器：result 视图触发写入 + 成就检查
  const { unlockedAchievements, clearUnlockedAchievements } = useSessionRecorder({
    view,
    article,
    questions,
    answers,
    sessionRecorded,
    getElapsedSec,
    markSessionRecorded,
    onRecordError: (msg) => setToast(msg),
  })

  // 全文朗读：封装 Web Speech API 的多段排队朗读
  const speech = useArticleSpeech()

  // 格式化 AI/服务错误为用户可读消息（供语法填空/词汇失败提示条展示）
  const formatGenError = (err: unknown, fallback: string): string => {
    return err instanceof Error && err.message ? err.message : fallback
  }

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
  const loadToday = useCallback(async (difficulty?: Difficulty, topic?: Topic) => {
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
  }, [resetStore, startTimer, applyParallelResults])

  // 加载历史文章（通过 articleId 查询参数指定）
  // 与 loadToday 的区别：
  // - 调用 articleService.getArticleById 而非 getDailyArticle，不生成新文章
  // - ArticleNotFoundError 时展示「文章不存在或已被删除」友好提示
  // - 已读文章（readAt 已存在）不重复标记为已读：将 article.id 写入 markedReadRef，
  //   使下方 view === 'result' 的 effect 跳过 markAsRead 调用
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
    [resetStore, startTimer, applyParallelResults],
  )

  // 首次挂载加载：articleId 存在时加载历史文章，否则弹出难度选择弹窗
  // 新阅读模式下由用户选择难度后调用 loadToday(difficulty) 加载文章
  // 依赖 articleId：历史记录跳转 articleId 变化时重新加载对应文章
  useEffect(() => {
    mountedRef.current = true
    if (articleId) {
      void loadArticleById(articleId)
    } else {
      // 新阅读模式：弹出难度选择弹窗，用户选择后再加载文章
      setShowDifficultyModal(true)
    }
    // 组件卸载时重置 store 与挂载标志，避免下次进入仍保留旧状态
    // Phase 3：同时取消进行中的 AI 请求，避免卸载后继续消耗 token
    return () => {
      mountedRef.current = false
      abortControllerRef.current?.abort()
      resetStore()
    }
  }, [articleId, loadArticleById, resetStore])

  // 阅读完成（进入 result 视图）时标记文章为已读
  // 通过 ref 避免对同一篇文章重复调用 markAsRead
  useEffect(() => {
    if (view === 'result' && article && markedReadRef.current !== article.id) {
      markedReadRef.current = article.id
      void articleService.markAsRead(article.id)
    }
  }, [view, article])

  // 订阅 articles 缓存事件：articleRepository 后台刷新完成后重读当前文章
  // SWR 模式下后台刷新可能更新本地缓存（如翻译/短语补充），需重读以刷新 UI
  // 安全策略（全部通过 ref 读取最新值，避免 stale closure）：
  // - 仅在 reading 视图更新，避免干扰 quiz/result 视图状态
  // - 加载中时跳过，避免与 loadToday/loadArticleById 竞态（A→B 切换时重读 A 覆盖 B）
  // - 重读文章 id 必须与当前 article.id 一致（防止期间 article 已被切换）
  // - 重读文章 id 必须与 URL articleId 一致（URL 是源真相）
  // - 仅当 updated_at 更新时才 setArticle（避免 stale 覆盖）
  useCacheInvalidated('articles', () => {
    // 通过 ref 读取最新值，避免 cache event 在渲染间隙触发时读到旧闭包
    const currentArticle = currentArticleRef.current
    const currentStatus = statusRef.current
    const expectedArticleId = articleIdRef.current
    if (!currentArticle || view !== 'reading') return
    if (currentStatus === 'loading') return
    void (async () => {
      try {
        const fresh = await articleService.getArticleById(currentArticle.id)
        if (!mountedRef.current || !fresh) return
        // 再次通过 ref 读取最新值（await 期间状态可能已变化）
        if (fresh.id !== currentArticleRef.current?.id) return
        if (expectedArticleId && fresh.id !== expectedArticleId) return
        if (currentArticleRef.current && fresh.updated_at > currentArticleRef.current.updated_at) {
          setArticle(fresh)
        }
      } catch (err) {
        if (import.meta.env.DEV)
          console.warn('[ReadingPage] articles 事件重读失败', err)
      }
    })()
  })

  // toast 自动消失：3 秒后清除，cleanup 清除定时器避免内存泄漏
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

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
  }, [resetStore, setView])

  // 语法填空：选择某题的某选项
  const handleGrammarAnswer = useCallback(
    (questionIdx: number, optionIndex: number) => {
      setGrammarAnswers((prev) => ({ ...prev, [questionIdx]: optionIndex }))
    },
    [],
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
  }, [currentGrammarIdx, grammarQuestions.length, setView])

  // 切换到答题视图
  const handleStartQuiz = useCallback(() => {
    setView('quiz')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setView])

  // 切换到阅读视图
  const handleBackToReading = useCallback(() => {
    setView('reading')
  }, [setView])

  // 类型与难度选择确认：关闭弹窗，传入题材与难度加载文章
  const handleDifficultySelect = useCallback((difficulty: Difficulty, topic?: Topic) => {
    selectedDifficultyRef.current = difficulty
    selectedTopicRef.current = topic
    setShowDifficultyModal(false)
    void loadToday(difficulty, topic)
  }, [loadToday])

  // 难度选择取消：无文章时返回首页，有文章时仅关闭弹窗
  const handleDifficultyCancel = useCallback(() => {
    setShowDifficultyModal(false)
    if (!article) {
      navigate('/')
    }
  }, [article, navigate])

  // 跳转回原文对应位置（从答题反馈触发）
  const handleLocateInArticle = useCallback(
    (locationClue: string) => {
      setScrollTarget(locationClue)
      setView('reading')
      // 5 秒后清除跳转目标，避免下次进入仍触发滚动
      window.setTimeout(() => setScrollTarget(undefined), 5000)
    },
    [setView],
  )

  // 查看全文翻译：切回 reading 视图并切到逐句切换模式
  const handleViewTranslation = useCallback(() => {
    speech.stop()
    setTranslationMode('toggle')
    setView('reading')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setView, speech])

  // 学习本文生词：切回 reading 视图并滚动到词汇区
  const handleStudyVocabulary = useCallback(() => {
    setView('reading')
    window.setTimeout(() => {
      vocabListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [setView])

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
  }, [article, retryingGrammar])

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
  }, [article, generatingGrammar, setView])

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
  }, [article, retryingVocab])

  // 文章是否已读（readAt 不为空表示已读）
  const isArticleRead = article?.readAt != null

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
  }, [article, isArticleRead, questions.length, grammarQuestions.length, setView])

  // 阅读下一篇：弹出难度选择弹窗，用户选择难度后生成新文章
  const loadNextArticle = useCallback(() => {
    // 停止正在进行的朗读
    speech.stop()
    setShowDifficultyModal(true)
  }, [speech])

  // 重新加载：历史文章模式重载对应 articleId，今日模式使用已选题材与难度重新加载
  const handleReload = useCallback(() => {
    if (articleId) {
      void loadArticleById(articleId)
    } else {
      void loadToday(selectedDifficultyRef.current, selectedTopicRef.current)
    }
  }, [articleId, loadArticleById, loadToday])

  // 切换翻译模式：停止正在进行的朗读，避免跨模式状态残留
  const handleTranslationModeChange = useCallback(
    (mode: TranslationMode) => {
      speech.stop()
      setTranslationMode(mode)
    },
    [speech],
  )

  // 难度选择弹窗（fixed 定位，渲染在任何 return 分支中均可覆盖全屏）
  const difficultyModal = (
    <DifficultySelectModal
      open={showDifficultyModal}
      onSelect={handleDifficultySelect}
      onCancel={handleDifficultyCancel}
    />
  )

  // 加载骨架屏
  if (status === 'loading') {
    return (
      <>
        {difficultyModal}
        <div className="space-y-4">
        <div className="h-8 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="flex gap-2">
          <div className="h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-5 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          ))}
        </div>
        <div className="text-center text-sm text-gray-500 dark:text-gray-400">
          {LOAD_STAGE_TEXT[loadStage]}
        </div>
        </div>
      </>
    )
  }

  // 错误状态
  if (status === 'error' || !article) {
    return (
      <>
        {difficultyModal}
        <div className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {errorMsg || '加载失败，请稍后重试'}
        </p>
        <button
          type="button"
          onClick={handleReload}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          重新加载
        </button>
        </div>
      </>
    )
  }

  // 防御性校验：文章核心字段缺失时显示错误 UI，避免渲染时 splitIntoParagraphs(undefined) 抛错
  // 此前"页面渲染异常"崩溃的根因：本地缓存或服务器返回的文章缺少 content/translation 字段
  if (!article.content || typeof article.content !== 'string') {
    console.error('[ReadingPage] 文章数据不完整：缺少 content 字段', article.id)
    return (
      <>
        {difficultyModal}
        <div className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          文章数据不完整，请刷新或返回首页重试
        </p>
        <button
          type="button"
          onClick={handleReload}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          重新加载
        </button>
        </div>
      </>
    )
  }

  // 题材与难度标签信息
  const topicLabel = article.topic ? TOPIC_LABEL[article.topic] ?? article.topic : null
  const difficultyLabel = article.difficulty ? DIFFICULTY_LABEL[article.difficulty] : null
  const difficultyStyle = article.difficulty ? DIFFICULTY_STYLE[article.difficulty] : ''
  // 预计阅读时间：按 200 词/分钟估算，向上取整
  const estimatedMinutes = Math.max(1, Math.ceil(article.wordCount / 200))

  // 文章英文段落数组：供全文朗读与段落朗读使用
  const englishParagraphs = splitIntoParagraphs(article.content)

  // 段落播音：点击喇叭图标从该段开始全文朗读
  const handleSpeakParagraph = (index: number) => {
    speech.playParagraph(englishParagraphs, index)
  }

  // 播放按钮：未开始时从头播，暂停后恢复
  const handleSpeechPlay = () => {
    if (speech.currentParagraph >= 0) {
      speech.resume()
    } else {
      speech.play(englishParagraphs, 0)
    }
  }

  return (
    <div className="space-y-6">
      {/* 成就解锁 Toast：本次新解锁时弹出，3 秒后自动关闭 */}
      <AchievementUnlockToast
        achievements={unlockedAchievements}
        onClose={clearUnlockedAchievements}
      />

      <ReadingHeader
        isHistoryMode={isHistoryMode}
        topicLabel={topicLabel}
        difficultyLabel={difficultyLabel}
        difficultyStyle={difficultyStyle}
        wordCount={article.wordCount}
        estimatedMinutes={estimatedMinutes}
        preparingPrint={preparingPrint}
        onPrint={() => void handlePrint()}
        elapsedSec={elapsedSec}
        view={view}
        readingProgress={readingProgress}
      />

      {/* 打印工作表：Portal 挂载到 body，仅打印时可见（见 index.css @media print） */}
      {printOpen &&
        article &&
        createPortal(
          <div className="print-portal">
            <PrintableWorksheet
              article={article}
              questions={questions}
              grammarQuestions={grammarQuestions}
              onFinished={closePrint}
            />
          </div>,
          document.body,
        )}

      {/* 标题 */}
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 md:text-3xl">
        {article.title}
      </h1>

      {/* 视图切换：reading / quiz / result */}
      {view === 'reading' ? (
        <>
          {/* 翻译模式切换 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">原文与翻译</h2>
              {/* AI 来源徽章：文章与全文翻译由哪个 AI 接口生成 */}
              <AIProviderBadge scenario="article" />
            </div>
            <TranslationToggle mode={translationMode} onChange={handleTranslationModeChange} />
          </div>

          {/* 文章正文区 */}
          <div ref={articleAreaRef}>
            <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-6">
              <ArticleView
                article={article}
                mode={translationMode}
                sentenceTranslationVisible={sentenceTranslationVisible}
                onToggleSentenceTranslation={toggleSentenceTranslation}
                scrollTarget={scrollTarget}
                speakingParagraph={speech.currentParagraph}
                onSpeakParagraph={handleSpeakParagraph}
              />
            </article>

            {/* 全文朗读控制条：浮动在文章正文区底部 */}
            <SpeechControls
              isPlaying={speech.isPlaying}
              rate={speech.rate}
              currentParagraph={speech.currentParagraph}
              totalParagraphs={englishParagraphs.length}
              onPlay={handleSpeechPlay}
              onPause={speech.pause}
              onStop={speech.stop}
              onRateChange={speech.setRate}
              disabled={!speech.isSupported}
            />

            {/* 底部哨兵：用于检测是否滚动到底部 */}
            <div ref={bottomSentinelRef} className="h-1 w-full" aria-hidden />

            {/* "开始答题"入口：滚动到底部 或 已读状态均可触发
                - reachedBottom：保留原有"读完即可答题"路径
                - isArticleRead：已通过"阅读完成"标记但未滚动到底部的用户也可进入答题
                - 仅在题目已加载时显示 */}
            {(reachedBottom || isArticleRead) && questions.length > 0 && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={handleStartQuiz}
                  className="rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  开始答题 →
                </button>
              </div>
            )}

            {/* 词汇清单：成功时展示列表；失败时展示错误提示 + 重试入口（不再无声消失） */}
            {vocabularies.length > 0 ? (
              <div className="mt-6">
                <VocabularyList ref={vocabListRef} items={vocabularies} />
              </div>
            ) : vocabGenError ? (
              <div className="mt-6 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-900/20">
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  重点词汇生成失败：{vocabGenError}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRetryVocab()}
                  disabled={retryingVocab}
                  className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  {retryingVocab ? '重试中...' : '重试'}
                </button>
              </div>
            ) : null}

            {/* 重点短语区块（文章有 phrases 或正在补全时显示） */}
            <ArticlePhrasesSection phrases={article.phrases} loading={phrasesLoading} />

            {/* 语法填空生成失败提示条（阅读理解题正常时语法填空单独失败场景）：
                提供重试入口，避免答题流程无声跳过语法填空分区 */}
            {grammarGenError && (
              <div className="mt-6 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-900/20">
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  语法填空题生成失败：{grammarGenError}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRetryGrammar()}
                  disabled={retryingGrammar}
                  className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  {retryingGrammar ? '重试中...' : '重试'}
                </button>
              </div>
            )}

            {/* 阅读完成 / 生成练习题 / 阅读下一篇 操作按钮 */}
            <ReadingActions
              quizGenStage={quizGenStage}
              isArticleRead={isArticleRead}
              generatingQuestions={generatingQuestions}
              hasQuestions={questions.length > 0}
              loadingNext={loadingNext}
              onMarkAsRead={handleMarkAsRead}
              onLoadNext={() => void loadNextArticle()}
            />
          </div>
        </>
      ) : view === 'quiz' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
          {/* 左侧：返回阅读入口 */}
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleBackToReading}
              className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              返回阅读
            </button>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              已读 {formatDuration(elapsedSec)}，共 {questions.length} 题
            </p>
          </div>
          {/* 右侧：题目区（单题切换） */}
          <aside className="lg:col-span-1">
            <div className="sticky top-24">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">阅读理解</h2>
                {/* AI 来源徽章：练习题由哪个 AI 接口生成 */}
                <AIProviderBadge scenario="questions" />
              </div>
              <QuestionPanel
                questions={questions}
                currentIdx={currentQuestionIndex}
                answers={answers}
                onAnswer={handleAnswer}
                onNext={handleNext}
              />
            </div>
          </aside>
        </div>
      ) : view === 'grammar_quiz' ? (
        // 语法填空答题视图（独立分区，阅读理解答完后进入）
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
          {/* 左侧：返回阅读入口 */}
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleBackToReading}
              className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              返回阅读
            </button>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              语法填空 · 第 {currentGrammarIdx + 1} / {grammarQuestions.length} 题
            </p>
          </div>
          {/* 右侧：语法填空题目区 */}
          <aside className="lg:col-span-1">
            <div className="sticky top-24">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">语法填空</h2>
                {/* AI 来源徽章：语法填空题由哪个 AI 接口生成 */}
                <AIProviderBadge scenario="grammar_fill" />
              </div>
              <QuestionPanel
                questions={grammarQuestions}
                currentIdx={currentGrammarIdx}
                answers={grammarAnswers}
                onAnswer={handleGrammarAnswer}
                onNext={handleGrammarNext}
              />
            </div>
          </aside>
        </div>
      ) : (
        // result 视图（分两段：阅读理解 + 语法填空）
        <div className="space-y-6">
          {/* 语法填空交互式生成选择页（阅读理解答完但语法填空未就绪时展示）：
              由用户在「生成语法填空并继续答题」与「跳过，直接查看成绩」之间自行选择，
              替代原先静默跳过语法填空分区的行为 */}
          {grammarInterstitial && article && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm dark:border-emerald-700/60 dark:bg-emerald-900/20">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                  <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    完成阅读理解后，是否继续做语法填空？
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                    将基于本文生成 5 道语法填空（时态 / 语态 / 主谓一致 / 从句 / 非谓语），完成后合并计入本次成绩单。
                    {grammarGenError && (
                      <span className="mt-1 block text-amber-600 dark:text-amber-400">
                        上次生成未成功：{grammarGenError}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleGenerateGrammar()}
                  disabled={generatingGrammar}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  {generatingGrammar ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      正在生成语法填空...
                    </>
                  ) : (
                    '生成语法填空并继续'
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSkipGrammar}
                  disabled={generatingGrammar}
                  className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  跳过，直接查看成绩
                </button>
              </div>
            </div>
          )}

          {/* 总成绩单 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              本次成绩单
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* 正确率（阅读理解 + 语法填空合并） */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">正确率</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {(() => {
                    const totalQ = questions.length + grammarQuestions.length
                    if (totalQ === 0) return 0
                    const correctQ =
                      questions.filter((q, idx) => answers[idx] === q.correctIndex).length +
                      grammarQuestions.filter((q, idx) => grammarAnswers[idx] === q.correctIndex).length
                    return Math.round((correctQ / totalQ) * 100)
                  })()}
                  %
                </p>
              </div>
              {/* 用时 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">用时</p>
                <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {formatDuration(elapsedSec)}
                </p>
              </div>
              {/* 题数（阅读理解 + 语法填空合计） */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">题数</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {questions.length + grammarQuestions.length}
                </p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleViewTranslation}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              >
                查看全文翻译
              </button>
              <button
                type="button"
                onClick={handleStudyVocabulary}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                学习本文生词
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                重新答题
              </button>
            </div>
          </div>

          {/* 语法填空生成失败提示（答题流程因语法填空缺失直接跳过该分区时说明原因 + 重试）
              选择页已展示时隐藏，避免与交互式生成入口重复提示 */}
          {grammarQuestions.length === 0 && grammarGenError && !grammarInterstitial && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-900/20">
              <span className="text-sm text-amber-700 dark:text-amber-300">
                本次未包含语法填空：{grammarGenError}
              </span>
              <button
                type="button"
                onClick={() => void handleRetryGrammar()}
                disabled={retryingGrammar}
                className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                {retryingGrammar ? '重试中...' : '重试'}
              </button>
            </div>
          )}

          {/* 阅读理解成绩段 */}
          {questions.length > 0 && (
            <>
              <PerformanceAnalysis
                questions={questions}
                answers={answers}
                elapsedSec={elapsedSec}
              />
              <div>
                <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                  阅读理解 · 每题详解
                </h3>
                <AnswerFeedback
                  questions={questions}
                  answers={answers}
                  onRetry={handleRetry}
                  onLocateInArticle={handleLocateInArticle}
                />
              </div>
            </>
          )}

          {/* 语法填空成绩段（仅当有语法填空题时展示） */}
          {grammarQuestions.length > 0 && (
            <>
              <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  语法填空
                </h3>
              </div>
              <PerformanceAnalysis
                questions={grammarQuestions}
                answers={grammarAnswers}
                elapsedSec={0}
              />
              <div>
                <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                  语法填空 · 每题详解
                </h3>
                <AnswerFeedback
                  questions={grammarQuestions}
                  answers={grammarAnswers}
                  onRetry={handleRetry}
                  onLocateInArticle={handleLocateInArticle}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* 阅读记录保存失败提示：固定在底部居中，3 秒后自动消失 */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg dark:bg-red-700">
          {toast}
        </div>
      )}

      {/* 难度选择弹窗 */}
      {difficultyModal}
    </div>
  )
}
