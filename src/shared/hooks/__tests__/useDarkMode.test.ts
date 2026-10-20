// useDarkMode Hook 单元测试
//
// 测试覆盖：
// 1. 初始状态从 localStorage 读取（'true' → true / 'false' → false）
// 2. toggle 切换状态并持久化到 localStorage
// 3. enable / disable 显式设置状态
// 4. 配额满场景：localStorage.setItem 抛出 QuotaExceededError 时不崩溃，state 仍正常更新
// 5. 隐私模式场景：localStorage.setItem 抛出 SecurityError 时不崩溃，state 仍正常更新
//
// 测试策略：
// - 使用 @testing-library/react 的 renderHook / act 渲染 hook
// - localStorage 使用 jsdom 提供的真实实现，每个用例前后清理
// - 通过 vi.spyOn(Storage.prototype, 'setItem') 模拟抛出异常
// - jsdom 未实现 window.matchMedia，通过 Object.defineProperty 提供 stub
//   （仅在 localStorage 无存储值时才会调用 matchMedia，预置存储值可避免触发）
//
// vitest globals 模式：describe / it / expect / vi / beforeEach / afterEach 均为全局

import { act, renderHook } from '@testing-library/react'
import { useDarkMode } from '../useDarkMode'

const DARK_MODE_STORAGE_KEY = 'ydxl-dark-mode'

// jsdom 未实现 window.matchMedia，提供最小 stub 避免初始化时抛错
// （当 localStorage 无存储值时 getInitialDarkMode 会调用 matchMedia）
const matchMediaStub = (matches: boolean) => ({
  matches,
  media: '',
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})

describe('useDarkMode', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // 默认提供 matchMedia stub（返回非 dark 偏好）
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => matchMediaStub(false)),
    })
  })

  afterEach(() => {
    if (setItemSpy) setItemSpy.mockRestore()
    localStorage.clear()
  })

  // ===== 1. 初始状态从 localStorage 读取 =====
  it("初始状态从 localStorage 读取 'true' 返回 true", () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'true')
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(true)
  })

  it("初始状态从 localStorage 读取 'false' 返回 false", () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'false')
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)
  })

  // ===== 2. toggle 切换状态并持久化 =====
  it('toggle 切换状态并持久化到 localStorage', () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'false')
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)

    act(() => {
      result.current.toggle()
    })
    expect(result.current.isDark).toBe(true)
    // useEffect 在 act 内已执行，验证持久化
    expect(localStorage.getItem(DARK_MODE_STORAGE_KEY)).toBe('true')
  })

  // ===== 3. enable / disable 显式设置 =====
  it('enable 设置为 true 并持久化', () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'false')
    const { result } = renderHook(() => useDarkMode())
    act(() => {
      result.current.enable()
    })
    expect(result.current.isDark).toBe(true)
    expect(localStorage.getItem(DARK_MODE_STORAGE_KEY)).toBe('true')
  })

  it('disable 设置为 false 并持久化', () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'true')
    const { result } = renderHook(() => useDarkMode())
    act(() => {
      result.current.disable()
    })
    expect(result.current.isDark).toBe(false)
    expect(localStorage.getItem(DARK_MODE_STORAGE_KEY)).toBe('false')
  })

  // ===== 4. 配额满场景：QuotaExceededError 不崩溃 =====
  it('配额满时 toggle 不崩溃且 state 仍正常更新', () => {
    // 预置初始值（避免初始化触发 matchMedia）
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'false')
    // mock setItem 抛出 QuotaExceededError（与浏览器配额满时行为一致）
    setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })
    // 捕获 console.warn 验证 dev 环境输出警告日志（vitest 默认注入 DEV=true）
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)

    // toggle 应不抛错（try/catch 降级），state 仍正常切换
    act(() => {
      result.current.toggle()
    })
    expect(result.current.isDark).toBe(true)
    // 验证 dev 警告已输出（含模块标识便于排查）
    expect(warnSpy).toHaveBeenCalledWith(
      '[useDarkMode] localStorage 写入失败，降级为内存模式',
      expect.any(DOMException),
    )

    // 再次 toggle 回 false，验证多次切换稳定
    act(() => {
      result.current.toggle()
    })
    expect(result.current.isDark).toBe(false)

    warnSpy.mockRestore()
  })

  // ===== 5. 隐私模式场景：SecurityError 不崩溃 =====
  it('隐私模式（SecurityError）时 toggle 不崩溃且 state 仍正常更新', () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'false')
    setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException(
          'Access is denied for this document',
          'SecurityError',
        )
      })

    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)

    act(() => {
      result.current.enable()
    })
    expect(result.current.isDark).toBe(true)

    act(() => {
      result.current.disable()
    })
    expect(result.current.isDark).toBe(false)
  })

  // ===== 6. 配额满时 dark class 仍同步到 <html>（持久化失败不影响 DOM 同步） =====
  it('配额满时 dark class 仍同步到 documentElement', () => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, 'false')
    setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })

    const { result } = renderHook(() => useDarkMode())
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      result.current.enable()
    })
    // state 更新触发 useEffect，dark class 应已添加（即使持久化失败）
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
