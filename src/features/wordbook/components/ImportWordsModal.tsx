// 批量导入单词 Modal：粘贴文本解析出英文单词，预览后批量导入
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { wordbookService } from '../services/wordbookService'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { useModalFocus } from '@/shared/hooks/useModalFocus'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'

interface ImportWordsModalProps {
  // 是否打开
  open: boolean
  // 关闭回调
  onClose: () => void
}

// 自动关闭延迟（毫秒）：导入结果展示 2 秒后关闭模态框
const AUTO_CLOSE_MS = 2000

export default function ImportWordsModal({ open, onClose }: ImportWordsModalProps) {
  // 国际化文案
  const { t } = useTranslation()
  // 输入文本
  const [text, setText] = useState('')
  // 解析出的单词列表（小写、去重）
  const [words, setWords] = useState<string[]>([])
  // 导入中状态
  const [importing, setImporting] = useState(false)
  // 导入结果
  const [result, setResult] = useState<{ added: number; failed: number } | null>(null)
  // 错误提示
  const [error, setError] = useState('')
  // 自动关闭定时器引用
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 重置所有表单字段
  const resetForm = useCallback(() => {
    setText('')
    setWords([])
    setResult(null)
    setError('')
  }, [])

  // 关闭并重置（含清理自动关闭定时器，在调用 onClose 前清空字段）
  const handleClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }
    resetForm()
    onClose()
  }, [resetForm, onClose])

  // 监听 Escape 关闭 + 锁定背景滚动
  useEscapeKey(handleClose, open)
  // 焦点管理：打开时聚焦文本域，Tab 在弹窗内循环，关闭后焦点回到触发按钮
  const dialogRef = useModalFocus<HTMLDivElement>(open)
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // 卸载时清理自动关闭定时器，避免内存泄漏与卸载后回调
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
    }
  }, [])

  // open 为 false 时不渲染
  if (!open) return null

  // 解析并预览：正则提取英文单词，转小写去重
  const handleParse = () => {
    const matches = text.match(/[a-zA-Z]+/g)
    if (!matches) {
      setWords([])
      setError(t('wordbook.import_modal.no_words'))
      return
    }
    // 转小写并去重，保持首次出现顺序
    const seen = new Set<string>()
    const unique: string[] = []
    for (const w of matches) {
      const lower = w.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        unique.push(lower)
      }
    }
    setWords(unique)
    setError('')
    setResult(null)
  }

  // 删除单个预览单词
  const handleRemoveWord = (w: string) => {
    setWords((prev) => prev.filter((x) => x !== w))
  }

  // 批量导入
  const handleImport = async () => {
    if (words.length === 0 || importing) return
    setImporting(true)
    setError('')
    try {
      const res = await wordbookService.bulkAddToWordbook(words)
      setResult(res)
      // 2 秒后自动关闭模态框
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
      autoCloseTimerRef.current = setTimeout(() => {
        handleClose()
      }, AUTO_CLOSE_MS)
    } catch (err) {
      logger.warn('[ImportWordsModal] 批量导入失败', err)
      setError(err instanceof Error ? err.message : t('wordbook.import_modal.import_failed'))
    } finally {
      setImporting(false)
    }
  }

  return (
    // 遮罩层：点击空白处关闭
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('wordbook.import_modal.title')}
    >
      {/* Modal 主体：阻止点击事件冒泡 */}
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('wordbook.import_modal.title')}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label={t('wordbook.close')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 文本域：支持中英文混合输入 */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={t('wordbook.import_modal.text_placeholder')}
          className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
        />

        {/* 解析并预览按钮 */}
        <div className="mt-3">
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim()}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              !text.trim()
                ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50',
            )}
          >
            {t('wordbook.import_modal.parse')}
          </button>
        </div>

        {/* 预览区 */}
        {words.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              {t('wordbook.import_modal.preview_count', { count: words.length })}
            </div>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border border-gray-200 p-3 dark:border-gray-700">
              {words.map((w) => (
                <span
                  key={w}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                >
                  {w}
                  <button
                    type="button"
                    onClick={() => handleRemoveWord(w)}
                    className="text-indigo-400 hover:text-indigo-600 dark:text-indigo-500 dark:hover:text-indigo-300"
                    aria-label={t('wordbook.import_modal.remove_word', { word: w })}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 导入结果 */}
        {result && (
          <div className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
            {t('wordbook.import_modal.result', { added: result.added, failed: result.failed })}
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 底部操作按钮 */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t('wordbook.cancel')}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={words.length === 0 || importing}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              words.length === 0 || importing
                ? 'cursor-not-allowed bg-indigo-400 dark:bg-indigo-400/70'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600',
            )}
          >
            {importing ? t('wordbook.import_modal.importing') : t('wordbook.import_modal.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
