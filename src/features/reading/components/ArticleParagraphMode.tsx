// 段落对照模式渲染
// 每段英文下方紧跟对应中文段落，高亮词在英文段落内渲染为可点击 span
// speakingParagraph 高亮当前朗读段落
import clsx from 'clsx'
import type { RefObject } from 'react'
import type { HighlightedWord } from '@/shared/types'
import { renderSentenceWithHighlights } from './articleUtils'

interface ArticleParagraphModeProps {
  englishParagraphs: string[]
  chineseParagraphs: string[]
  highlightedWords: HighlightedWord[]
  scrollTarget?: string
  scrollTargetRef: RefObject<HTMLParagraphElement>
  onWordClick: (hw: HighlightedWord, rect: DOMRect) => void
  /** 当前朗读段落索引，-1 或 undefined 表示无 */
  speakingParagraph?: number
}

export default function ArticleParagraphMode({
  englishParagraphs,
  chineseParagraphs,
  highlightedWords,
  scrollTarget,
  scrollTargetRef,
  onWordClick,
  speakingParagraph,
}: ArticleParagraphModeProps) {
  return (
    <div className="space-y-5">
      {englishParagraphs.map((en, i) => {
        const isTarget = !!scrollTarget && en.includes(scrollTarget)
        const isSpeaking = speakingParagraph === i
        return (
          <div key={`p-${i}`} className="space-y-2">
            <p
              ref={isTarget ? scrollTargetRef : undefined}
              className={clsx(
                'rounded text-base leading-relaxed text-gray-800 transition-colors dark:text-gray-200 md:text-lg md:leading-8',
                isSpeaking &&
                  'ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/20',
              )}
            >
              {renderSentenceWithHighlights(en, highlightedWords, onWordClick)}
            </p>
            {chineseParagraphs[i] && (
              <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400 md:text-[15px]">
                {chineseParagraphs[i]}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
