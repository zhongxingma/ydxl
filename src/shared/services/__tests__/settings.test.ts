// settings 用户设置服务单元测试
//
// 覆盖场景：
// 1. 无持久化数据 / localStorage 不可用时返回默认设置
// 2. 已保存设置与默认值合并；JSON 损坏时回退默认并记录警告
// 3. updateSettings 部分更新并持久化；持久化失败时仅返回内存值
// 4. resetSettings 清除持久化；清除失败时记录警告
//
// 环境依赖：jsdom 提供 localStorage；异常分支通过 spy 模拟
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getSettings,
  updateSettings,
  resetSettings,
  DEFAULT_USER_SETTINGS,
} from '../settings'

describe('settings 用户设置', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无持久化数据时返回默认设置', () => {
    expect(getSettings()).toEqual(DEFAULT_USER_SETTINGS)
    expect(DEFAULT_USER_SETTINGS).toEqual({
      dailyReviewLimit: 50,
      dailyGoalArticles: 2,
      dailyGoalWords: 15,
      pronunciationSource: 'us',
      reminderTime: '20:00',
    })
  })

  it('已保存设置与默认值合并，缺失字段使用默认值', () => {
    window.localStorage.setItem(
      'ydxl-settings',
      JSON.stringify({ dailyGoalWords: 30, pronunciationSource: 'uk' })
    )

    expect(getSettings()).toEqual({
      ...DEFAULT_USER_SETTINGS,
      dailyGoalWords: 30,
      pronunciationSource: 'uk',
    })
  })

  it('JSON 损坏时记录警告并回退默认设置', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.localStorage.setItem('ydxl-settings', '{broken')

    expect(getSettings()).toEqual(DEFAULT_USER_SETTINGS)
    expect(warnSpy).toHaveBeenCalledWith(
      '[settings] 设置 JSON 解析失败，回退到默认值',
      expect.any(Error)
    )
  })

  it('localStorage 不可用时记录警告并返回默认设置', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(getSettings()).toEqual(DEFAULT_USER_SETTINGS)
    expect(warnSpy).toHaveBeenCalledWith(
      '[settings] localStorage 不可用（可能是隐私模式）',
      expect.any(Error)
    )
  })

  it('updateSettings 合并部分字段并持久化完整设置', () => {
    const next = updateSettings({ dailyGoalArticles: 4, reminderTime: '07:30' })

    expect(next).toEqual({
      ...DEFAULT_USER_SETTINGS,
      dailyGoalArticles: 4,
      reminderTime: '07:30',
    })
    expect(JSON.parse(window.localStorage.getItem('ydxl-settings') ?? '{}')).toEqual(next)
    expect(getSettings()).toEqual(next)
  })

  it('updateSettings 持久化失败时记录警告并返回内存值', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === 'ydxl-settings') throw new Error('quota exceeded')
      return original.call(this, key, value)
    })

    expect(updateSettings({ dailyReviewLimit: 10 })).toEqual({
      ...DEFAULT_USER_SETTINGS,
      dailyReviewLimit: 10,
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[settings] 设置持久化失败，仅保留内存值',
      expect.any(Error)
    )
    expect(window.localStorage.getItem('ydxl-settings')).toBeNull()
  })

  it('resetSettings 清除已保存设置并返回默认值', () => {
    window.localStorage.setItem('ydxl-settings', JSON.stringify({ dailyGoalWords: 1 }))

    expect(resetSettings()).toEqual(DEFAULT_USER_SETTINGS)
    expect(window.localStorage.getItem('ydxl-settings')).toBeNull()
  })

  it('resetSettings 清除失败时记录警告并返回默认值', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key === 'ydxl-settings') throw new Error('remove failed')
      return original.call(this, key)
    })

    expect(resetSettings()).toEqual(DEFAULT_USER_SETTINGS)
    expect(warnSpy).toHaveBeenCalledWith('[settings] 清除设置失败', expect.any(Error))
  })
})
