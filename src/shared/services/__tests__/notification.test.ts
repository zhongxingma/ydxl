// 浏览器通知服务
//
// 覆盖支持性检测、权限读取 / 申请、通知发送降级与每日定时提醒的校验、触发与取消。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendNotification,
  setupDailyReminder,
} from '../notification'

class MockNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn()
  static instances: MockNotification[] = []

  title: string
  options?: NotificationOptions

  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options
    MockNotification.instances.push(this)
  }
}

function stubNotification(): void {
  vi.stubGlobal('Notification', MockNotification)
}

function removeNotification(): void {
  Reflect.deleteProperty(window, 'Notification')
}

describe('notification 浏览器通知服务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockNotification.permission = 'default'
    MockNotification.requestPermission.mockReset()
    MockNotification.instances = []
    removeNotification()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    removeNotification()
  })

  it('不支持通知 API 时：检测为 false、权限为 denied', () => {
    expect(isNotificationSupported()).toBe(false)
    expect(getNotificationPermission()).toBe('denied')
  })

  it('不支持通知 API 时：申请权限与发送通知均降级告警', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(requestNotificationPermission()).resolves.toBe('denied')
    await sendNotification('提醒')

    expect(warnSpy).toHaveBeenCalledWith('[Notification] 当前浏览器不支持通知 API')
    expect(warnSpy).toHaveBeenCalledWith(
      '[Notification] 当前浏览器不支持通知 API，无法发送：',
      '提醒',
    )
  })

  it('支持通知 API 时返回当前权限', () => {
    stubNotification()
    MockNotification.permission = 'granted'

    expect(isNotificationSupported()).toBe(true)
    expect(getNotificationPermission()).toBe('granted')
  })

  it('申请权限成功返回授权结果', async () => {
    stubNotification()
    MockNotification.requestPermission.mockResolvedValue('granted')

    await expect(requestNotificationPermission()).resolves.toBe('granted')
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('申请权限抛错降级为 denied 并告警', async () => {
    stubNotification()
    const error = new Error('permission failed')
    MockNotification.requestPermission.mockRejectedValue(error)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(requestNotificationPermission()).resolves.toBe('denied')
    expect(warnSpy).toHaveBeenCalledWith('[Notification] 请求通知权限失败', error)
  })

  it('已授权时发送通知', async () => {
    stubNotification()
    MockNotification.permission = 'granted'

    await sendNotification('每日提醒', { body: '该复习了' })

    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].title).toBe('每日提醒')
    expect(MockNotification.instances[0].options).toEqual({ body: '该复习了' })
  })

  it('未授权时不发送通知并告警', async () => {
    stubNotification()
    MockNotification.permission = 'denied'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendNotification('每日提醒')

    expect(MockNotification.instances).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith('[Notification] 通知权限未授权，无法发送：', '每日提醒')
  })

  it('通知构造抛错时降级告警', async () => {
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted'
        constructor() {
          throw new Error('constructor failed')
        }
      },
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendNotification('每日提醒')

    expect(warnSpy).toHaveBeenCalledWith(
      '[Notification] 发送通知失败：',
      '每日提醒',
      expect.any(Error),
    )
  })

  it('每日提醒：时间格式非法时告警并返回空取消函数', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const callback = vi.fn()

    const cancel = setupDailyReminder('8:30', callback)
    cancel()

    expect(warnSpy).toHaveBeenCalledWith('[Notification] 时间格式错误，应为 "HH:MM"：', '8:30')
    expect(callback).not.toHaveBeenCalled()
  })

  it('每日提醒：到达指定时间触发回调，取消后停止', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 8, 29, 30))
    const callback = vi.fn()

    const cancel = setupDailyReminder('08:30', callback)
    vi.advanceTimersByTime(60 * 1000)
    expect(callback).toHaveBeenCalledTimes(1)

    cancel()
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('每日提醒：回调抛错时告警但不中断定时器', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 8, 29, 30))
    const error = new Error('callback failed')
    const callback = vi.fn(() => {
      throw error
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const cancel = setupDailyReminder('08:30', callback)
    vi.advanceTimersByTime(60 * 1000)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[Notification] 每日提醒回调执行失败', error)
    cancel()
  })
})
