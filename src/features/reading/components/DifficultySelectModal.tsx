// 文章类型与难度选择弹窗：进入每日阅读时弹出，供用户选择即将生成文章的题材与难度
// 选择后调用 onSelect 回调，将 topic + difficulty 传入 loadToday → getDailyArticle 生成对应文章
// 取消时调用 onCancel 回调（无文章时导航回首页，有文章时仅关闭弹窗）
import { useEffect, useState } from 'react'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import type { Difficulty, Topic } from '@/shared/types'
import { cn } from '@/shared/utils/cn'

interface DifficultySelectModalProps {
  open: boolean
  onSelect: (difficulty: Difficulty, topic?: Topic) => void
  onCancel: () => void
}

interface DifficultyOption {
  value: Difficulty
  label: string
  lexileRange: string
  description: string
  cardStyle: string
  selectedStyle: string
}

const DIFFICULTY_OPTIONS: DifficultyOption[] = [
  {
    value: 'easy',
    label: '简单',
    lexileRange: '600-700L',
    description: '基础词汇，简短句式，适合入门阅读',
    cardStyle: 'border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-900/20',
    selectedStyle: 'border-emerald-500 ring-2 ring-emerald-500/40',
  },
  {
    value: 'medium',
    label: '中等',
    lexileRange: '700-800L',
    description: '中考核心词汇，复合句式，适合日常训练',
    cardStyle: 'border-amber-200 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20',
    selectedStyle: 'border-amber-500 ring-2 ring-amber-500/40',
  },
  {
    value: 'hard',
    label: '困难',
    lexileRange: '800-900L',
    description: '进阶词汇，复杂句式，适合挑战自我',
    cardStyle: 'border-rose-200 bg-rose-50 dark:border-rose-700/60 dark:bg-rose-900/20',
    selectedStyle: 'border-rose-500 ring-2 ring-rose-500/40',
  },
]

// 题材选项（与 TOPIC_LABEL 保持一致）
const TOPIC_OPTIONS: { value: Topic; label: string }[] = [
  { value: 'campus', label: '校园生活' },
  { value: 'science', label: '科普知识' },
  { value: 'culture', label: '文化生活' },
  { value: 'biography', label: '人物传记' },
  { value: 'travel', label: '旅行见闻' },
  { value: 'sports', label: '体育竞技' },
  { value: 'technology', label: '科技前沿' },
  { value: 'nature', label: '自然风物' },
  { value: 'news', label: '新闻时事' },
  { value: 'self', label: '人与自我' },
  { value: 'society', label: '人与社会' },
  { value: 'nature_theme', label: '人与自然' },
  // 生活化题材（AI 按专属简报创作，写具体经历、防套话）
  { value: 'traditional_culture', label: '中华传统文化' },
  { value: 'ai_life', label: '人工智能与生活' },
  { value: 'personal_growth', label: '个人成长' },
]

export default function DifficultySelectModal({ open, onSelect, onCancel }: DifficultySelectModalProps) {
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>('medium')
  const [selectedTopic, setSelectedTopic] = useState<Topic | undefined>(undefined)

  useEscapeKey(onCancel, open)

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
      aria-label="选择文章类型与难度"
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            选择文章类型与难度
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            选择题材与难度后，将生成对应类型的阅读文章
          </p>
        </div>

        {/* 题材选择 */}
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            题材
          </p>
          <div className="grid grid-cols-3 gap-2">
            {/* 不限（随机） */}
            <button
              type="button"
              onClick={() => setSelectedTopic(undefined)}
              className={cn(topicBtnBase, selectedTopic === undefined ? topicBtnSelected : topicBtnNormal)}
            >
              不限
            </button>
            {TOPIC_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedTopic(opt.value)}
                className={cn(topicBtnBase, selectedTopic === opt.value ? topicBtnSelected : topicBtnNormal)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 难度选择 */}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            难度
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
                    {opt.label}
                  </span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    蓝思 {opt.lexileRange}
                  </span>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {opt.description}
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
            取消
          </button>
          <button
            type="button"
            onClick={() => onSelect(selectedDifficulty, selectedTopic)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            开始阅读
          </button>
        </div>
      </div>
    </div>
  )
}
