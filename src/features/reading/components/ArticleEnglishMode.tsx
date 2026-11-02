// 纯英文模式渲染
// 仅渲染英文段落（无中文辅助），高亮词在英文段落内渲染为可点击 span
import clsx from 'clsx'
import type { RefObject } from 'react'
import type { HighlightedWord } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { renderSentenceWithHighlights } from './articleUtils'

interface ArticleEnglishModeProps {
  englishParagraphs: string[]
  highlightedWords: HighlightedWord[]
  scrollTarget?: string
  scrollTargetRef: RefObject<HTMLParagraphElement>
  onWordClick: (hw: HighlightedWord, rect: DOMRect) => void
  speakingParagraph?: number
  onSpeakParagraph?: (index: number) => void
}

export default function ArticleEnglishMode({
  englishParagraphs,
  highlightedWords,
  scrollTarget,
  scrollTargetRef,
  onWordClick,
  speakingParagraph,
  onSpeakParagraph,
}: ArticleEnglishModeProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5">
      {englishParagraphs.map((en, i) => {
        const isTarget = !!scrollTarget && en.includes(scrollTarget)
        const isSpeaking = speakingParagraph === i
        return (
          <div key={`e-${i}`} className="space-y-2">
            {/* 段落播音图标按钮：该段正在朗读时高亮 */}
            <button
              type="button"
              onClick={() => onSpeakParagraph?.(i)}
              aria-label={t('reading.speak.paragraph_aria', { index: i + 1 })}
              title={isSpeaking ? t('reading.speak.paragraph_speaking') : t('reading.speak.paragraph')}
              className={clsx(
                'inline-flex items-center justify-center rounded p-1 transition-colors',
                isSpeaking
                  ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700 dark:hover:text-indigo-300',
              )}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 5L6 9H2v6h4l5 4V5z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.54 8.46a5 5 0 010 7.07"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.07 4.93a10 10 0 010 14.14"
                />
              </svg>
            </button>
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
          </div>
        )
      })}
    </div>
  )
}
