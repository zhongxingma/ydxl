// 文章阅读视图组件
// 功能：
// 1. 四种翻译模式：纯英文 / 段落对照 / 按句显示 / 逐句切换（点击句子切换中英）
// 2. highlightedWords 渲染为浅黄色背景高亮词，点击弹出查词气泡（音标/词性/释义/例句/加入生词本）
// 3. 划词浮层：
//    - 单词：保持原有查词行为
//    - 多词（按空格分割 ≥ 2）：显示"批量加入生词本（N 个词）"按钮
// 4. 支持外部传入 scrollTarget，用于答题反馈跳转回原文对应位置
//
// 本文件仅做模式分发与浮层挂载，具体渲染逻辑下沉至：
//   - ArticleEnglishMode：纯英文
//   - ArticleParagraphMode：段落对照
//   - ArticleSentenceMode：按句显示 / 逐句切换
//   - WordPopover：查词 / 高亮词 / 批量收藏 浮层
// 选词竞态逻辑抽离至 hooks/useWordLookup
import { useEffect, useRef } from 'react'
import type { Article } from '@/shared/types'
import type { TranslationMode } from '../types'
import { splitIntoParagraphs } from './articleUtils'
import ArticleEnglishMode from './ArticleEnglishMode'
import ArticleParagraphMode from './ArticleParagraphMode'
import ArticleSentenceMode from './ArticleSentenceMode'
import WordPopover from './WordPopover'
import { useWordLookup } from '../hooks/useWordLookup'

interface ArticleViewProps {
  article: Article
  mode: TranslationMode
  // 逐句切换模式下哪些句子已切到译文（按全局句子下标）
  sentenceTranslationVisible?: Set<number>
  // 切换指定句子翻译的回调
  onToggleSentenceTranslation?: (idx: number) => void
  // 跳转目标：包含该文本的句子会被滚动到视图中
  scrollTarget?: string
  /** 当前朗读段落索引，-1 或 undefined 表示无 */
  speakingParagraph?: number
  /** 点击段落播音图标回调（仅 EnglishMode 提供） */
  onSpeakParagraph?: (index: number) => void
}

export default function ArticleView({
  article,
  mode,
  sentenceTranslationVisible,
  onToggleSentenceTranslation,
  scrollTarget,
  speakingParagraph,
  onSpeakParagraph,
}: ArticleViewProps) {
  // 跳转目标句子引用，用于滚动定位
  const scrollTargetRef = useRef<HTMLParagraphElement | null>(null)

  // 选词/高亮词/批量收藏 浮层与生词本交互
  const {
    containerRef,
    popoverRef,
    popover,
    toast,
    highlightedWords,
    handleMouseUp,
    handleTouchEnd,
    handleHighlightedWordClick,
    closePopover,
    handleAddLookupToWordbook,
    handleAddHighlightedToWordbook,
    handleBatchAdd,
  } = useWordLookup(article)

  // 跳转到 scrollTarget 对应的句子并滚动到视图中
  useEffect(() => {
    if (!scrollTarget) return
    if (scrollTargetRef.current) {
      scrollTargetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 闪烁高亮提示
      const el = scrollTargetRef.current
      el.classList.add('ring-2', 'ring-indigo-400')
      const timer = window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-indigo-400')
      }, 2000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [scrollTarget])

  const englishParagraphs = splitIntoParagraphs(article.content)
  // 防御 translation 为 undefined/null：历史导入文章或 AI 生成部分失败时可能缺失此字段
  // splitIntoParagraphs(undefined) 会抛出 TypeError "Cannot read properties of undefined (reading 'split')"
  // 导致 ErrorBoundary 捕获并显示"页面渲染异常，请刷新或返回首页重试"
  const chineseParagraphs = splitIntoParagraphs(article.translation ?? '')

  // 模式分发：根据 mode 选择渲染 ArticleEnglishMode / ArticleParagraphMode / ArticleSentenceMode
  // toggle 模式复用 ArticleSentenceMode，通过 toggleMode 开关注入切换交互
  // 添加 key={mode} 强制重渲染避免模式切换时状态残留
  const modeProps = {
    englishParagraphs,
    chineseParagraphs,
    highlightedWords,
    scrollTarget,
    scrollTargetRef,
    onWordClick: handleHighlightedWordClick,
    speakingParagraph,
  }

  return (
    <div ref={containerRef} className="relative" onMouseUp={handleMouseUp} onTouchEnd={handleTouchEnd}>
      {mode === 'english' ? (
        <ArticleEnglishMode key="english" {...modeProps} onSpeakParagraph={onSpeakParagraph} />
      ) : mode === 'paragraph' ? (
        <ArticleParagraphMode key="paragraph" {...modeProps} />
      ) : (
        <ArticleSentenceMode
          key={mode}
          {...modeProps}
          toggleMode={mode === 'toggle'}
          sentenceTranslationVisible={sentenceTranslationVisible}
          onToggleSentenceTranslation={onToggleSentenceTranslation}
        />
      )}

      {/* 浮层：查词 / 高亮词 / 批量收藏 三种互斥形态 */}
      {popover && (
        <WordPopover
          popover={popover}
          popoverRef={popoverRef}
          onClose={closePopover}
          onAddLookup={handleAddLookupToWordbook}
          onAddHighlight={handleAddHighlightedToWordbook}
          onBatchAdd={handleBatchAdd}
        />
      )}

      {/* Toast 提示 */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center"
        >
          <div className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-gray-700">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
