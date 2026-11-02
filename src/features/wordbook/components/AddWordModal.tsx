// 添加单词 Modal：手动录入单个生词，支持 AI 补全音标/词性/释义/例句
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useState } from 'react'
import { wordbookService } from '../services/wordbookService'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { useModalFocus } from '@/shared/hooks/useModalFocus'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'

interface AddWordModalProps {
  // 是否打开
  open: boolean
  // 关闭回调
  onClose: () => void
}

// 词性下拉选项
const POS_OPTIONS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.']

export default function AddWordModal({ open, onClose }: AddWordModalProps) {
  // 国际化文案
  const { t } = useTranslation()
  // 表单字段
  const [word, setWord] = useState('')
  const [phonetic, setPhonetic] = useState('')
  const [pos, setPos] = useState('')
  const [definition, setDefinition] = useState('')
  const [example, setExample] = useState('')
  // 交互状态
  const [enriching, setEnriching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 重置所有表单字段
  const resetForm = useCallback(() => {
    setWord('')
    setPhonetic('')
    setPos('')
    setDefinition('')
    setExample('')
    setError('')
  }, [])

  // 关闭并重置（在调用 onClose 前清空字段）
  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  // 监听 Escape 关闭 + 锁定背景滚动
  useEscapeKey(handleClose, open)
  // 焦点管理：打开时聚焦首个输入框，Tab 在弹窗内循环，关闭后焦点回到触发按钮
  const dialogRef = useModalFocus<HTMLDivElement>(open)
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // open 为 false 时不渲染
  if (!open) return null

  // AI 补全：先保存基础记录（含 enrichIfMissing 双保险），再显式调用 enrichWord 填充表单
  const handleEnrich = async () => {
    const trimmed = word.trim()
    if (!trimmed || enriching) return
    setEnriching(true)
    setError('')
    try {
      // a. 保存基础记录；enrichIfMissing: true 让 addToWordbook 内部也触发 AI 补全（双保险）
      //    addToWordbook 内部会转小写作为 id
      await wordbookService.addToWordbook({ word: trimmed, enrichIfMissing: true })
      // b. 显式调用 AI 补全（参数为小写 wordId），若内部已补全则直接返回
      const enriched = await wordbookService.enrichWord(trimmed.toLowerCase())
      // c. 用返回数据填充输入框
      if (enriched.phonetic) setPhonetic(enriched.phonetic)
      if (enriched.pos) setPos(enriched.pos)
      if (enriched.definition) setDefinition(enriched.definition)
      if (enriched.example) setExample(enriched.example)
    } catch (err) {
      // d. 失败时显示错误提示，不阻塞用户继续手动编辑
      logger.warn('[AddWordModal] AI 补全失败', err)
      setError(err instanceof Error ? err.message : t('wordbook.add_modal.ai_enrich_failed'))
    } finally {
      setEnriching(false)
    }
  }

  // 保存
  const handleSave = async () => {
    const trimmed = word.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      await wordbookService.addToWordbook({
        word: trimmed,
        phonetic: phonetic.trim(),
        pos: pos.trim(),
        definition: definition.trim(),
        example: example.trim(),
        enrichIfMissing: true,
      })
      handleClose()
    } catch (err) {
      logger.warn('[AddWordModal] 保存失败', err)
      setError(err instanceof Error ? err.message : t('wordbook.add_modal.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    // 遮罩层：点击空白处关闭
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('wordbook.add_modal.title')}
    >
      {/* Modal 主体：阻止点击事件冒泡 */}
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('wordbook.add_modal.title')}
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

        {/* 表单字段 */}
        <div className="space-y-4">
          {/* 单词（必填） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('wordbook.add_modal.word_label')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              maxLength={50}
              pattern="[a-zA-Z]+"
              placeholder={t('wordbook.add_modal.word_placeholder')}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          {/* AI 补全按钮：单词非空且未在补全中时可用 */}
          <button
            type="button"
            onClick={handleEnrich}
            disabled={!word.trim() || enriching}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              !word.trim() || enriching
                ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50',
            )}
          >
            {enriching ? t('wordbook.add_modal.ai_enriching') : t('wordbook.ai_enrich')}
          </button>

          {/* 音标（可选） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('wordbook.add_modal.phonetic_label')}
            </label>
            <input
              type="text"
              value={phonetic}
              onChange={(e) => setPhonetic(e.target.value)}
              placeholder={t('wordbook.add_modal.phonetic_placeholder')}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          {/* 词性（可选） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('wordbook.add_modal.pos_label')}
            </label>
            <select
              value={pos}
              onChange={(e) => setPos(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">{t('wordbook.add_modal.optional')}</option>
              {POS_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* 释义（可选） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('wordbook.add_modal.definition_label')}
            </label>
            <input
              type="text"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder={t('wordbook.add_modal.definition_placeholder')}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          {/* 例句（可选） */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('wordbook.add_modal.example_label')}
            </label>
            <textarea
              value={example}
              onChange={(e) => setExample(e.target.value)}
              rows={3}
              placeholder={t('wordbook.add_modal.example_placeholder')}
              className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          {/* 错误提示：失败时不关闭模态框，让用户重试 */}
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
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
            {t('wordbook.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!word.trim() || saving}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              !word.trim() || saving
                ? 'cursor-not-allowed bg-indigo-400 dark:bg-indigo-400/70'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600',
            )}
          >
            {saving ? t('wordbook.saving') : t('wordbook.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
