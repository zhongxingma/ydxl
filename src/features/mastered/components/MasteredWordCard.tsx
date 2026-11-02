// 单个已掌握单词卡片：展示单词、音标、释义、例句、例句翻译、相关短语
import { useState } from 'react'
import type { Word } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'
import { isSpeechSupported, speak } from '@/shared/utils/speech'

interface MasteredWordCardProps {
  word: Word
}

export default function MasteredWordCard({ word }: MasteredWordCardProps) {
  const { t } = useTranslation()
  // 相关短语展开/收起状态
  const [phrasesExpanded, setPhrasesExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600">
      {/* 头部：单词 + 发音按钮 + 音标 + 已掌握徽章 */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {word.word}
        </h3>
        {/* 单词发音按钮 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            speak(word.word, 1)
          }}
          disabled={!isSpeechSupported()}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300',
            !isSpeechSupported() && 'cursor-not-allowed opacity-50',
          )}
          aria-label={t('mastered.speak_aria', { word: word.word })}
          title={isSpeechSupported() ? t('mastered.speak_title') : t('mastered.speak_unsupported')}
        >
          {/* 喇叭 SVG 图标 */}
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
          </svg>
        </button>
        {word.phonetic && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {word.phonetic}
          </span>
        )}
        {/* 已掌握徽章 */}
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          {t('mastered.mastered_badge')}
        </span>
      </div>

      {/* 词性 + 释义 */}
      {(word.pos || word.definition) && (
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          {word.pos && (
            <span className="mr-1 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {word.pos}
            </span>
          )}
          <span>{word.definition}</span>
        </p>
      )}

      {/* 例句 + 中文翻译 */}
      {word.example && (
        <div className="mt-2">
          <p className="text-sm italic text-gray-500 dark:text-gray-400">
            "{word.example}"
          </p>
          {word.exampleTranslation && (
            <p className="mt-0.5 pl-3 text-xs text-gray-400 dark:text-gray-500">
              {word.exampleTranslation}
            </p>
          )}
        </div>
      )}

      {/* 相关短语（折叠展示） */}
      {word.phrases && word.phrases.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setPhrasesExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            <svg
              className={cn('h-3 w-3 transition-transform', phrasesExpanded && 'rotate-90')}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {t('mastered.phrases', { count: word.phrases.length })}
          </button>
          {phrasesExpanded && (
            <ul className="mt-1 space-y-1.5">
              {word.phrases.map((p, idx) => (
                <li
                  key={`${p.phrase}-${idx}`}
                  className="rounded-md bg-gray-50 p-2 dark:bg-gray-700/40"
                >
                  <div className="flex flex-wrap items-baseline gap-1">
                    <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                      {p.phrase}
                    </span>
                    {p.meaning && (
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {p.meaning}
                      </span>
                    )}
                  </div>
                  {p.example && (
                    <p className="mt-0.5 text-xs italic text-gray-500 dark:text-gray-400">
                      {t('mastered.phrase_example', { example: p.example })}
                    </p>
                  )}
                  {p.exampleTranslation && (
                    <p className="mt-0.5 pl-3 text-xs text-gray-400 dark:text-gray-500">
                      {p.exampleTranslation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
