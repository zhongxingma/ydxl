// 文章类型与难度选择弹窗：进入每日阅读时弹出，供用户选择即将生成文章的题材与难度
// 选择后调用 onSelect 回调，将 topic + difficulty 传入 loadToday → getDailyArticle 生成对应文章
// 取消时调用 onCancel 回调（无文章时导航回首页，有文章时仅关闭弹窗）
import { useEffect, useState } from 'react'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { useModalFocus } from '@/shared/hooks/useModalFocus'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Difficulty, Topic } from '@/shared/types'
import { cn } from '@/shared/utils/cn'

interface DifficultySelectModalProps {
  open: boolean
  onSelect: (difficulty: Difficulty, topic?: Topic) => void
  onCancel: () => void
}

interface DifficultyOption {
  value: Difficulty
  labelKey: string
  lexileRange: string
  descKey: string
  cardStyle: string
  selectedStyle: string
}

const DIFFICULTY_OPTIONS: DifficultyOption[] = [
  {
    value: 'easy',
    labelKey: 'reading.difficulty.easy',
    lexileRange: '600-700L',
    descKey: 'reading.difficulty_modal.desc_easy',
    cardStyle: 'border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-900/20',
    selectedStyle: 'border-emerald-500 ring-2 ring-emerald-500/40',
  },
  {
    value: 'medium',
    labelKey: 'reading.difficulty.medium',
    lexileRange: '700-800L',
    descKey: 'reading.difficulty_modal.desc_medium',
    cardStyle: 'border-amber-200 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20',
    selectedStyle: 'border-amber-500 ring-2 ring-amber-500/40',
  },
  {
    value: 'hard',
    labelKey: 'reading.difficulty.hard',
    lexileRange: '800-900L',
    descKey: 'reading.difficulty_modal.desc_hard',
    cardStyle: 'border-rose-200 bg-rose-50 dark:border-rose-700/60 dark:bg-rose-900/20',
    selectedStyle: 'border-rose-500 ring-2 ring-rose-500/40',
  },
]

// 题材选项（与 TOPIC_LABEL 保持一致）
const TOPIC_OPTIONS: { value: Topic; labelKey: string }[] = [
  { value: 'campus', labelKey: 'reading.topic.campus' },
  { value: 'science', labelKey: 'reading.topic.science' },
  { value: 'culture', labelKey: 'reading.topic.culture' },
  { value: 'biography', labelKey: 'reading.topic.biography' },
  { value: 'travel', labelKey: 'reading.topic.travel' },
  { value: 'sports', labelKey: 'reading.topic.sports' },
  { value: 'technology', labelKey: 'reading.topic.technology' },
  { value: 'nature', labelKey: 'reading.topic.nature' },
  { value: 'news', labelKey: 'reading.topic.news' },
  { value: 'self', labelKey: 'reading.topic.self' },
  { value: 'society', labelKey: 'reading.topic.society' },
  { value: 'nature_theme', labelKey: 'reading.topic.nature_theme' },
  // 生活化题材（AI 按专属简报创作，写具体经历、防套话）
  { value: 'traditional_culture', labelKey: 'reading.topic.traditional_culture' },
  { value: 'ai_life', labelKey: 'reading.topic.ai_life' },
  { value: 'personal_growth', labelKey: 'reading.difficulty_modal.topic_personal_growth' },
]

export default function DifficultySelectModal({ open, onSelect, onCancel }: DifficultySelectModalProps) {
  const { t } = useTranslation()
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>('medium')
  const [selectedTopic, setSelectedTopic] = useState<Topic | undefined>(undefined)

  useEscapeKey(onCancel, open)
  // 焦点管理：打开时聚焦首个可操作按钮（无表单控件），Tab 在弹窗内循环
  const dialogRef = useModalFocus<HTMLDivElement>(open)

  // 锁定背景滚动
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  // 题材按钮通用样式
  const topicBtnBase = 'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors'
  const topicBtnNormal = 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
  const topicBtnSelected = 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-300'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={t('reading.difficulty_modal.title')}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('reading.difficulty_modal.title')}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('reading.difficulty_modal.subtitle')}
          </p>
        </div>

        {/* 题材选择 */}
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reading.field.topic')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {/* 不限（随机） */}
            <button
              type="button"
              onClick={() => setSelectedTopic(undefined)}
              className={cn(topicBtnBase, selectedTopic === undefined ? topicBtnSelected : topicBtnNormal)}
            >
              {t('reading.difficulty_modal.topic_any')}
            </button>
            {TOPIC_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedTopic(opt.value)}
                className={cn(topicBtnBase, selectedTopic === opt.value ? topicBtnSelected : topicBtnNormal)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 难度选择 */}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reading.field.difficulty')}
          </p>
          <div className="space-y-2">
            {DIFFICULTY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedDifficulty(opt.value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border-2 p-3 text-left transition-colors',
                  opt.cardStyle,
                  selectedDifficulty === opt.value && opt.selectedStyle,
                )}
              >
                <div>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {t(opt.labelKey)}
                  </span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    {t('reading.lexile', { range: opt.lexileRange })}
                  </span>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {t(opt.descKey)}
                  </p>
                </div>
                {/* 选中标记 */}
                {selectedDifficulty === opt.value && (
                  <svg className="h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {t('reading.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSelect(selectedDifficulty, selectedTopic)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {t('reading.start')}
          </button>
        </div>
      </div>
    </div>
  )
}
