// 复习特性模块的类型定义
// 复用 @/shared/types 中的 ReviewStep，避免重复定义
export type { ReviewStep } from '@/shared/types'

// 单步结果：是否正确、正确率、用时（秒）
export interface StepResult {
  correct: boolean
  correctRate: number
  timeSpent: number
}

// 步骤显示顺序
export const STEP_ORDER = ['learn', 'read', 'practice', 'spell', 'write'] as const

// 步骤中文名映射
export const STEP_LABEL: Record<string, string> = {
  learn: '识记',
  read: '朗读',
  practice: '练习',
  spell: '拼写',
  write: '默写',
}

// 获取下一步：learn → read → practice → spell → write
export function getNextStep(step: string): string | null {
  const idx = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number])
  if (idx < 0 || idx >= STEP_ORDER.length - 1) return null
  return STEP_ORDER[idx + 1]
}
