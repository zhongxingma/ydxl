// useLongPress 单元测试
//
// 覆盖场景：
// 1. 鼠标长按达到延迟后触发回调
// 2. 提前抬起 / 移出取消长按
// 3. 触摸滑动超过阈值取消长按
// 4. 长按触发后拦截后续 click
// 5. 触摸结束后短时间内忽略合成的鼠标事件
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MouseEvent, TouchEvent } from 'react'
import { useLongPress } from '../useLongPress'

function touchEvent(x: number, y: number): TouchEvent {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as TouchEvent
}

function mouseEvent(): MouseEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent
}

describe('useLongPress', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('鼠标长按达到 500ms 后触发回调', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))

    act(() => result.current.onMouseDown())
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(onLongPress).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('提前抬起或移出时取消长按', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))

    act(() => result.current.onMouseDown())
    act(() => result.current.onMouseUp())
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onLongPress).not.toHaveBeenCalled()

    act(() => result.current.onMouseDown())
    act(() => result.current.onMouseLeave())
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('触摸滑动超过阈值时取消长按', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))

    act(() => result.current.onTouchStart(touchEvent(0, 0)))
    act(() => result.current.onTouchMove(touchEvent(20, 0)))
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('长按触发后拦截后续 click', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))

    act(() => result.current.onMouseDown())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)

    const click = mouseEvent()
    act(() => result.current.onClickCapture(click))
    expect(click.preventDefault).toHaveBeenCalled()
    expect(click.stopPropagation).toHaveBeenCalled()
  })

  it('触摸结束后的鼠标事件被忽略', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))

    act(() => result.current.onTouchStart(touchEvent(0, 0)))
    act(() => result.current.onTouchEnd())
    // 触摸标志尚未重置（500ms 延迟），合成的 mouseDown 应被忽略
    act(() => result.current.onMouseDown())
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('阻止原生上下文菜单', () => {
    const { result } = renderHook(() => useLongPress({ onLongPress: vi.fn() }))
    const menu = mouseEvent()
    act(() => result.current.onContextMenu(menu))
    expect(menu.preventDefault).toHaveBeenCalled()
  })
})
