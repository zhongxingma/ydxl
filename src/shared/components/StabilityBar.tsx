// 记忆稳固度进度条组件
// - 显示 0-100 的稳固度，颜色梯度：红 → 黄 → 绿
// - 支持 SVG 与 div 两种渲染方式，此处使用 div + 渐变实现
// - 纯展示组件，无业务依赖，供 review/wordbook 等模块共享
import { cn } from '@/shared/utils/cn'

interface StabilityBarProps {
  // 稳固度分数 0-100
  score: number
  // 是否显示数值标签，默认 true
  showLabel?: boolean
  // 额外类名
  className?: string
}

// 根据分数返回进度条颜色（红 → 黄 → 绿 梯度）
function getBarColor(score: number): string {
  if (score >= 80) {
    // 绿色：稳固度高
    return 'bg-green-500 dark:bg-green-400'
  }
  if (score >= 50) {
    // 黄色：稳固度中等
    return 'bg-amber-500 dark:bg-amber-400'
  }
  if (score >= 25) {
    // 橙色：稳固度较低
    return 'bg-orange-500 dark:bg-orange-400'
  }
  // 红色：稳固度很低
  return 'bg-red-500 dark:bg-red-400'
}

// 根据分数返回标签文案
function getLabel(score: number): string {
  if (score >= 80) return '稳固'
  if (score >= 50) return '学习中'
  if (score >= 25) return '薄弱'
  return '待巩固'
}

export default function StabilityBar({ score, showLabel = true, className }: StabilityBarProps) {
  // 限制在 0-100 之间
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const barColor = getBarColor(clamped)

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          记忆稳固度
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {showLabel ? `${getLabel(clamped)} · ` : ''}{clamped}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="记忆稳固度"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', barColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
