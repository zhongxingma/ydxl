// ProfilePreferencesSection 个人中心偏好设置区单元测试
//
// 覆盖场景：
// 1. 学习目标 / 发音 / 学习提醒三个区块与当前设置值渲染
// 2. 三个数字输入的边界钳制与取整
// 3. 发音源下拉与提醒时间变更
// 4. 通知开关的选中态、文案与回调参数
// 5. 通知不支持 / 权限被拒 / 权限正常三种提示分支
//
// Mock 策略：仅替换通知支持性探测，其余使用真实子组件；
// profile 以完整 UseProfileSettingsResult 结构构造，回调使用 vi.fn 断言。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Settings } from '@/shared/services'
import type { UseProfileSettingsResult } from '../../hooks/useProfileSettings'
import ProfilePreferencesSection from '../ProfilePreferencesSection'

const isNotificationSupportedMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/shared/services', () => ({
  isNotificationSupported: isNotificationSupportedMock,
}))

const t = (key: string) => key

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    dailyReviewLimit: 50,
    dailyGoalArticles: 2,
    dailyGoalWords: 15,
    pronunciationSource: 'us',
    reminderTime: '20:00',
    ...overrides,
  }
}

function makeProfile(
  overrides: Partial<UseProfileSettingsResult> = {}
): UseProfileSettingsResult {
  return {
    stats: { totalReadCount: 0, totalWords: 0, totalDurationSec: 0, totalMasteredWords: 0 },
    achievements: [],
    loading: false,
    durationText: '',
    settings: makeSettings(),
    updateSettingsHandler: vi.fn(),
    notificationEnabled: false,
    notificationPermission: 'default',
    toggleNotification: vi.fn().mockResolvedValue(undefined),
    aiProviderType: 'deepseek',
    changeAIProvider: vi.fn(),
    aiApiKey: '',
    apiKeyLoaded: true,
    changeApiKey: vi.fn(),
    blurApiKey: vi.fn(),
    aiModel: '',
    changeAIModel: vi.fn(),
    customEndpoint: '',
    customModelId: '',
    changeCustomConfig: vi.fn(),
    ...overrides,
  }
}

describe('ProfilePreferencesSection 偏好设置区', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNotificationSupportedMock.mockReturnValue(true)
  })

  it('渲染三个设置区块与当前值', () => {
    render(
      <ProfilePreferencesSection
        profile={makeProfile({ settings: makeSettings({ pronunciationSource: 'uk' }) })}
        t={t}
      />
    )

    expect(screen.getByText('settings.learning_goal')).toBeInTheDocument()
    expect(screen.getByText('settings.pronunciation')).toBeInTheDocument()
    expect(screen.getByText('settings.reminder')).toBeInTheDocument()

    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('15')).toBeInTheDocument()
    expect(screen.getByDisplayValue('50')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('uk')
    expect(screen.getByDisplayValue('20:00')).toBeInTheDocument()
    expect(screen.getByText('settings.range_articles')).toBeInTheDocument()
    expect(screen.getByText('settings.range_words')).toBeInTheDocument()
    expect(screen.getByText('settings.range_review_limit')).toBeInTheDocument()
  })

  it('每日目标文章数钳制在 1-10 并向下取整', () => {
    const profile = makeProfile()
    render(<ProfilePreferencesSection profile={profile} t={t} />)

    const input = screen.getByDisplayValue('2')

    fireEvent.change(input, { target: { value: '99' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyGoalArticles: 10,
    })

    fireEvent.change(input, { target: { value: '-5' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyGoalArticles: 1,
    })

    fireEvent.change(input, { target: { value: '4.7' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyGoalArticles: 4,
    })
  })

  it('每日目标单词数钳制在 5-100', () => {
    const profile = makeProfile()
    render(<ProfilePreferencesSection profile={profile} t={t} />)

    const input = screen.getByDisplayValue('15')

    fireEvent.change(input, { target: { value: '200' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyGoalWords: 100,
    })

    fireEvent.change(input, { target: { value: '1' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyGoalWords: 5,
    })
  })

  it('每日复习上限钳制在 1-200', () => {
    const profile = makeProfile()
    render(<ProfilePreferencesSection profile={profile} t={t} />)

    const input = screen.getByDisplayValue('50')

    fireEvent.change(input, { target: { value: '999' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyReviewLimit: 200,
    })

    fireEvent.change(input, { target: { value: '0' } })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      dailyReviewLimit: 1,
    })
  })

  it('切换发音源与提醒时间会写回设置', () => {
    const profile = makeProfile()
    render(<ProfilePreferencesSection profile={profile} t={t} />)

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'uk' },
    })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      pronunciationSource: 'uk',
    })

    fireEvent.change(screen.getByDisplayValue('20:00'), {
      target: { value: '07:30' },
    })
    expect(profile.updateSettingsHandler).toHaveBeenLastCalledWith({
      reminderTime: '07:30',
    })
  })

  it('通知开关展示选中态与文案，点击取反后调用回调', () => {
    const toggleNotification = vi.fn().mockResolvedValue(undefined)
    const profile = makeProfile({
      notificationEnabled: false,
      toggleNotification,
    })
    const { rerender } = render(
      <ProfilePreferencesSection profile={profile} t={t} />
    )

    const switchButton = screen.getByRole('switch')
    expect(switchButton).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('settings.notification_disabled')).toBeInTheDocument()

    fireEvent.click(switchButton)
    expect(toggleNotification).toHaveBeenCalledWith(true)

    rerender(
      <ProfilePreferencesSection
        profile={{ ...profile, notificationEnabled: true }}
        t={t}
      />
    )

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('settings.notification_enabled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))
    expect(toggleNotification).toHaveBeenLastCalledWith(false)
  })

  it('浏览器不支持通知时展示提示', () => {
    isNotificationSupportedMock.mockReturnValue(false)
    render(
      <ProfilePreferencesSection
        profile={makeProfile({ notificationPermission: 'denied' })}
        t={t}
      />
    )

    expect(screen.getByText('settings.notification_unsupported')).toBeInTheDocument()
    expect(screen.queryByText('settings.notification_denied')).not.toBeInTheDocument()
  })

  it('通知权限被拒且浏览器支持时展示权限提示', () => {
    render(
      <ProfilePreferencesSection
        profile={makeProfile({ notificationPermission: 'denied' })}
        t={t}
      />
    )

    expect(screen.getByText('settings.notification_denied')).toBeInTheDocument()
    expect(
      screen.queryByText('settings.notification_unsupported')
    ).not.toBeInTheDocument()
  })

  it('权限正常时不展示任何通知警告', () => {
    render(
      <ProfilePreferencesSection
        profile={makeProfile({ notificationPermission: 'granted' })}
        t={t}
      />
    )

    expect(
      screen.queryByText('settings.notification_denied')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('settings.notification_unsupported')
    ).not.toBeInTheDocument()
  })
})
