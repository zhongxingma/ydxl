// 单词头部展示：单词（大字号）+ 音标 + 发音按钮
// 发音使用 Web Speech API（已封装在 shared/utils/speech.ts）
import type { Word } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'
import { isSpeechSupported, speak } from '@/shared/utils/speech'

interface WordHeaderProps {
  // 单词实体
  word: Word
  // 是否显示发音按钮，默认 true
  showPronounce?: boolean
  // 额外类名
  className?: string
}

export default function WordHeader({
  word,
  showPronounce = true,
  className,
}: WordHeaderProps) {
  const { t } = useTranslation()
  const speechSupported = isSpeechSupported()

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1', className)}>
      {/* 单词 */}
      <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 md:text-4xl">
        {word.word}
      </h2>

      {/* 音标 */}
      {word.phonetic && (
        <span className="text-base text-gray-500 dark:text-gray-400">
          {word.phonetic}
        </span>
      )}

      {/* 发音按钮 */}
      {showPronounce && speechSupported && (
        <button
          type="button"
          onClick={() => speak(word.word)}
          aria-label={t('review.word.speak_aria', { word: word.word })}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
        >
          {/* 喇叭图标 */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.96 0-1.74-.78-1.74-1.74V9.99c0-.96.78-1.74 1.74-1.74H6.75Z"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
