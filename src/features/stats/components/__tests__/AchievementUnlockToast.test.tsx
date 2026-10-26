// AchievementUnlockToast 成就解锁提示单元测试
//
// 覆盖场景：
// 1. 无成就时不渲染任何内容
// 2. 多个成就的图标 / 名称 / 描述 / 标题渲染
// 3. 3 秒后自动调用 onClose
// 4. onClose 变化后使用最新回调
// 5. 成就数量变化时重置计时器
// 6. 卸载时清理计时器，不再触发回调
//
// 环境依赖：使用假定时器精确控制 3 秒自动关闭。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { Achievement } from '@/shared/types'
import AchievementUnlockToast from '../AchievementUnlockToast'

function makeAchievement(
  id: string,
  overrides: Partial<Achievement> = {}
): Achievement {
  return {
    id,
    updated_at: Date.now(),
    name: `成就 ${id}`,
    description: `描述 ${id}`,
    icon: '⭐',
    unlockedAt: Date.now(),
    ...overrides,
  }
}

describe('AchievementUnlockToast 成就解锁提示', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('无成就时不渲染任何内容', () => {
    const { container } = render(
      <AchievementUnlockToast achievements={[]} onClose={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('渲染多个成就的图标、名称、描述与解锁标题', () => {
    render(
      <AchievementUnlockToast
        achievements={[
          makeAchievement('a', { icon: '🏆', name: '阅读之星', description: '读完 10 篇' }),
          makeAchievement('b', { icon: '🎯', name: '全对达人', description: '答题全对' }),
        ]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('阅读之星')).toBeInTheDocument()
    expect(screen.getByText('读完 10 篇')).toBeInTheDocument()
    expect(screen.getByText('🏆')).toBeInTheDocument()
    expect(screen.getByText('全对达人')).toBeInTheDocument()
    expect(screen.getByText('答题全对')).toBeInTheDocument()
    expect(screen.getByText('🎯')).toBeInTheDocument()
    expect(screen.getAllByText('成就解锁')).toHaveLength(2)
  })

  it('3 秒后自动调用 onClose', () => {
    const onClose = vi.fn()
    render(
      <AchievementUnlockToast
        achievements={[makeAchievement('a')]}
        onClose={onClose}
      />
    )

    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('回调变化后使用最新的 onClose', () => {
    const first = vi.fn()
    const second = vi.fn()
    const achievement = makeAchievement('a')
    const { rerender } = render(
      <AchievementUnlockToast achievements={[achievement]} onClose={first} />
    )

    rerender(
      <AchievementUnlockToast achievements={[achievement]} onClose={second} />
    )

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('成就数量变化时重置计时器', () => {
    const onClose = vi.fn()
    const first = makeAchievement('a')
    const { rerender } = render(
      <AchievementUnlockToast achievements={[first]} onClose={onClose} />
    )

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    rerender(
      <AchievementUnlockToast
        achievements={[first, makeAchievement('b')]}
        onClose={onClose}
      />
    )

    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('卸载时清理计时器，不再触发回调', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <AchievementUnlockToast
        achievements={[makeAchievement('a')]}
        onClose={onClose}
      />
    )

    unmount()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(onClose).not.toHaveBeenCalled()
  })
})
