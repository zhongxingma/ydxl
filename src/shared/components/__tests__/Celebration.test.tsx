// Celebration 庆祝动画组件单元测试
//
// 覆盖场景：
// 1. visible=false 时不渲染
// 2. visible=true 时渲染 30-50 个纸片、10-15 个星星、关键帧样式与反馈文案
// 3. 3 秒后调用 onComplete；onComplete 变化不重置定时器
// 4. 动画结束前隐藏 / 卸载会清除定时器
// 5. 未提供 onComplete 时到点不报错
//
// 环境依赖：随机数量使用真实 Math.random（断言区间）；定时器使用 fake timers
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import Celebration from '../Celebration'

describe('Celebration 庆祝动画', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('visible 为 false 时不渲染任何内容', () => {
    const { container } = render(<Celebration visible={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('visible 为 true 时渲染纸片、星星、关键帧与反馈文案', () => {
    const { container } = render(<Celebration visible text="太棒了！" />)

    const confetti = container.querySelectorAll('div.h-3.w-2')
    const stars = container.querySelectorAll('div.text-2xl')
    expect(confetti.length).toBeGreaterThanOrEqual(30)
    expect(confetti.length).toBeLessThanOrEqual(50)
    expect(stars.length).toBeGreaterThanOrEqual(10)
    expect(stars.length).toBeLessThanOrEqual(15)

    expect(container.querySelector('style')?.textContent).toContain(
      'celebration-confetti-fall'
    )
    expect(container.querySelector('style')?.textContent).toContain(
      'celebration-star-twinkle'
    )
    expect(container.querySelector('p')?.textContent).toBe('太棒了！')
  })

  it('未提供文案时不渲染中心文字', () => {
    const { container } = render(<Celebration visible />)

    expect(container.querySelector('p')).toBeNull()
  })

  it('显示 3 秒后调用 onComplete', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()

    render(<Celebration visible onComplete={onComplete} />)
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalled()
  })

  it('onComplete 变化时不重置定时器，到点调用最新回调', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Celebration visible onComplete={first} />)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    rerender(<Celebration visible onComplete={second} />)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('动画结束前隐藏会清除定时器', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const { rerender } = render(<Celebration visible onComplete={onComplete} />)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    rerender(<Celebration visible={false} onComplete={onComplete} />)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('未提供 onComplete 时到点不报错', () => {
    vi.useFakeTimers()
    const { container } = render(<Celebration visible />)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(container.querySelectorAll('div.h-3.w-2').length).toBeGreaterThan(0)
  })
})
