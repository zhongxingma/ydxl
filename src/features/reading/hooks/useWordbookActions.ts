// 查词浮层的生词本写入动作：单个加入与批量加入
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { wordbookService } from '@/features/wordbook'
import type { PopoverState } from '../components/articleUtils'

interface UseWordbookActionsOptions {
  popover: PopoverState | null
  setPopover: Dispatch<SetStateAction<PopoverState | null>>
  articleId: string
  closePopover: () => void
  showToast: (msg: string) => void
}

export function useWordbookActions({
  popover,
  setPopover,
  articleId,
  closePopover,
  showToast,
}: UseWordbookActionsOptions) {
  // 加入生词本（高亮词）
  const handleAddHighlightedToWordbook = useCallback(async () => {
    if (!popover || popover.kind !== 'highlight' || popover.added) return
    const hw = popover.word
    try {
      await wordbookService.addToWordbook({
        word: hw.word,
        phonetic: hw.phonetic,
        pos: hw.pos,
        definition: hw.definition,
        example: hw.example,
        sourceArticleId: articleId,
        // 字段缺失或为占位值时，自动调用 AI 补全音标/词义/例句
        enrichIfMissing: true,
      })
      setPopover({ ...popover, added: true })
      showToast(`已加入「${hw.word}」到生词本`)
      window.setTimeout(() => {
        closePopover()
      }, 1200)
    } catch (err) {
      console.warn('[useWordLookup] 高亮词加入生词本失败', err)
      const msg = err instanceof Error && /network|fetch|Failed to fetch/i.test(err.message)
        ? '网络异常，请检查连接'
        : '加入失败，请重试'
      showToast(msg)
    }
  }, [popover, articleId, closePopover, showToast, setPopover])

  // 加入生词本（查词浮层）
  const handleAddLookupToWordbook = useCallback(async () => {
    if (!popover || popover.kind !== 'lookup' || !popover.lookup || popover.added) return
    const lookup = popover.lookup
    try {
      await wordbookService.addToWordbook({
        word: lookup.word,
        phonetic: lookup.phonetic,
        pos: lookup.pos,
        definition: lookup.definition,
        sourceArticleId: articleId,
        // 字段缺失或为占位值时，自动调用 AI 补全音标/词义/例句
        enrichIfMissing: true,
      })
      setPopover({ ...popover, added: true })
      showToast(`已加入「${lookup.word}」到生词本`)
      window.setTimeout(() => {
        closePopover()
      }, 1200)
    } catch (err) {
      console.warn('[useWordLookup] 查词加入生词本失败', err)
      const msg = err instanceof Error && /network|fetch|Failed to fetch/i.test(err.message)
        ? '网络异常，请检查连接'
        : '加入失败，请重试'
      showToast(msg)
    }
  }, [popover, articleId, closePopover, showToast, setPopover])

  // 批量加入生词本（多词选中）
  const handleBatchAdd = useCallback(async () => {
    if (!popover || popover.kind !== 'batch' || popover.processing) return
    const words = popover.words
    setPopover({ ...popover, processing: true })
    try {
      const result = await wordbookService.bulkAddToWordbook(words)
      setPopover({ ...popover, processing: false, result })
      showToast(`成功添加 ${result.added} 个词到生词本`)
      // 1.5 秒后自动关闭浮层
      window.setTimeout(() => {
        closePopover()
      }, 1500)
    } catch (err) {
      console.warn('[ArticleView] 批量加入生词本失败', err)
      setPopover({ ...popover, processing: false })
      showToast('批量添加失败，请重试')
    }
  }, [popover, closePopover, showToast, setPopover])

  return {
    handleAddHighlightedToWordbook,
    handleAddLookupToWordbook,
    handleBatchAdd,
  }
}
