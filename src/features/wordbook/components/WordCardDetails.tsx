// 生词卡片详情：词性释义、AI 补全、例句、相关短语与笔记
import { useState } from 'react'
import type { Word } from '@/shared/types'
import { cn } from '@/shared/utils/cn'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import { enrichWord } from '../services/wordbookService'

interface WordCardDetailsProps {
  word: Word
  onRefresh?: () => void
  showToast: (msg: string) => void
}

export default function WordCardDetails({
  word,
  onRefresh,
  showToast,
}: WordCardDetailsProps) {
  // AI 补全 loading 状态
  const [enriching, setEnriching] = useState(false)
  // 相关短语展开/收起状态
  const [phrasesExpanded, setPhrasesExpanded] = useState(false)

  return (
    <>
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

      {/* AI 词义补全按钮：仅缺失 phonetic 或 definition 时显示 */}
      {(!word.phonetic || !word.definition) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation()
              setEnriching(true)
              try {
                await enrichWord(word.id)
                onRefresh?.()
                showToast('AI 补全成功')
              } catch (err) {
                console.warn('[WordCard] AI 补全失败', err)
                // 从错误中提取具体消息：baseProvider 已将 DeepSeek 错误码翻译为中文
                // （如 402 → "DeepSeek 账号余额不足，请充值"；401 → "DeepSeek API key 错误..."）
                // 其他 Error（如网络错误、超时）直接显示其 message
                const reason = err instanceof Error && err.message ? err.message : '请稍后重试'
                showToast(`AI 补全失败：${reason}`)
              } finally {
                setEnriching(false)
              }
            }}
            disabled={enriching}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
          >
            <span aria-hidden>✨</span>
            {enriching ? '补全中...' : 'AI 补全'}
          </button>
          {/* AI 来源徽章：补全由哪个 AI 接口完成 */}
          <AIProviderBadge scenario="wordEnrich" />
        </div>
      )}

      {/* 例句 + 中文翻译 */}
      {word.example && (
        <div className="mt-2">
          <p className="text-sm italic text-gray-500 dark:text-gray-400">"{word.example}"</p>
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
            onClick={(e) => {
              e.stopPropagation()
              setPhrasesExpanded((v) => !v)
            }}
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
            相关短语（{word.phrases.length}）
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
                      例：{p.example}
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

      {/* 笔记 */}
      {word.note && (
        <p className="mt-2 flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <span aria-hidden="true">📝</span>
          <span className="whitespace-pre-wrap">{word.note}</span>
        </p>
      )}
    </>
  )
}
