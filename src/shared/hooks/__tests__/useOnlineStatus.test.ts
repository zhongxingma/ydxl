// useOnlineStatus Hook 单元测试
//
// 测试覆盖：
// - 初始在线状态返回 true（navigator.onLine === true）
// - 初始离线状态返回 false（navigator.onLine === false）
// - offline 事件触发后状态变为 false
// - online 事件触发后状态变为 true，且调用所有 repository 的 triggerRefresh
//
// 测试策略：
// - 使用 @testing-library/react 的 renderHook 渲染 hook
// - 通过 Object.defineProperty mock navigator.onLine（jsdom 中默认为 true 且只读，需 configurable: true）
// - 通过 window.dispatchEvent(new Event('online' | 'offline')) 触发事件
// - 通过 vi.mock 替换 @/shared/services 中的 repository 单例
//
// vitest globals 模式：describe / it / expect / vi / beforeEach 均为全局，无需 import

import { act, renderHook } from '@testing-library/react'
import { useOnlineStatus } from '../useOnlineStatus'
import * as services from '@/shared/services'

// mock @/shared/services：所有 repository 单例替换为带 triggerRefresh mock 的对象
// mock 列表必须与 useOnlineStatus.ts 中实际 import 的 repository 一致
vi.mock('@/shared/services', () => ({
  articleRepository: { triggerRefresh: vi.fn() },
  wordRepository: { triggerRefresh: vi.fn() },
  questionRepository: { triggerRefresh: vi.fn() },
  reviewRepository: { triggerRefresh: vi.fn() },
  statsRepository: { triggerRefresh: vi.fn() },
  readingSessionRepository: { triggerRefresh: vi.fn() },
  achievementRepository: { triggerRefresh: vi.fn() },
}))

// 保存 navigator.onLine 原始描述符，便于测试后恢复
// jsdom 中 onLine 默认为 getter（不可写），需用 Object.defineProperty 覆盖
const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // 恢复 navigator.onLine 原始描述符，避免跨用例状态泄漏
    if (originalOnLineDescriptor) {
      Object.defineProperty(navigator, 'onLine', originalOnLineDescriptor)
    } else {
      // 兜底：恢复为 true（jsdom 默认值）
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    }
  })

  // ===== 1. 初始在线状态 =====
  it('初始在线状态返回 true', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  // ===== 2. 初始离线状态 =====
  it('初始离线状态返回 false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
  })

  // ===== 3. offline 事件触发后状态变为 false =====
  it('offline 事件触发后状态变为 false', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)
  })

  // ===== 4. online 事件触发后状态变为 true，且调用所有 repository 的 triggerRefresh =====
  it('online 事件触发后状态变为 true 且调用所有 repository 的 triggerRefresh', () => {
    // 初始离线
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)

    // 触发 online 事件：网络恢复
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)

    // 验证所有 repository 的 triggerRefresh 被调用
    expect(services.articleRepository.triggerRefresh).toHaveBeenCalledTimes(1)
    expect(services.wordRepository.triggerRefresh).toHaveBeenCalledTimes(1)
    expect(services.questionRepository.triggerRefresh).toHaveBeenCalledTimes(1)
    expect(services.reviewRepository.triggerRefresh).toHaveBeenCalledTimes(1)
    expect(services.statsRepository.triggerRefresh).toHaveBeenCalledTimes(1)
    expect(services.readingSessionRepository.triggerRefresh).toHaveBeenCalledTimes(1)
    expect(services.achievementRepository.triggerRefresh).toHaveBeenCalledTimes(1)
  })

  // ===== 5. 卸载后不再监听事件（避免内存泄漏） =====
  it('组件卸载后移除事件监听，状态不再变化', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result, unmount } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    unmount()

    // 卸载后触发事件不应导致状态变化（也不会报错）
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    // result.current 仍是卸载前的值（true），因为已不再订阅事件
    expect(result.current).toBe(true)
  })

  // ===== 6. 已在线时收到 online 事件不会重复触发 repository 刷新 =====
  it('初始在线时收到 online 事件不触发 repository 刷新', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    renderHook(() => useOnlineStatus())

    // 初始就是在线状态，再收到 online 事件不应触发刷新（无 offline→online 切换）
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(services.articleRepository.triggerRefresh).not.toHaveBeenCalled()
    expect(services.wordRepository.triggerRefresh).not.toHaveBeenCalled()
  })
})
