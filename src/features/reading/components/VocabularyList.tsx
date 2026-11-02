// 重点词汇清单组件
// 文末展示 AI 提取的重点词汇，按重要性 high/medium/low 用不同颜色徽章标识
// 增强版：每个词汇卡片还展示真题例句与 emoji 助记
import clsx from 'clsx'
import { forwardRef } from 'react'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { VocabularyImportance, VocabularyItem } from '../types'

interface VocabularyListProps {
  items: VocabularyItem[]
}

// 重要性对应的徽章样式与标签 key
const IMPORTANCE_STYLE: Record<
  VocabularyImportance,
  { labelKey: string; className: string }
> = {
  high: {
    labelKey: 'reading.importance.high',
    className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  medium: {
    labelKey: 'reading.importance.medium',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  low: {
    labelKey: 'reading.importance.low',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  },
}

// 重要性排序：高 -> 中 -> 低
const IMPORTANCE_ORDER: Record<VocabularyImportance, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

// 通过 forwardRef 暴露根节点，便于父组件滚动定位
const VocabularyList = forwardRef<HTMLElement, VocabularyListProps>(function VocabularyList(
  { items },
  ref
) {
  const { t } = useTranslation()
  if (!items || items.length === 0) {
    return null
  }

  // 按重要性排序后展示
  const sorted = [...items].sort(
    (a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]
  )

  return (
    <section
      ref={ref}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('reading.vocab.title')}</h3>
        {/* AI 来源徽章：词汇/例句/emoji 助记分别由哪个 AI 接口生成 */}
        <AIProviderBadge scenario="vocabulary" />
        <AIProviderBadge scenario="exampleSentence" text={t('reading.vocab.example_badge')} />
        <AIProviderBadge scenario="emojiHint" text={t('reading.vocab.mnemonic_badge')} />
      </div>
      <ul className="space-y-3">
        {sorted.map((item, idx) => {
          const badge = IMPORTANCE_STYLE[item.importance] ?? IMPORTANCE_STYLE.low
          // emoji 助记：将数组拼接为字符串展示
          const emojiHintText = item.emojiHint?.filter(Boolean).join(' ')
          return (
            <li
              key={`${item.word}-${idx}`}
              className="rounded-md border border-gray-100 p-3 dark:border-gray-700/60"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {item.word}
                </span>
                {item.phonetic && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {item.phonetic}
                  </span>
                )}
                {item.pos && (
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {item.pos}
                  </span>
                )}
                <span
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    badge.className
                  )}
                >
                  {t(badge.labelKey)}
                </span>
              </div>
              {item.definition && (
                <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">
                  {item.definition}
                </p>
              )}
              {/* 真题例句（如有，斜体显示） */}
              {item.exampleSentence && (
                <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
                  {t('reading.vocab.example_sentence', { example: item.exampleSentence })}
                </p>
              )}
              {/* emoji 助记（如有） */}
              {emojiHintText && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('reading.vocab.mnemonic', { text: emojiHintText })}
                </p>
              )}
              {/* 原文例句 + 中文翻译（引用块样式，与重点短语区块视觉一致） */}
              {item.example && (
                <div className="mt-1.5 border-l-2 border-indigo-200 pl-3 dark:border-indigo-700/60">
                  <p className="text-xs italic text-gray-600 dark:text-gray-400">
                    {item.example}
                  </p>
                  {item.exampleTranslation && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                      {item.exampleTranslation}
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
})

export default VocabularyList
