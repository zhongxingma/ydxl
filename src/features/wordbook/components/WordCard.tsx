// 单个生词卡片：展示生词、音标、词性释义、例句、笔记、掌握进度、稳固度、下次复习时间及操作按钮
// 支持长按 500ms 弹出操作菜单（与单击互斥，手势逻辑见 shared/hooks/useLongPress）
// 使用 React.memo 避免父组件（WordbookPage）状态变化时全量重渲染：
// 仅当 word/selected 等 props 实际变化时才重渲染当前卡片
import { memo, useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { cn } from '@/shared/utils/cn'
import { useLongPress } from '@/shared/hooks/useLongPress'
import { useTranslation } from '@/shared/i18n/useTranslation'
import WordCardHeader from './WordCardHeader'
import WordCardDetails from './WordCardDetails'
import WordCardFooter from './WordCardFooter'

interface WordCardProps {
  // 生词实体
  word: Word
  // 是否选中
  selected: boolean
  // 切换选中
  onSelect: (id: string) => void
  // 编辑笔记
  onEditNote: (word: Word) => void
  // 删除
  onDelete: (word: Word) => void
  // 长按触发回调（弹出操作菜单）
  onLongPress: (word: Word) => void
  // AI 补全 / 收藏成功后刷新列表
  onRefresh?: () => void
}

function WordCardInner({
  word,
  selected,
  onSelect,
  onEditNote,
  onDelete,
  onLongPress,
  onRefresh,
}: WordCardProps) {
  // 国际化文案
  const { t } = useTranslation()
  // 顽固词标记：stubbornCount >= 3
  const isStubborn = (word.stubbornCount ?? 0) >= 3
  // 已掌握标记：mastery >= 5
  const isMastered = word.mastery >= 5

  // toast 提示消息
  const [toast, setToast] = useState<string | null>(null)
  // toast 自动消失定时器引用（卸载时清理，避免对已卸载组件 setState）
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 显示 toast 提示（3 秒后自动消失）
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 3000)
  }

  // 长按手势：触摸 / 鼠标长按 500ms 触发操作菜单，滑动取消
  const longPressHandlers = useLongPress({ onLongPress: () => onLongPress(word) })

  // 卸载时清理 toast 定时器，避免内存泄漏与对已卸载组件 setState
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors select-none',
        selected
          ? 'border-indigo-400 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-900/20'
          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600',
      )}
      {...longPressHandlers}
    >
      <div className="flex items-start gap-3">
        {/* 选择框 */}
        <label className="flex shrink-0 cursor-pointer items-center pt-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(word.id)}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
            aria-label={t('wordbook.card.select_word', { word: word.word })}
          />
        </label>

        {/* 内容区 */}
        <div className="min-w-0 flex-1">
          <WordCardHeader
            word={word}
            isMastered={isMastered}
            isStubborn={isStubborn}
            onRefresh={onRefresh}
            showToast={showToast}
          />
          <WordCardDetails word={word} onRefresh={onRefresh} showToast={showToast} />
          <WordCardFooter word={word} onEditNote={onEditNote} onDelete={onDelete} />
        </div>
      </div>

      {/* Toast 提示 */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center">
          <div className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-gray-700">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}

// React.memo 浅比较 props：父组件搜索输入/选中其他卡片等场景下，未受影响的卡片跳过重渲染
export default memo(WordCardInner)
