// 批量导入文章 Modal：粘贴文本按 --- 分隔解析多篇文章，预览后批量导入
// - 文本域：每篇文章用 --- 分隔，首行为标题，其余为正文
// - 解析并预览：过滤掉标题为空或正文长度 < 50 的文章
// - 批量导入：使用 Promise.allSettled 并行保存，单个失败不影响其他
// - 导入结果展示 2 秒后自动关闭模态框
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { articleService } from '../services/articleService'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { useModalFocus } from '@/shared/hooks/useModalFocus'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Article } from '@/shared/types'
import { cn } from '@/shared/utils/cn'

interface ImportArticlesModalProps {
  // 是否打开
  open: boolean
  // 关闭回调
  onClose: () => void
}

// 正文最小字符数（低于此长度过滤掉）
const MIN_CONTENT_LENGTH = 50
// 导入结果展示后自动关闭延迟（毫秒）
const AUTO_CLOSE_MS = 2000

// 解析后的文章结构
interface ParsedArticle {
  title: string
  content: string
  wordCount: number
}

/**
 * 解析批量导入文本
 * - 按 `---` 分隔为多个块
 * - 每块首行作为标题，其余作为正文
 * - 过滤掉标题为空或正文长度 < 50 的文章
 *
 * @param text 待解析的文本
 * @returns 解析出的文章列表
 */
function parseArticles(text: string): ParsedArticle[] {
  const blocks = text.split(/^---$/m).map((b) => b.trim()).filter(Boolean)
  const articles: ParsedArticle[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim())
    if (lines.length < 2) continue
    const title = lines[0].trim()
    const content = lines.slice(1).join('\n').trim()
    if (title && content.length >= MIN_CONTENT_LENGTH) {
      articles.push({
        title,
        content,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      })
    }
  }
  return articles
}

export default function ImportArticlesModal({ open, onClose }: ImportArticlesModalProps) {
  const { t } = useTranslation()
  // 输入文本
  const [text, setText] = useState('')
  // 解析出的文章列表
  const [articles, setArticles] = useState<ParsedArticle[]>([])
  // 导入中状态
  const [importing, setImporting] = useState(false)
  // 导入结果
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null)
  // 错误提示
  const [error, setError] = useState('')
  // 自动关闭定时器引用
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 重置所有表单字段
  const resetForm = useCallback(() => {
    setText('')
    setArticles([])
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

  // 解析并预览：调用 parseArticles 解析文本，更新预览列表
  const handleParse = () => {
    const parsed = parseArticles(text)
    if (parsed.length === 0) {
      setArticles([])
      setError(t('reading.import.no_valid'))
      return
    }
    setArticles(parsed)
    setError('')
    setResult(null)
  }

  // 删除单篇预览文章
  const handleRemoveArticle = (idx: number) => {
    setArticles((prev) => prev.filter((_, i) => i !== idx))
  }

  // 批量导入：使用 Promise.allSettled 并行保存，单个失败不影响其他
  // 成功后展示结果，2 秒后自动关闭模态框
  const handleImport = async () => {
    if (articles.length === 0 || importing) return
    setImporting(true)
    setError('')
    try {
      // 构造 Article 对象数组，每篇使用独立 id 与时间戳
      const now = Date.now()
      const articleEntities: Article[] = articles.map((a, idx) => ({
        id: `user-${now}-${idx}`,
        title: a.title,
        content: a.content,
        translation: '',
        genre: 'narrative' as const,
        topic: 'campus',
        difficulty: 'medium',
        wordCount: a.wordCount,
        lexileRange: { min: 600, max: 800 },
        highlightedWords: [],
        createdAt: now + idx,
        updated_at: now + idx,
        readAt: null,
        startedAt: null,
      }))
      // 并行保存，单个失败不影响其他
      const results = await Promise.allSettled(
        articleEntities.map((a) => articleService.saveArticle(a)),
      )
      const success = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - success
      setResult({ success, failed })
      // 2 秒后自动关闭模态框
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
      autoCloseTimerRef.current = setTimeout(() => {
        handleClose()
      }, AUTO_CLOSE_MS)
    } catch (err) {
      logger.warn('[ImportArticlesModal] 批量导入失败', err)
      setError(err instanceof Error ? err.message : t('reading.import.import_failed'))
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
      aria-label={t('reading.import.title')}
    >
      {/* Modal 主体：阻止点击事件冒泡 */}
      <div
        ref={dialogRef}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('reading.import.title')}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label={t('reading.close')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 文本域 */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={t('reading.import.text_placeholder')}
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
            {t('reading.import.parse')}
          </button>
        </div>

        {/* 预览区 */}
        {articles.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              {t('reading.import.preview_count', { count: articles.length })}
            </div>
            <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3 dark:border-gray-700">
              {articles.map((a, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-700/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {a.title}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {t('reading.words_count', { count: a.wordCount })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveArticle(idx)}
                    className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                    aria-label={t('reading.import.remove_article', { title: a.title })}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 导入结果 */}
        {result && (
          <div className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
            {t('reading.import.result', { success: result.success, failed: result.failed })}
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
            {t('reading.cancel')}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={articles.length === 0 || importing}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              articles.length === 0 || importing
                ? 'cursor-not-allowed bg-indigo-400 dark:bg-indigo-400/70'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600',
            )}
          >
            {importing ? t('reading.import.importing') : t('reading.import.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
