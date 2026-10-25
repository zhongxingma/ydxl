// 重点短语区块：展示 AI 提取的短语 / 释义 / 例句；历史文章补全中显示骨架屏
import type { ArticlePhrase } from '@/shared/types'
import AIProviderBadge from '@/shared/components/AIProviderBadge'

interface ArticlePhrasesSectionProps {
  phrases?: ArticlePhrase[]
  loading: boolean
}

export default function ArticlePhrasesSection({ phrases, loading }: ArticlePhrasesSectionProps) {
  if (!(phrases && phrases.length > 0) && !loading) return null

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">重点短语</h3>
        {/* AI 来源徽章：短语由哪个 AI 接口提取 */}
        <AIProviderBadge scenario="articlePhrases" />
      </div>
      {loading && (!phrases || phrases.length === 0) ? (
        // 骨架屏：历史文章短语补全中（AI 提取耗时约 1-3s）
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-gray-100 dark:bg-gray-700/60" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {phrases?.map((p, idx) => (
            <li
              key={`${p.phrase}-${idx}`}
              className="rounded-md border border-gray-100 p-3 dark:border-gray-700/60"
            >
              {/* 短语 + 释义：同一行，短语加粗 */}
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                  {p.phrase}
                </span>
                {p.meaning && (
                  <span className="text-sm text-gray-600 dark:text-gray-300">{p.meaning}</span>
                )}
              </div>
              {/* 例句块：缩进引用样式 */}
              {p.example && (
                <div className="mt-1.5 border-l-2 border-indigo-200 pl-3 dark:border-indigo-700/60">
                  <p className="text-xs italic text-gray-600 dark:text-gray-400">{p.example}</p>
                  {p.exampleTranslation && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                      {p.exampleTranslation}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
