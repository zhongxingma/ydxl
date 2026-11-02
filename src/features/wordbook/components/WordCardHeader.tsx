// 生词卡片头部：单词、收藏、朗读、音标与掌握/顽固词徽章
import { logger } from '../../../shared/utils/logger'
import { useState } from 'react'
import type { Word } from '@/shared/types'
import { cn } from '@/shared/utils/cn'
import Badge from '@/shared/components/Badge'
import { speak, isSpeechSupported } from '@/shared/utils/speech'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { toggleFavorite } from '../services/wordbookService'

interface WordCardHeaderProps {
  word: Word
  isMastered: boolean
  isStubborn: boolean
  onRefresh?: () => void
  showToast: (msg: string) => void
}

export default function WordCardHeader({
  word,
  isMastered,
  isStubborn,
  onRefresh,
  showToast,
}: WordCardHeaderProps) {
  // 国际化文案
  const { t } = useTranslation()
  // 收藏切换 loading 状态（防止重复点击）
  const [favoriting, setFavoriting] = useState(false)
  const speechSupported = isSpeechSupported()

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{word.word}</h3>
      {/* 收藏星标按钮 */}
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation()
          setFavoriting(true)
          try {
            await toggleFavorite(word.id)
            onRefresh?.()
          } catch (err) {
            logger.warn('[WordCard] 收藏操作失败', err)
            showToast(t('wordbook.card.favorite_failed'))
          } finally {
            setFavoriting(false)
          }
        }}
        disabled={favoriting}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
          word.favorite === 1
            ? 'text-yellow-500 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-900/30'
            : 'text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700',
          favoriting && 'cursor-not-allowed opacity-50',
        )}
        aria-label={word.favorite === 1 ? t('wordbook.card.unfavorite') : t('wordbook.card.favorite')}
        title={word.favorite === 1 ? t('wordbook.card.unfavorite') : t('wordbook.card.favorite')}
      >
        {word.favorite === 1 ? (
          /* 填充星星（已收藏） */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
            <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
          </svg>
        ) : (
          /* 描边星星（未收藏） */
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
        )}
      </button>
      {/* 单词发音按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          speak(word.word, 1)
        }}
        disabled={!speechSupported}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300',
          !speechSupported && 'cursor-not-allowed opacity-50',
        )}
        aria-label={t('wordbook.card.speak', { word: word.word })}
        title={speechSupported ? t('wordbook.card.speak_title') : t('wordbook.card.speak_unsupported')}
      >
        {/* 喇叭 SVG 图标 */}
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
        </svg>
      </button>
      {word.phonetic && (
        <span className="text-sm text-gray-500 dark:text-gray-400">{word.phonetic}</span>
      )}
      {isMastered && <Badge label={t('wordbook.card.mastered_badge')} color="green" />}
      {isStubborn && <Badge label={t('wordbook.card.stubborn_badge')} color="red" />}
    </div>
  )
}
