// className 合并工具：结合 clsx（条件拼接）与 tailwind-merge（解决 Tailwind 类名冲突）
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// 合并多个 className，自动处理条件类名与 Tailwind 冲突
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
