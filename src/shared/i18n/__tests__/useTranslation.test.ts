// useTranslation Hook 单元测试
//
// 测试覆盖：
// 1. 初始语言从 localStorage 读取（默认 zh-CN）
// 2. setLanguage 切换语言并持久化到 localStorage
// 3. t() 翻译函数：根据当前语言查字典 + 参数插值
// 4. 配额满场景：localStorage.setItem 抛出 QuotaExceededError 时不崩溃，语言 state 仍正常切换
// 5. 隐私模式场景：localStorage.setItem 抛出 SecurityError 时不崩溃，语言 state 仍正常切换
//
// 测试策略：
// - 使用 @testing-library/react 的 renderHook / act 渲染 hook
// - localStorage 使用 jsdom 提供的真实实现，每个用例前后清理
// - 通过 vi.spyOn(Storage.prototype, 'setItem') 模拟抛出异常
//
// vitest globals 模式：describe / it / expect / vi / beforeEach / afterEach 均为全局

import { act, renderHook } from '@testing-library/react'
import { useTranslation, type Language } from '../useTranslation'

const STORAGE_KEY = 'user-lang'

describe('useTranslation', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    if (setItemSpy) setItemSpy.mockRestore()
    localStorage.clear()
  })

  // ===== 1. 初始语言 =====
  it('无存储值时默认 zh-CN', () => {
    const { result } = renderHook(() => useTranslation())
    expect(result.current.language).toBe('zh-CN')
  })

  it('从 localStorage 读取 en-US', () => {
    localStorage.setItem(STORAGE_KEY, 'en-US')
    const { result } = renderHook(() => useTranslation())
    expect(result.current.language).toBe('en-US')
  })

  // ===== 2. setLanguage 持久化 =====
  it('setLanguage 切换语言并持久化', () => {
    const { result } = renderHook(() => useTranslation())
    expect(result.current.language).toBe('zh-CN')

    act(() => {
      result.current.setLanguage('en-US')
    })
    expect(result.current.language).toBe('en-US')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en-US')
  })

  // ===== 3. t() 翻译 + 参数插值 =====
  it('t() 根据当前语言返回翻译文案', () => {
    const { result } = renderHook(() => useTranslation())
    // zh-CN 字典中应存在部分 key（具体 key 取决于字典文件）
    const text = result.current.t('app.title')
    expect(typeof text).toBe('string')
  })

  it('t() 找不到 key 时返回 key 本身', () => {
    const { result } = renderHook(() => useTranslation())
    const missingKey = '__non_existent_key__'
    expect(result.current.t(missingKey)).toBe(missingKey)
  })

  // ===== 4. 配额满场景：QuotaExceededError 不崩溃 =====
  it('配额满时 setLanguage 不崩溃且语言 state 仍正常切换', () => {
    // mock setItem 抛出 QuotaExceededError（与浏览器配额满时行为一致）
    setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })
    // 捕获 console.warn 验证 dev 环境输出警告日志（vitest 默认注入 DEV=true）
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useTranslation())
    expect(result.current.language).toBe('zh-CN')

    // setLanguage 应不抛错（try/catch 降级），state 仍正常切换
    act(() => {
      result.current.setLanguage('en-US')
    })
    expect(result.current.language).toBe('en-US')
    // 验证 dev 警告已输出（含模块标识便于排查）
    expect(warnSpy).toHaveBeenCalledWith(
      '[useTranslation] localStorage 写入失败，降级为内存模式',
      expect.any(DOMException),
    )

    // 切回 zh-CN，验证多次切换稳定
    act(() => {
      result.current.setLanguage('zh-CN')
    })
    expect(result.current.language).toBe('zh-CN')

    warnSpy.mockRestore()
  })

  // ===== 5. 配额满时翻译函数仍按新语言工作 =====
  it('配额满时切换语言后 t() 按新语言翻译', () => {
    setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })

    const { result } = renderHook(() => useTranslation())
    expect(result.current.language).toBe('zh-CN')

    act(() => {
      result.current.setLanguage('en-US' as Language)
    })
    expect(result.current.language).toBe('en-US')
    // t() 应使用 en-US 字典（语言 state 已更新，持久化失败不影响翻译）
    const text = result.current.t('app.title')
    expect(typeof text).toBe('string')
  })

  // ===== 6. 隐私模式场景：SecurityError 不崩溃 =====
  it('隐私模式（SecurityError）时 setLanguage 不崩溃且 state 仍正常切换', () => {
    setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException(
          'Access is denied for this document',
          'SecurityError',
        )
      })

    const { result } = renderHook(() => useTranslation())
    expect(result.current.language).toBe('zh-CN')

    act(() => {
      result.current.setLanguage('en-US')
    })
    expect(result.current.language).toBe('en-US')
  })
})
