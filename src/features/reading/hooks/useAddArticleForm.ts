// 添加文章表单逻辑：字段状态、AI 翻译、保存与关闭清理
//
// 从 AddArticleModal 抽离，视图组件只负责渲染表单字段与外壳。
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { articleService } from '../services/articleService'
import { aiProvider } from '@/shared/services/ai'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Article, Difficulty, Genre, Topic } from '@/shared/types'

// 正文最小字符数（低于此长度不允许保存）
export const MIN_CONTENT_LENGTH = 50
// 保存成功后自动关闭模态框的延时（毫秒）
const SUCCESS_AUTO_CLOSE_MS = 1000
// 翻译进度提示文案
export const TRANSLATION_HINTS = [
  '正在分析正文...',
  '调用深度思考模式...',
  '生成初稿翻译...',
  '优化译文流畅度...',
  '正在润色翻译结果...',
]

export function useAddArticleForm(open: boolean, onClose: () => void) {
  const { t } = useTranslation()
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
      logger.warn('[AddArticleModal] AI 翻译失败', err)
      setError(err instanceof Error ? err.message : t('reading.add_form.ai_translate_failed'))
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
      setToast(t('reading.add_form.added'))
      // 1 秒后自动关闭模态框
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
      autoCloseTimerRef.current = setTimeout(() => {
        handleClose()
      }, SUCCESS_AUTO_CLOSE_MS)
    } catch (err) {
      logger.warn('[AddArticleModal] 保存失败', err)
      setError(err instanceof Error ? err.message : t('reading.add_form.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  // 是否可展示 AI 补全按钮：英文正文长度 >= 50 且翻译为空
  const canShowAITranslate =
    content.trim().length >= MIN_CONTENT_LENGTH && !translation.trim()

  // 是否允许保存
  const canSave = Boolean(title.trim()) && content.trim().length >= MIN_CONTENT_LENGTH && !saving

  return {
    title,
    setTitle,
    content,
    setContent,
    translation,
    setTranslation,
    genre,
    setGenre,
    topic,
    setTopic,
    difficulty,
    setDifficulty,
    translating,
    translationHintIndex,
    saving,
    error,
    toast,
    canShowAITranslate,
    canSave,
    handleAITranslate,
    handleSave,
    handleClose,
  }
}

export type AddArticleFormState = ReturnType<typeof useAddArticleForm>
