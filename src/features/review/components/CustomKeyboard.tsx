// 简化自定义键盘组件（仅 26 字母 + 退格）
// 用于拼写环节移动端输入：可高亮"可能包含的字母"辅助提示
// 桌面端可继续使用原生 input，本组件作为可选输入与提示展示
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'

interface CustomKeyboardProps {
  // 按键回调，传入字母
  onKeyPress: (letter: string) => void
  // 退格回调
  onBackspace: () => void
  // 需高亮的字母集合（小写），基于已显示的提示字母推断
  highlightedLetters?: Set<string>
  // 是否禁用
  disabled?: boolean
}

// QWERTY 键盘布局
const KEYBOARD_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

export default function CustomKeyboard({
  onKeyPress,
  onBackspace,
  highlightedLetters,
  disabled = false,
}: CustomKeyboardProps) {
  const { t } = useTranslation()
  return (
    <div className="select-none space-y-1.5" aria-label={t('review.keyboard.label')}>
      {KEYBOARD_ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex justify-center gap-1.5">
          {/* 第三行前留白对齐 */}
          {rowIdx === 2 && <span className="w-4" aria-hidden="true" />}
          {row.map((letter) => {
            const isHighlighted = highlightedLetters?.has(letter) ?? false
            return (
              <button
                key={letter}
                type="button"
                disabled={disabled}
                onClick={() => onKeyPress(letter)}
                className={cn(
                  'h-9 w-7 rounded-md text-sm font-medium uppercase transition-colors sm:h-10 sm:w-9',
                  disabled && 'cursor-not-allowed opacity-50',
                  isHighlighted
                    ? 'bg-green-100 text-green-700 ring-1 ring-green-400 dark:bg-green-900/40 dark:text-green-300 dark:ring-green-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600',
                )}
                aria-label={t('review.keyboard.key', { letter })}
              >
                {letter}
              </button>
            )
          })}
          {/* 第三行末尾加退格键 */}
          {rowIdx === 2 && (
            <button
              key="backspace"
              type="button"
              disabled={disabled}
              onClick={onBackspace}
              className="h-9 rounded-md bg-gray-100 px-2 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 sm:h-10"
              aria-label={t('review.keyboard.backspace')}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
