// 通用徽章组件
// - 接收 label 与 color props，渲染带颜色的徽章
// - 用于"顽固词"、"已掌握"等标记
// - color 支持：gray / red / orange / amber / green / blue / indigo / purple

type BadgeColor =
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'blue'
  | 'indigo'
  | 'purple'

interface BadgeProps {
  // 徽章文案
  label: string
  // 徽章颜色，默认 gray
  color?: BadgeColor
  // 额外类名
  className?: string
}

// 颜色到 Tailwind 类名的映射
const COLOR_CLASSES: Record<BadgeColor, string> = {
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
  green: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300',
  purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300',
}

export default function Badge({ label, color = 'gray', className }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_CLASSES[color]} ${className ?? ''}`}
    >
      {label}
    </span>
  )
}
