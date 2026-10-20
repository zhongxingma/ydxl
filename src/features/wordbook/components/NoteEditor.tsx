// 编辑笔记 Modal 组件：弹窗中提供文本域编辑笔记，保存调用 wordbookService.updateNote
import { useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { wordbookService } from '../services/wordbookService'
import { useEscapeKey } from '@/shared/hooks/useEscapeKey'
import { cn } from '@/shared/utils/cn'

interface NoteEditorProps {
  // 待编辑笔记的生词，为 null 时不渲染
  word: Word | null
  // 关闭弹窗回调
  onClose: () => void
  // 保存成功后的回调（用于刷新列表）
  onSaved?: () => void
}

export default function NoteEditor({ word, onClose, onSaved }: NoteEditorProps) {
  // 本地编辑值（避免直接修改 store）
  const [value, setValue] = useState('')
  // 保存中状态
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 当 word 变化时同步初始值
  useEffect(() => {
    if (word) {
      setValue(word.note ?? '')
    }
  }, [word])

  // 打开时自动聚焦
  useEffect(() => {
    if (word && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [word])

  // 监听 Escape 关闭（word 非 null 时启用）
  useEscapeKey(onClose, !!word)

  // 未传入 word 时不渲染
  if (!word) return null

  // 保存笔记
  const handleSave = async () => {
    if (!word || saving) return
    setSaving(true)
    try {
      await wordbookService.updateNote(word.id, value)
      onSaved?.()
      onClose()
    } catch (err) {
      console.warn('[NoteEditor] 笔记保存失败', err)
      setSaving(false)
    }
  }

  return (
    // 遮罩层：点击空白处关闭
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="编辑笔记"
    >
      {/* Modal 主体：阻止点击事件冒泡 */}
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            编辑笔记
          </h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {word.word}
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="为这个单词添加笔记，例如：用法、搭配、易混淆点…"
          rows={5}
          className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors',
              saving
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
