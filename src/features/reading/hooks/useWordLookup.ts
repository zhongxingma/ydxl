// 查词 hook：组合选词浮层、生词本写入动作与 toast 提示
//
// 关键点：查词竞态与浮层关闭逻辑在 useWordSelectionPopover，
// 生词本写入（单个/批量）在 useWordbookActions，本 hook 仅做聚合。
import { useCallback, useMemo, useState } from 'react'
import type { Article, HighlightedWord } from '@/shared/types'
import type { PopoverState } from '../components/articleUtils'
import { useWordSelectionPopover } from './useWordSelectionPopover'
import { useWordbookActions } from './useWordbookActions'

export interface UseWordLookupResult {
  // 容器引用：用于检测点击是否在浮层外
  containerRef: React.RefObject<HTMLDivElement>
  // 浮层引用：用于检测点击是否在浮层内
  popoverRef: React.RefObject<HTMLDivElement>
  // 当前浮层状态（null 表示无浮层）
  popover: PopoverState | null
  // toast 提示消息
  toast: string | null
  // 高亮词列表
  highlightedWords: HighlightedWord[]
  // mouseup 处理：选词触发查词或批量收藏
  handleMouseUp: (e: React.MouseEvent<HTMLDivElement>) => Promise<void>
  // touchend 处理：触控端长按选词（延迟 300ms 等待选区稳定）
  handleTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => Promise<void>
  // 高亮词点击：弹出气泡
  handleHighlightedWordClick: (hw: HighlightedWord, rect: DOMRect) => void
  // 关闭浮层（同时使在途查词结果失效）
  closePopover: () => void
  // 加入生词本（查词浮层）
  handleAddLookupToWordbook: () => Promise<void>
  // 加入生词本（高亮词气泡）
  handleAddHighlightedToWordbook: () => Promise<void>
  // 批量加入生词本（多词选中）
  handleBatchAdd: () => Promise<void>
}

/**
 * 文章选词查词与生词本交互的统一管理 hook
 * @param article 当前文章（用于 sourceArticleId 关联与文章切换时清理浮层）
 */
export function useWordLookup(article: Article): UseWordLookupResult {
  // toast 提示消息
  const [toast, setToast] = useState<string | null>(null)

  // 选词浮层状态、选区事件与关闭逻辑
  const {
    containerRef,
    popoverRef,
    popover,
    closePopover,
    handleMouseUp,
    handleTouchEnd,
    handleHighlightedWordClick,
    setPopover,
  } = useWordSelectionPopover(article)

  // 显示 toast 提示（2 秒后自动消失）
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2000)
  }, [])

  // 生词本写入动作（单个 / 批量）
  const {
    handleAddHighlightedToWordbook,
    handleAddLookupToWordbook,
    handleBatchAdd,
  } = useWordbookActions({
    popover,
    setPopover,
    articleId: article.id,
    closePopover,
    showToast,
  })

  // 提取高亮词列表
  const highlightedWords = useMemo(() => article.highlightedWords ?? [], [article.highlightedWords])

  return {
    containerRef,
    popoverRef,
    popover,
    toast,
    highlightedWords,
    handleMouseUp,
    handleTouchEnd,
    handleHighlightedWordClick,
    closePopover,
    handleAddLookupToWordbook,
    handleAddHighlightedToWordbook,
    handleBatchAdd,
  }
}
