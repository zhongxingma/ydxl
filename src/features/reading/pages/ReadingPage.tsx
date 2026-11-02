// 每日阅读主页面（分区式布局）
// 视图状态机：'reading' | 'quiz' | 'grammar_quiz' | 'result'
// - reading：顶部固定栏（题材/难度/词数/预估时长） + 阅读进度条 + 计时器 + 正文 + 高亮词
// - quiz：单题切换答题区，选后立即反馈
// - grammar_quiz：语法填空答题区
// - result：成绩单 + 每题详解入口 + 查看翻译/学习生词按钮
//
// 页面仅负责编排与渲染，具体逻辑下沉至 hooks/：
//   - useReadingTimer：累计阅读时长
//   - useReadingProgress：阅读进度百分比 + 是否到底部
//   - useSessionRecorder：会话写入 + 成就解锁
//   - useArticleLoader：文章/题目/词汇加载、短语补全与加载状态
//   - useQuizRunner：答题、语法填空、练习生成与重试流程
//   - usePrintWorksheet：一键打印完整练习
//   - useReadingLifecycle：首次/切换加载、完成标记、缓存刷新与难度选择
import { useCallback, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import type { Difficulty, Topic } from '@/shared/types'
import { AchievementUnlockToast } from '@/features/stats'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { QuizGenStage, TranslationMode } from '../types'
import { DIFFICULTY_STYLE, TOPIC_LABEL, DIFFICULTY_LABEL } from '../types'
import DifficultySelectModal from '../components/DifficultySelectModal'
import ReadingPrintPortal from '../components/ReadingPrintPortal'
import ReadingPageViews from '../components/ReadingPageViews'
import ReadingHeader from '../components/ReadingHeader'
import { renderReadingPageGuard } from '../components/readingPageGuard'
import { splitIntoParagraphs } from '../components/articleUtils'
import { useReadingStore } from '../store'
import { useReadingTimer } from '../hooks/useReadingTimer'
import { useReadingProgress } from '../hooks/useReadingProgress'
import { useSessionRecorder } from '../hooks/useSessionRecorder'
import { useArticleSpeech } from '../hooks/useArticleSpeech'
import { useArticleLoader, type LoadStage } from '../hooks/useArticleLoader'
import { useQuizRunner } from '../hooks/useQuizRunner'
import { usePrintWorksheet } from '../hooks/usePrintWorksheet'
import { useReadingLifecycle } from '../hooks/useReadingLifecycle'

// 各加载阶段对应的展示文案 key
const LOAD_STAGE_KEY: Record<LoadStage, string> = {
  checking: 'reading.stage.checking',
  generating: 'reading.stage.generating',
  loading: 'reading.stage.loading',
}

export default function ReadingPage() {
  const { t } = useTranslation()
  // 解析 ?articleId=xxx 查询参数：首页历史阅读记录跳转携带，存在时进入「历史文章模式」
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const articleId = searchParams.get('articleId')
  // 是否为历史文章模式（articleId 存在即视为历史文章，区别于今日新文章）
  const isHistoryMode = articleId != null

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
  // 难度选择弹窗：进入每日阅读时弹出，选择后传入 loadToday 生成对应难度文章
  const [showDifficultyModal, setShowDifficultyModal] = useState(false)

  // 从 Zustand store 读取视图状态与 actions
  const view = useReadingStore((s) => s.view)
  const currentQuestionIndex = useReadingStore((s) => s.currentQuestionIndex)
  const answers = useReadingStore((s) => s.answers)
  const sessionRecorded = useReadingStore((s) => s.sessionRecorded)
  const sentenceTranslationVisible = useReadingStore((s) => s.sentenceTranslationVisible)
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

  // 全文朗读：封装 Web Speech API 的多段排队朗读
  const speech = useArticleSpeech()

  // 文章/题目/词汇加载、短语补全与加载状态
  const {
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
  } = useArticleLoader({
    articleId,
    mountedRef,
    loadTokenRef,
    markedReadRef,
    selectedDifficultyRef,
    selectedTopicRef,
    resetStore,
    startTimer,
    setQuizGenStage,
  })

  // 答题/语法填空/词汇重试/练习题按需生成等交互流程
  const {
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
  } = useQuizRunner({
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
  })

  // 一键打印：题目未生成时先补齐再唤起打印
  const { printOpen, preparingPrint, closePrint, handlePrint } = usePrintWorksheet({
    article,
    questions,
    grammarQuestions,
    setQuestions,
    setGrammarQuestions,
    mountedRef,
    setToast,
    generatingQuestions,
  })

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

  // 首次/切换文章加载、完成标记、缓存刷新、toast 自动消失与难度选择
  const { handleDifficultySelect, handleDifficultyCancel } = useReadingLifecycle({
    articleId,
    article,
    status,
    view,
    toast,
    setToast,
    loadArticleById,
    loadToday,
    resetStore,
    setArticle,
    setShowDifficultyModal,
    navigate,
    mountedRef,
    markedReadRef,
    abortControllerRef,
    selectedDifficultyRef,
    selectedTopicRef,
  })

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

  // 页面级状态守卫：loading / error / 文章数据不完整时返回兜底视图
  const guard = renderReadingPageGuard({
    status,
    stageText: t(LOAD_STAGE_KEY[loadStage]),
    errorMsg,
    article,
    reload,
    overlay: difficultyModal,
    t,
  })
  if (guard) return guard
  // 守卫已保证 article 非空；此判断仅用于 TypeScript 类型收窄
  if (!article) return null

  // 题材与难度标签信息
  const topicLabel = article.topic
    ? TOPIC_LABEL[article.topic]
      ? t(`reading.topic.${article.topic}`)
      : article.topic
    : null
  const difficultyLabel = article.difficulty
    ? DIFFICULTY_LABEL[article.difficulty]
      ? t(`reading.difficulty.${article.difficulty}`)
      : article.difficulty
    : null
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
      <ReadingPrintPortal
        open={printOpen}
        article={article}
        questions={questions}
        grammarQuestions={grammarQuestions}
        onFinished={closePrint}
      />

      {/* 标题 + 视图区（reading / quiz / grammar_quiz / result）+ 操作提示 */}
      <ReadingPageViews
        view={view}
        toast={toast}
        reading={{
          article,
          translationMode,
          onTranslationModeChange: handleTranslationModeChange,
          articleAreaRef,
          sentenceTranslationVisible,
          onToggleSentenceTranslation: toggleSentenceTranslation,
          scrollTarget,
          speech,
          englishParagraphs,
          onSpeakParagraph: handleSpeakParagraph,
          onSpeechPlay: handleSpeechPlay,
          bottomSentinelRef,
          reachedBottom,
          isArticleRead,
          questionCount: questions.length,
          onStartQuiz: handleStartQuiz,
          vocabListRef,
          vocabularies,
          vocabGenError,
          retryingVocab,
          onRetryVocab: () => void handleRetryVocab(),
          phrasesLoading,
          grammarGenError,
          retryingGrammar,
          onRetryGrammar: () => void handleRetryGrammar(),
          quizGenStage,
          generatingQuestions,
          loadingNext,
          onMarkAsRead: handleMarkAsRead,
          onLoadNext: () => void loadNextArticle(),
        }}
        quiz={{
          mode: 'reading',
          questions,
          currentIdx: currentQuestionIndex,
          answers,
          elapsedSec,
          onBackToReading: handleBackToReading,
          onAnswer: handleAnswer,
          onNext: handleNext,
        }}
        grammar={{
          mode: 'grammar',
          questions: grammarQuestions,
          currentIdx: currentGrammarIdx,
          answers: grammarAnswers,
          elapsedSec,
          onBackToReading: handleBackToReading,
          onAnswer: handleGrammarAnswer,
          onNext: handleGrammarNext,
        }}
        result={{
          articleId: article.id,
          questions,
          grammarQuestions,
          answers,
          grammarAnswers,
          elapsedSec,
          grammarInterstitial,
          grammarGenError,
          generatingGrammar,
          retryingGrammar,
          onGenerateGrammar: () => void handleGenerateGrammar(),
          onSkipGrammar: handleSkipGrammar,
          onRetryGrammar: () => void handleRetryGrammar(),
          onViewTranslation: handleViewTranslation,
          onStudyVocabulary: handleStudyVocabulary,
          onRetry: handleRetry,
          onLocateInArticle: handleLocateInArticle,
        }}
      />

      {/* 难度选择弹窗 */}
      {difficultyModal}
    </div>
  )
}
