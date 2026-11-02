// 五步复习 - 第一步：识记（游戏化增强版）
// 1. 单词头部：单词、音标、释义、例句、发音按钮
// 2. 词根词缀拆解动画：按前缀(蓝)/词根(绿)/后缀(紫)着色，逐部分浮现
// 3. 趣味助记口诀：自动调用 AI generateMnemonic，加载中显示骨架屏
// 4. emoji 助记：自动调用 AI generateEmojiHint，大字号展示
// 所有 AI 调用失败时优雅降级，不阻塞流程
import { logger } from '../../../shared/utils/logger'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Word } from '@/shared/types'
import { aiProvider, type MnemonicResult } from '@/shared/services/ai'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import WordHeader from '../components/WordHeader'
import { cn } from '@/shared/utils/cn'
import type { StepResult } from '../types'
import '../review-animations.css'

interface LearnStepProps {
  word: Word
  onComplete: (result: StepResult) => void
}

// 词根拆解片段类型
type PartType = 'prefix' | 'root' | 'suffix'

interface RootPart {
  text: string
  type: PartType
}

// 将 word.root 字段拆分为前缀/词根/后缀片段
// 支持以 +、-、/、空格、顿号、逗号 等常见分隔符的写法
function parseRoot(root: string): RootPart[] {
  const parts = root
    .split(/[+\-/、，,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return []
  // 单片段：整体视为词根
  if (parts.length === 1) {
    return [{ text: parts[0], type: 'root' }]
  }
  // 两片段：根据尾部特征判定是「前缀+词根」还是「词根+后缀」
  if (parts.length === 2) {
    const [a, b] = parts
    // 短的尾部更可能是后缀（如 ness / ly / ed / s）
    if (b.length <= 3 && a.length > b.length) {
      return [
        { text: a, type: 'root' },
        { text: b, type: 'suffix' },
      ]
    }
    return [
      { text: a, type: 'prefix' },
      { text: b, type: 'root' },
    ]
  }
  // 三片段及以上：首部=前缀，尾部=后缀，中间=词根
  return parts.map((text, i): RootPart => {
    if (i === 0) return { text, type: 'prefix' }
    if (i === parts.length - 1) return { text, type: 'suffix' }
    return { text, type: 'root' }
  })
}

// 各片段颜色映射
const PART_COLOR: Record<PartType, string> = {
  prefix: 'text-blue-600 dark:text-blue-400',
  root: 'text-green-600 dark:text-green-400',
  suffix: 'text-purple-600 dark:text-purple-400',
}

const PART_KEY: Record<PartType, string> = {
  prefix: 'review.learn.part_prefix',
  root: 'review.learn.part_root',
  suffix: 'review.learn.part_suffix',
}

export default function LearnStep({ word, onComplete }: LearnStepProps) {
  const { t } = useTranslation()
  // 记录开始时间，用于计算用时
  const startTimeRef = useRef(Date.now())

  // 助记口诀状态
  const [mnemonic, setMnemonic] = useState<MnemonicResult | null>(null)
  const [mnemonicLoading, setMnemonicLoading] = useState(false)
  const [mnemonicError, setMnemonicError] = useState(false)

  // emoji 助记状态
  const [emojis, setEmojis] = useState<string[]>([])
  const [emojiLoading, setEmojiLoading] = useState(false)

  // 词根拆解片段
  const rootParts = word.root ? parseRoot(word.root) : []

  // 挂载时自动加载助记口诀与 emoji（并行、互不阻塞）
  useEffect(() => {
    let cancelled = false
    setMnemonic(null)
    setMnemonicError(false)
    setEmojis([])
    setMnemonicLoading(true)
    setEmojiLoading(true)

    // 助记口诀
    aiProvider
      .generateMnemonic(word.word, word.definition, word.root)
      .then((result) => {
        if (!cancelled) setMnemonic(result)
      })
      .catch((err) => {
        logger.warn('[LearnStep] 获取助记口诀失败', err)
        if (!cancelled) setMnemonicError(true)
      })
      .finally(() => {
        if (!cancelled) setMnemonicLoading(false)
      })

    // emoji 助记
    aiProvider
      .generateEmojiHint(word.word, word.definition)
      .then((result) => {
        if (!cancelled && Array.isArray(result) && result.length > 0) {
          setEmojis(result.slice(0, 3))
        }
      })
      .catch((err) => {
        logger.warn('[LearnStep] 获取 emoji 助记失败', err)
        // emoji 失败静默降级，不展示
      })
      .finally(() => {
        if (!cancelled) setEmojiLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [word.word, word.definition, word.root])

  // 完成本步骤：识记视为全对
  const handleComplete = () => {
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
    onComplete({ correct: true, correctRate: 1, timeSpent })
  }

  return (
    <div className="space-y-4">
      {/* 单词头部（含发音按钮） */}
      <WordHeader word={word} />

      {/* 词性 + 释义 */}
      {(word.pos || word.definition) && (
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          {word.pos && (
            <span className="mr-2 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {word.pos}
            </span>
          )}
          <span className="text-base text-gray-800 dark:text-gray-200">{word.definition}</span>
        </div>
      )}

      {/* 例句 */}
      {word.example && (
        <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50/50 px-3 py-2 dark:border-indigo-500 dark:bg-indigo-900/10">
          <p className="text-sm italic text-gray-700 dark:text-gray-300">&ldquo;{word.example}&rdquo;</p>
        </div>
      )}

      {/* 字段全空时显示补全提示 */}
      {!word.phonetic && !word.pos && !word.definition && !word.example && (
        <div className="rounded-lg bg-blue-50 p-3 text-center dark:bg-blue-900/20">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            {t('review.learn.enriching')}
          </p>
        </div>
      )}

      {/* 词根词缀拆解动画 */}
      {rootParts.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-3 dark:bg-amber-900/20">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('review.learn.root_breakdown')}
          </span>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {rootParts.map((part, idx) => (
              <span
                key={`${part.text}-${idx}`}
                className={cn(
                  'root-part text-2xl font-bold tracking-tight md:text-3xl',
                  PART_COLOR[part.type],
                )}
                style={{ animationDelay: `${idx * 300}ms` }}
              >
                {part.text}
                {idx < rootParts.length - 1 && (
                  <span className="mx-1 text-gray-400 dark:text-gray-500">+</span>
                )}
              </span>
            ))}
          </div>
          {/* 颜色图例 */}
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {Object.keys(PART_KEY).map((key) => {
              const part = key as PartType
              return (
                <span
                  key={key}
                  className={cn('inline-flex items-center gap-1', PART_COLOR[part])}
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-current" />
                  {t(PART_KEY[part])}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* 趣味助记口诀 + emoji 助记 */}
      <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-900/10">
        {/* emoji 助记 */}
        {(emojiLoading || emojis.length > 0) && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-blue-800 dark:text-blue-200">
              {t('review.learn.emoji_hint')}
            </span>
            {/* AI 来源徽章：emoji 助记由哪个 AI 接口生成 */}
            <AIProviderBadge scenario="emojiHint" />
            <div className="flex items-center gap-1">
              {emojiLoading && (
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-6 w-6 animate-pulse rounded bg-blue-200 dark:bg-blue-800"
                    />
                  ))}
                </span>
              )}
              {!emojiLoading &&
                emojis.map((e, i) => (
                  <span
                    key={`${e}-${i}`}
                    className="emoji-pop text-3xl"
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {e}
                  </span>
                ))}
            </div>
          </div>
        )}

        {/* 助记口诀 */}
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">
              {t('review.learn.mnemonic')}
            </h4>
            {/* AI 来源徽章：助记口诀由哪个 AI 接口生成 */}
            <AIProviderBadge scenario="mnemonic" />
          </div>
          {mnemonicLoading && (
            <div className="mt-1 space-y-1.5">
              <div className="h-3 w-full animate-pulse rounded bg-blue-200 dark:bg-blue-800" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-blue-200 dark:bg-blue-800" />
            </div>
          )}
          {!mnemonicLoading && mnemonic && (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {mnemonic.mnemonic}
            </p>
          )}
          {!mnemonicLoading && mnemonic?.explanation && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {mnemonic.explanation}
            </p>
          )}
          {!mnemonicLoading && mnemonicError && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('review.learn.mnemonic_unavailable')}
            </p>
          )}
        </div>
      </div>

      {/* 下一步按钮 */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleComplete}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {t('review.next_step')}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
    </div>
  )
}
