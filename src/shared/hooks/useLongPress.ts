// 长按手势 hook：触摸 / 鼠标长按触发，滑动取消，并与后续 click 互斥
//
// 典型场景：移动端卡片长按弹出自定义操作菜单（需同时阻止文本选择菜单与滚动误触）。
import { useEffect, useRef } from 'react'
import type { MouseEvent, TouchEvent } from 'react'

// 长按触发延迟（毫秒）
const DEFAULT_DELAY = 500
// 触摸滑动阈值（像素），超过则取消长按（避免滚动时误触）
const LONG_PRESS_MOVE_THRESHOLD = 10

export interface LongPressHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchEnd: () => void
  onTouchMove: (e: TouchEvent) => void
  onMouseDown: () => void
  onMouseUp: () => void
  onMouseLeave: () => void
  onClickCapture: (e: MouseEvent) => void
  onContextMenu: (e: MouseEvent) => void
}

interface UseLongPressOptions {
  onLongPress: () => void
  delay?: number
}

export function useLongPress({
  onLongPress,
  delay = DEFAULT_DELAY,
}: UseLongPressOptions): LongPressHandlers {
  // 始终读取最新回调，避免闭包陈旧
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress

  // 长按计时器
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 触摸结束后的标志重置定时器（卸载时清理，避免定时器悬空）
  const touchEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 长按是否已触发（用于与单击互斥，拦截后续合成 click 事件）
  const longPressTriggeredRef = useRef(false)
  // 触摸起始坐标（用于判断是否滑动）
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)
  // 是否为触摸交互（用于忽略触摸后合成的鼠标事件，避免重复触发）
  const isTouchEventRef = useRef(false)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const startLongPressTimer = () => {
    clearLongPressTimer()
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      callbackRef.current()
    }, delay)
  }

  // 卸载时清理所有定时器，避免内存泄漏与对已卸载组件 setState
  useEffect(() => {
    return () => {
      clearLongPressTimer()
      if (touchEndTimerRef.current) clearTimeout(touchEndTimerRef.current)
    }
  }, [])

  const handleTouchStart = (e: TouchEvent) => {
    isTouchEventRef.current = true
    const touch = e.touches[0]
    if (!touch) return
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY }
    startLongPressTimer()
  }

  const handleTouchEnd = () => {
    clearLongPressTimer()
    // 延迟重置触摸标志，确保合成鼠标事件被忽略
    if (touchEndTimerRef.current) clearTimeout(touchEndTimerRef.current)
    touchEndTimerRef.current = setTimeout(() => {
      isTouchEventRef.current = false
      touchEndTimerRef.current = null
    }, delay)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!touchStartPosRef.current) return
    const touch = e.touches[0]
    if (!touch) return
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y)
    // 滑动超过阈值视为滚动，取消长按
    if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
      clearLongPressTimer()
    }
  }

  const handleMouseDown = () => {
    if (isTouchEventRef.current) return
    startLongPressTimer()
  }

  const handleMouseUp = () => {
    if (isTouchEventRef.current) return
    clearLongPressTimer()
  }

  const handleMouseLeave = () => {
    if (isTouchEventRef.current) return
    clearLongPressTimer()
  }

  // 捕获阶段拦截点击：若长按已触发，则阻止后续 click（与单击互斥）
  const handleClickCapture = (e: MouseEvent) => {
    if (longPressTriggeredRef.current) {
      e.preventDefault()
      e.stopPropagation()
      longPressTriggeredRef.current = false
    }
  }

  // 阻止原生上下文菜单（移动端长按会触发文本选择菜单，干扰自定义菜单）
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
  }

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove,
    onMouseDown: handleMouseDown,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseLeave,
    onClickCapture: handleClickCapture,
    onContextMenu: handleContextMenu,
  }
}
