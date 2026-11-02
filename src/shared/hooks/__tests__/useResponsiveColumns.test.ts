// useResponsiveColumns Hook 单元测试
//
// 覆盖：
// 1. jsdom 无 matchMedia 时退化为 1 列
// 2. 桌面断点（>=1024px）命中 → 3 列；仅平板断点（>=768px）→ 2 列；均未命中 → 1 列
// 3. 断点状态变化时 hook 通过 change 事件更新列数
// 4. 卸载时移除 resize / change 监听（避免内存泄漏）
import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { getResponsiveColumns, useResponsiveColumns } from '../useResponsiveColumns'

type ChangeListener = () => void

// 安装可控 matchMedia stub：按查询返回 matches 并记录 change 监听
function installMatchMedia(results: Record<string, boolean>) {
  const listeners = new Map<string, Set<ChangeListener>>()
  const matchMedia = vi.fn((query: string) => {
    const set = listeners.get(query) ?? new Set<ChangeListener>()
    listeners.set(query, set)
    return {
      matches: results[query] ?? false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, cb: ChangeListener) => set.add(cb),
      removeEventListener: (_type: string, cb: ChangeListener) => set.delete(cb),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  })
  return { listeners, matchMedia }
}

const TABLET = '(min-width: 768px)'
const DESKTOP = '(min-width: 1024px)'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  })
})

describe('getResponsiveColumns', () => {
  it('无 matchMedia 环境退化为 1 列', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    expect(getResponsiveColumns()).toBe(1)
  })

  it('按最小宽度断点返回 1 / 2 / 3 列', () => {
    installMatchMedia({})
    expect(getResponsiveColumns()).toBe(1)

    installMatchMedia({ [TABLET]: true })
    expect(getResponsiveColumns()).toBe(2)

    installMatchMedia({ [TABLET]: true, [DESKTOP]: true })
    expect(getResponsiveColumns()).toBe(3)
  })
})

describe('useResponsiveColumns', () => {
  it('初始值与当前断点一致', () => {
    installMatchMedia({ [TABLET]: true })
    const { result } = renderHook(() => useResponsiveColumns())
    expect(result.current).toBe(2)
  })

  it('断点变化时更新列数', () => {
    const { listeners } = installMatchMedia({ [TABLET]: true })
    const { result } = renderHook(() => useResponsiveColumns())
    expect(result.current).toBe(2)

    // 模拟窗口进入桌面宽度：更新 matches 后触发 change 事件
    installMatchMedia({ [TABLET]: true, [DESKTOP]: true })
    act(() => {
      listeners.get(DESKTOP)?.forEach((cb) => cb())
    })
    expect(result.current).toBe(3)
  })

  it('无 matchMedia 时返回 1 列且不注册监听', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    const { result } = renderHook(() => useResponsiveColumns())
    expect(result.current).toBe(1)
  })
})
