// 生词卡片底部：稳固度、掌握进度、下次复习时间与操作按钮
import type { Word } from '@/shared/types'
import StabilityBar from '@/shared/components/StabilityBar'
import { formatRelativeTime } from '@/shared/utils/relativeTime'
import { useTranslation } from '@/shared/i18n/useTranslation'
import MasteryProgress from './MasteryProgress'
import NextReviewBadge from './NextReviewBadge'

interface WordCardFooterProps {
  word: Word
  onEditNote: (word: Word) => void
  onDelete: (word: Word) => void
}

export default function WordCardFooter({ word, onEditNote, onDelete }: WordCardFooterProps) {
  const { t } = useTranslation()
  return (
    <>
      {/* 记忆稳固度进度条 */}
      {word.stabilityScore !== undefined && (
        <div className="mt-3">
          <StabilityBar score={word.stabilityScore} />
        </div>
      )}

      {/* 底部：掌握进度 + 复习时间 + 操作 */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <MasteryProgress mastery={word.mastery} />
          <NextReviewBadge nextReview={word.nextReview} />
          {/* 预计下次复习时间文案 */}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('wordbook.card.next_review_label', { time: formatRelativeTime(word.nextReview) })}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEditNote(word)}
            className="rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            {t('wordbook.note.edit')}
          </button>
          <button
            type="button"
            onClick={() => onDelete(word)}
            className="rounded px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            {t('wordbook.delete')}
          </button>
        </div>
      </div>
    </>
  )
}
