// 翻译显示模式切换组件
// 在"纯英文" / "段落对照" / "按句显示" / "逐句切换" 四种模式间切换
import clsx from 'clsx'
import type { TranslationMode } from '../types'

interface TranslationToggleProps {
  mode: TranslationMode
  onChange: (mode: TranslationMode) => void
}

// 四种模式选项配置
const OPTIONS: { value: TranslationMode; label: string }[] = [
  { value: 'english', label: '纯英文' },
  { value: 'paragraph', label: '段落对照' },
  { value: 'sentence', label: '按句显示' },
  { value: 'toggle', label: '逐句切换' },
]

export default function TranslationToggle({ mode, onChange }: TranslationToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="翻译显示模式"
      className="inline-flex rounded-md border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-800"
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
