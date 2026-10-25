// 阅读视图：翻译模式、正文、朗读控制、答题入口、词汇/短语与底部操作区
import type { RefObject } from 'react'
import type { Article } from '@/shared/types'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import type { QuizGenStage, TranslationMode, VocabularyItem } from '../types'
import ArticleView from './ArticleView'
import SpeechControls from './SpeechControls'
import TranslationToggle from './TranslationToggle'
import VocabularyList from './VocabularyList'
import ArticlePhrasesSection from './ArticlePhrasesSection'
import ReadingActions from './ReadingActions'

interface ReadingArticleViewProps {
  article: Article
  translationMode: TranslationMode
  onTranslationModeChange: (mode: TranslationMode) => void
  articleAreaRef: RefObject<HTMLDivElement>
  sentenceTranslationVisible: Set<number>
  onToggleSentenceTranslation: (idx: number) => void
  scrollTarget?: string
  speech: {
    currentParagraph: number
    isPlaying: boolean
    rate: number
    pause: () => void
    stop: () => void
    setRate: (rate: number) => void
    isSupported: boolean
  }
  englishParagraphs: string[]
  onSpeakParagraph: (index: number) => void
  onSpeechPlay: () => void
  bottomSentinelRef: RefObject<HTMLDivElement>
  reachedBottom: boolean
  isArticleRead: boolean
  questionCount: number
  onStartQuiz: () => void
  vocabListRef: RefObject<HTMLElement>
  vocabularies: VocabularyItem[]
  vocabGenError: string | null
  retryingVocab: boolean
  onRetryVocab: () => void
  phrasesLoading: boolean
  grammarGenError: string | null
  retryingGrammar: boolean
  onRetryGrammar: () => void
  quizGenStage: QuizGenStage
  generatingQuestions: boolean
  loadingNext: boolean
  onMarkAsRead: () => void
  onLoadNext: () => void
}

export default function ReadingArticleView({
  article,
  translationMode,
  onTranslationModeChange,
  articleAreaRef,
  sentenceTranslationVisible,
  onToggleSentenceTranslation,
  scrollTarget,
  speech,
  englishParagraphs,
  onSpeakParagraph,
  onSpeechPlay,
  bottomSentinelRef,
  reachedBottom,
  isArticleRead,
  questionCount,
  onStartQuiz,
  vocabListRef,
  vocabularies,
  vocabGenError,
  retryingVocab,
  onRetryVocab,
  phrasesLoading,
  grammarGenError,
  retryingGrammar,
  onRetryGrammar,
  quizGenStage,
  generatingQuestions,
  loadingNext,
  onMarkAsRead,
  onLoadNext,
}: ReadingArticleViewProps) {
  return (
    <>
      {/* 翻译模式切换 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">原文与翻译</h2>
          {/* AI 来源徽章：文章与全文翻译由哪个 AI 接口生成 */}
          <AIProviderBadge scenario="article" />
        </div>
        <TranslationToggle mode={translationMode} onChange={onTranslationModeChange} />
      </div>

      {/* 文章正文区 */}
      <div ref={articleAreaRef}>
        <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-6">
          <ArticleView
            article={article}
            mode={translationMode}
            sentenceTranslationVisible={sentenceTranslationVisible}
            onToggleSentenceTranslation={onToggleSentenceTranslation}
            scrollTarget={scrollTarget}
            speakingParagraph={speech.currentParagraph}
            onSpeakParagraph={onSpeakParagraph}
          />
        </article>

        {/* 全文朗读控制条：浮动在文章正文区底部 */}
        <SpeechControls
          isPlaying={speech.isPlaying}
          rate={speech.rate}
          currentParagraph={speech.currentParagraph}
          totalParagraphs={englishParagraphs.length}
          onPlay={onSpeechPlay}
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
        {(reachedBottom || isArticleRead) && questionCount > 0 && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onStartQuiz}
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
              onClick={onRetryVocab}
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
              onClick={onRetryGrammar}
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
          hasQuestions={questionCount > 0}
          loadingNext={loadingNext}
          onMarkAsRead={onMarkAsRead}
          onLoadNext={onLoadNext}
        />
      </div>
    </>
  )
}
