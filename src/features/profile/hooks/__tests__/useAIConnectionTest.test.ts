// AI 连接测试 hook
//
// 覆盖成功 / 失败消息、并发防重、5 秒自动清空与卸载清理定时器。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createAIProviderByName } from '@/shared/services/ai'
import { useAIConnectionTest } from '../useAIConnectionTest'

vi.mock('@/shared/services/ai', () => ({
  createAIProviderByName: vi.fn(),
}))

const createProviderMock = vi.mocked(createAIProviderByName)

function mockProvider(testConnection: () => Promise<void>): void {
  createProviderMock.mockReturnValue({ testConnection } as unknown as ReturnType<
    typeof createAIProviderByName
  >)
}

describe('useAIConnectionTest AI 连接测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('连接成功：返回成功消息并使用当前配置创建临时实例', async () => {
    const testConnection = vi.fn().mockResolvedValue(undefined)
    mockProvider(testConnection)
    const { result } = renderHook(() =>
      useAIConnectionTest('deepseek', 'sk-test', 'deepseek-v4-flash'),
    )

    await act(async () => {
      await result.current.handleTestConnection()
    })

    expect(createProviderMock).toHaveBeenCalledWith('deepseek', {
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      endpoint: undefined,
    })
    expect(testConnection).toHaveBeenCalledTimes(1)
    expect(result.current.testingConnection).toBe(false)
    expect(result.current.testMessage).toEqual({ type: 'success', text: '连接成功' })
  })

  it('自定义模型：透传请求地址；空模型名转 undefined', async () => {
    mockProvider(vi.fn().mockResolvedValue(undefined))
    const { result } = renderHook(() =>
      useAIConnectionTest('custom', 'sk-custom', '', 'https://api.example.com/v1'),
    )

    await act(async () => {
      await result.current.handleTestConnection()
    })

    expect(createProviderMock).toHaveBeenCalledWith('custom', {
      apiKey: 'sk-custom',
      model: undefined,
      endpoint: 'https://api.example.com/v1',
    })
  })

  it('连接失败：返回 Error 消息并告警', async () => {
    const error = new Error('API Key 无效')
    mockProvider(vi.fn().mockRejectedValue(error))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useAIConnectionTest('deepseek', 'bad-key'))

    await act(async () => {
      await result.current.handleTestConnection()
    })

    expect(result.current.testMessage).toEqual({ type: 'error', text: 'API Key 无效' })
    expect(warnSpy).toHaveBeenCalledWith('[ProfilePage] AI 连接测试失败', error)
  })

  it('连接失败且非 Error 时使用兜底文案', async () => {
    mockProvider(vi.fn().mockRejectedValue('network down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useAIConnectionTest('deepseek', 'bad-key'))

    await act(async () => {
      await result.current.handleTestConnection()
    })

    expect(result.current.testMessage).toEqual({ type: 'error', text: '连接失败' })
  })

  it('测试进行中重复触发不会重复创建实例', async () => {
    let resolveConnection: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      resolveConnection = resolve
    })
    const testConnection = vi.fn(() => pending)
    mockProvider(testConnection)
    const { result } = renderHook(() => useAIConnectionTest('deepseek', 'sk-test'))

    act(() => {
      void result.current.handleTestConnection()
    })
    await act(async () => {
      void result.current.handleTestConnection()
    })

    expect(createProviderMock).toHaveBeenCalledTimes(1)
    expect(result.current.testingConnection).toBe(true)

    await act(async () => {
      resolveConnection?.()
      await pending
    })
    expect(result.current.testingConnection).toBe(false)
  })

  it('成功消息 5 秒后自动清空', async () => {
    vi.useFakeTimers()
    mockProvider(vi.fn().mockResolvedValue(undefined))
    const { result } = renderHook(() => useAIConnectionTest('deepseek', 'sk-test'))

    await act(async () => {
      await result.current.handleTestConnection()
    })
    expect(result.current.testMessage).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.testMessage).toBeNull()
  })

  it('卸载时清理自动清空定时器', async () => {
    vi.useFakeTimers()
    mockProvider(vi.fn().mockResolvedValue(undefined))
    const { result, unmount } = renderHook(() => useAIConnectionTest('deepseek', 'sk-test'))

    await act(async () => {
      await result.current.handleTestConnection()
    })
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
