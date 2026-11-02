// 查词浮层的生词本写入动作：单个加入与批量加入
import { logger } from '../../../shared/utils/logger'
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { wordbookService } from '@/features/wordbook'
import { useTranslation } from '@/shared/i18n/useTranslation'
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
  const { t } = useTranslation()
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
      showToast(t('reading.wordbook.added', { word: hw.word }))
      window.setTimeout(() => {
        closePopover()
      }, 1200)
    } catch (err) {
      logger.warn('[useWordLookup] 高亮词加入生词本失败', err)
      const msg = err instanceof Error && /network|fetch|Failed to fetch/i.test(err.message)
        ? t('reading.wordbook.network_error')
        : t('reading.wordbook.add_failed')
      showToast(msg)
    }
  }, [popover, articleId, closePopover, showToast, setPopover, t])

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
      showToast(t('reading.wordbook.added', { word: lookup.word }))
      window.setTimeout(() => {
        closePopover()
      }, 1200)
    } catch (err) {
      logger.warn('[useWordLookup] 查词加入生词本失败', err)
      const msg = err instanceof Error && /network|fetch|Failed to fetch/i.test(err.message)
        ? t('reading.wordbook.network_error')
        : t('reading.wordbook.add_failed')
      showToast(msg)
    }
  }, [popover, articleId, closePopover, showToast, setPopover, t])

  // 批量加入生词本（多词选中）
  const handleBatchAdd = useCallback(async () => {
    if (!popover || popover.kind !== 'batch' || popover.processing) return
    const words = popover.words
    setPopover({ ...popover, processing: true })
    try {
      const result = await wordbookService.bulkAddToWordbook(words)
      setPopover({ ...popover, processing: false, result })
      showToast(t('reading.wordbook.batch_added', { count: result.added }))
      // 1.5 秒后自动关闭浮层
      window.setTimeout(() => {
        closePopover()
      }, 1500)
    } catch (err) {
      logger.warn('[ArticleView] 批量加入生词本失败', err)
      setPopover({ ...popover, processing: false })
      showToast(t('reading.wordbook.batch_failed'))
    }
  }, [popover, closePopover, showToast, setPopover, t])

  return {
    handleAddHighlightedToWordbook,
    handleAddLookupToWordbook,
    handleBatchAdd,
  }
}
