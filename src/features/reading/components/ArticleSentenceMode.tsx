// 句子模式渲染
// 同时承载两种模式：
//   - sentence：每段英文按句切分，英文句下方紧跟对应中文句
//   - toggle：逐句切换，默认英文，点击切到中文，再点切回
// speakingParagraph 高亮当前朗读段落容器
import clsx from 'clsx'
import type { RefObject } from 'react'
import type { HighlightedWord } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { renderSentenceWithHighlights, splitIntoSentences } from './articleUtils'

interface ArticleSentenceModeProps {
  englishParagraphs: string[]
  chineseParagraphs: string[]
  highlightedWords: HighlightedWord[]
  scrollTarget?: string
  scrollTargetRef: RefObject<HTMLParagraphElement>
  onWordClick: (hw: HighlightedWord, rect: DOMRect) => void
  // 是否启用逐句切换模式（true = toggle；false = sentence）
  toggleMode?: boolean
  // toggle 模式专用：已切到译文的句子下标集合（按全局句子下标）
  sentenceTranslationVisible?: Set<number>
  // toggle 模式专用：切换指定句子翻译的回调
  onToggleSentenceTranslation?: (idx: number) => void
  /** 当前朗读段落索引，-1 或 undefined 表示无 */
  speakingParagraph?: number
}

export default function ArticleSentenceMode({
  englishParagraphs,
  chineseParagraphs,
  highlightedWords,
  scrollTarget,
  scrollTargetRef,
  onWordClick,
  toggleMode = false,
  sentenceTranslationVisible,
  onToggleSentenceTranslation,
  speakingParagraph,
}: ArticleSentenceModeProps) {
  const { t } = useTranslation()
  // 全局句子下标计数器（用于 toggle 模式）
  let globalSentenceIdx = -1

  return (
    <div className="space-y-5">
      {englishParagraphs.map((enPara, i) => {
        const enSentences = splitIntoSentences(enPara)
        const zhSentences = chineseParagraphs[i]
          ? splitIntoSentences(chineseParagraphs[i])
          : []
        const isSpeaking = speakingParagraph === i
        return (
          <div
            key={`s-${i}`}
            className={clsx(
              'space-y-1.5 rounded transition-colors',
              isSpeaking &&
                'ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/20',
            )}
          >
            {enSentences.map((sentence, j) => {
              globalSentenceIdx += 1
              const idx = globalSentenceIdx
              const showTranslation =
                toggleMode && (sentenceTranslationVisible?.has(idx) ?? false)
              const isTarget =
                !!scrollTarget &&
                (sentence.includes(scrollTarget) ||
                  (zhSentences[j] && zhSentences[j].includes(scrollTarget)))

              if (toggleMode) {
                return (
                  <p
                    key={`t-${i}-${j}`}
                    ref={isTarget ? scrollTargetRef : undefined}
                    onClick={() => onToggleSentenceTranslation?.(idx)}
                    className={clsx(
                      'cursor-pointer rounded px-1 py-0.5 text-base leading-relaxed transition-colors md:text-lg md:leading-8',
                      showTranslation
                        ? 'text-sm italic text-gray-500 dark:text-gray-400 md:text-[15px]'
                        : 'text-gray-800 hover:bg-yellow-50 dark:text-gray-200 dark:hover:bg-yellow-900/20',
                      isTarget && 'rounded ring-2 ring-indigo-400'
                    )}
                    title={showTranslation ? t('reading.sentence.hide_translation') : t('reading.sentence.show_translation')}
                  >
                    {showTranslation
                      ? (zhSentences[j] ?? sentence)
                      : renderSentenceWithHighlights(sentence, highlightedWords, onWordClick)}
                  </p>
                )
              }

              return (
                <div key={`s-${i}-${j}`} className="space-y-1">
                  <p
                    ref={isTarget ? scrollTargetRef : undefined}
                    className="text-base leading-relaxed text-gray-800 dark:text-gray-200 md:text-lg md:leading-8"
                  >
                    {renderSentenceWithHighlights(sentence, highlightedWords, onWordClick)}
                  </p>
                  {zhSentences[j] && (
                    <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400 md:text-[15px]">
                      {zhSentences[j]}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
