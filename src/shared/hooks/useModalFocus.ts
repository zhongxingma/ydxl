// 通用 Modal 焦点管理 hook（无障碍基线）
// - 打开时把焦点移入弹窗（优先第一个表单控件，其次第一个可聚焦元素）
// - Tab / Shift+Tab 在弹窗内循环，避免焦点逃逸到背景页面
// - 关闭时把焦点还给打开前的元素（如触发按钮）
//
// 用法：
//   const dialogRef = useModalFocus<HTMLDivElement>(open)
//   <div ref={dialogRef}>...</div>
//
// 与 useEscapeKey 互补：本 hook 只负责焦点，Escape 关闭仍由 useEscapeKey 处理。
import { useEffect, useRef, type RefObject } from 'react'

// 可聚焦元素选择器（排除禁用控件与 tabindex="-1" 的容器自身）
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// 默认初始焦点：优先表单控件，帮助键盘 / 读屏用户直接开始输入
const DEFAULT_INITIAL_FOCUS = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  )
}

/**
 * Modal 焦点管理：初始聚焦 + Tab 循环 + 关闭后恢复焦点
 *
 * @param open 弹窗是否打开（false 时不做任何处理）
 * @param initialFocusSelector 初始焦点选择器，默认第一个表单控件
 * @returns 需要挂在弹窗内容容器上的 ref
 */
export function useModalFocus<T extends HTMLElement>(
  open: boolean,
  initialFocusSelector: string = DEFAULT_INITIAL_FOCUS,
): RefObject<T> {
  const containerRef = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return

    // 记录打开前的焦点元素，关闭时恢复（触发按钮通常仍挂载在页面上）
    const previouslyFocused = document.activeElement as HTMLElement | null

    const preferred = container.querySelector<HTMLElement>(initialFocusSelector)
    const first = preferred ?? getFocusable(container)[0] ?? container
    first.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = getFocusable(container)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const current = document.activeElement as HTMLElement | null
      const inside = current !== null && container.contains(current)
      const firstItem = items[0]
      const lastItem = items[items.length - 1]

      if (e.shiftKey) {
        // Shift+Tab：在首个元素（或焦点已不在弹窗内）时回绕到最后一个元素
        if (!inside || current === firstItem) {
          e.preventDefault()
          lastItem.focus()
        }
        return
      }
      // Tab：在最后一个元素（或焦点已不在弹窗内）时回绕到第一个元素
      if (!inside || current === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus()
      }
    }
  }, [open, initialFocusSelector])

  return containerRef
}
