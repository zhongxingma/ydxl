// 添加文章 Modal：手动录入单篇自有文章，支持 AI 补全中文翻译
// - 表单字段：标题 / 英文正文 / 中文翻译 / 文体 / 题材 / 难度
// - AI 补全翻译：英文正文长度 >= 50 且翻译为空时可用，失败不阻塞手动输入
// - 保存成功后展示 toast「已添加」并自动关闭模态框
import { useCallback, useEffect, useRef, useState } from 'react'
import { articleService } from '../services/articleService'
import { aiProvider } from '@/shared/services/ai'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import type { Article, Difficulty, Genre, Topic } from '@/shared/types'
import { cn } from '@/shared/utils/cn'

interface AddArticleModalProps {
  // 是否打开
  open: boolean
  // 关闭回调
  onClose: () => void
}

// 正文最小字符数（低于此长度不允许保存）
const MIN_CONTENT_LENGTH = 50
// 保存成功后自动关闭模态框的延时（毫秒）
const SUCCESS_AUTO_CLOSE_MS = 1000
// 翻译进度提示文案
const TRANSLATION_HINTS = [
  '正在分析正文...',
  '调用深度思考模式...',
  '生成初稿翻译...',
  '优化译文流畅度...',
  '正在润色翻译结果...',
]

// 文体选项
const GENRE_OPTIONS: { value: Genre; label: string }[] = [
  { value: 'narrative', label: '记叙文' },
  { value: 'expository', label: '说明文' },
  { value: 'practical', label: '应用文' },
]

// 题材选项
const TOPIC_OPTIONS: { value: Topic; label: string }[] = [
  { value: 'campus', label: '校园' },
  { value: 'science', label: '科学' },
  { value: 'culture', label: '文化' },
  { value: 'biography', label: '人物传记' },
  { value: 'travel', label: '旅行' },
  { value: 'sports', label: '体育' },
  { value: 'technology', label: '科技' },
  { value: 'nature', label: '自然' },
]

// 难度选项
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
]

export default function AddArticleModal({ open, onClose }: AddArticleModalProps) {
  // 表单字段
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [translation, setTranslation] = useState('')
  const [genre, setGenre] = useState<Genre>('narrative')
  const [topic, setTopic] = useState<Topic>('campus')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  // 交互状态
  const [translating, setTranslating] = useState(false)
  const [translationHintIndex, setTranslationHintIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  // 自动关闭定时器引用
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 重置所有表单字段
  const resetForm = useCallback(() => {
    setTitle('')
    setContent('')
    setTranslation('')
    setGenre('narrative')
    setTopic('campus')
    setDifficulty('medium')
    setError('')
    setToast('')
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

  // AI 补全翻译：调用 aiProvider.generateTranslation 生成中文翻译填充到输入框
  // 失败时仅展示错误提示，不阻塞用户手动输入
  const handleAITranslate = async () => {
    const trimmed = content.trim()
    if (trimmed.length < MIN_CONTENT_LENGTH || translating) return
    setTranslating(true)
    setTranslationHintIndex(0)
    setError('')
    
    // 启动进度提示定时器
    const hintInterval = setInterval(() => {
      setTranslationHintIndex((prev) => (prev + 1) % TRANSLATION_HINTS.length)
    }, 4000)

    try {
      const result = await aiProvider.generateTranslation(trimmed)
      setTranslation(result)
    } catch (err) {
      console.warn('[AddArticleModal] AI 翻译失败', err)
      setError(err instanceof Error ? err.message : 'AI 翻译失败，可手动填写')
    } finally {
      clearInterval(hintInterval)
      setTranslating(false)
    }
  }

  // 保存文章：构造完整 Article 对象调用 articleService.saveArticle
  // 成功后展示 toast「已添加」，1 秒后自动关闭模态框
  const handleSave = async () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!trimmedTitle || trimmedContent.length < MIN_CONTENT_LENGTH || saving) return
    setSaving(true)
    setError('')
    try {
      const now = Date.now()
      const article: Article = {
        id: `user-${now}`,
        title: trimmedTitle,
        content: trimmedContent,
        translation: translation.trim(),
        genre,
        topic,
        difficulty,
        wordCount: trimmedContent.split(/\s+/).filter(Boolean).length,
        lexileRange: { min: 600, max: 800 },
        highlightedWords: [],
        createdAt: now,
        updated_at: now,
        readAt: null,
        startedAt: null,
      }
      await articleService.saveArticle(article)
      setToast('已添加')
      // 1 秒后自动关闭模态框
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
      autoCloseTimerRef.current = setTimeout(() => {
        handleClose()
      }, SUCCESS_AUTO_CLOSE_MS)
    } catch (err) {
      console.warn('[AddArticleModal] 保存失败', err)
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  // 是否可展示 AI 补全按钮：英文正文长度 >= 50 且翻译为空
  const canShowAITranslate =
    content.trim().length >= MIN_CONTENT_LENGTH && !translation.trim()

  // 输入框通用样式
  const inputCls =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500'

  return (
    // 遮罩层：点击空白处关闭
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="添加文章"
    >
      {/* Modal 主体：阻止点击事件冒泡 */}
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            添加文章
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="关闭"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单字段 */}
        <div className="space-y-4">
          {/* 标题（必填） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="请输入文章标题"
              className={inputCls}
            />
          </div>

          {/* 英文正文（必填） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              英文正文 <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                （至少 {MIN_CONTENT_LENGTH} 字符，当前 {content.trim().length} 字符）
              </span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder="请输入英文正文（至少 50 字符）"
              className={cn(inputCls, 'resize-y')}
            />
          </div>

          {/* 中文翻译（可选） */}
          <div className="relative">
            <label className="mb-1 flex flex-wrap items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              中文翻译
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                （可选，可点击下方 AI 补全）
              </span>
              {/* AI 来源徽章：翻译由哪个 AI 接口生成 */}
              <AIProviderBadge scenario="translation" />
            </label>
            <div className="relative">
              <textarea
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                rows={8}
                placeholder="请输入中文翻译（可选，可点击下方 AI 补全）"
                className={cn(inputCls, 'resize-y', translating && 'opacity-50')}
              />
              {translating && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border border-indigo-200 bg-white/50 p-4 text-center dark:border-indigo-800 dark:bg-gray-800/50">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                    {TRANSLATION_HINTS[translationHintIndex]}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* AI 补全翻译按钮：英文正文 >= 50 且翻译为空时显示 */}
          {canShowAITranslate && (
            <button
              type="button"
              onClick={handleAITranslate}
              disabled={translating}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                translating
                  ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50',
              )}
            >
              {translating ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  <span>AI 翻译中…</span>
                </>
              ) : (
                'AI 补全翻译'
              )}
            </button>
          )}

          {/* 文体 / 题材 / 难度 三列布局 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* 文体（可选） */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                文体
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value as Genre)}
                className={inputCls}
              >
                {GENRE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 题材（可选） */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                题材
              </label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value as Topic)}
                className={inputCls}
              >
                {TOPIC_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 难度（可选） */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                难度
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className={inputCls}
              >
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 错误提示：失败时不关闭模态框，让用户重试 */}
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* 成功 toast */}
          {toast && (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
              {toast}
            </div>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!title.trim() || content.trim().length < MIN_CONTENT_LENGTH || saving}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              !title.trim() || content.trim().length < MIN_CONTENT_LENGTH || saving
                ? 'cursor-not-allowed bg-indigo-400 dark:bg-indigo-400/70'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600',
            )}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
