// ProfilePage「我的」页面单元测试
//
// 覆盖场景：
// 1. 标题 / 副标题 / 各区块文案渲染
// 2. 统计与成就数据传递给子区块（stats / loading / durationText）
// 3. AI 连接测试参数：自定义供应商使用 customModelId，内置供应商使用 aiModel
// 4. 语言下拉切换调用 setLanguage
// 5. 设置区块与设备管理区块挂载
//
// Mock 策略：替换页面依赖的两个 hook 与重量级子组件，
// 保留 SettingsSection 真实实现以覆盖语言切换交互。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Achievement } from '@/shared/types'
import type { ProfileStats, UseProfileSettingsResult } from '../../hooks/useProfileSettings'

const mockUseProfileSettings = vi.hoisted(() => vi.fn())
const mockUseAIConnectionTest = vi.hoisted(() => vi.fn())
const mockSetLanguage = vi.hoisted(() => vi.fn())
const mockHandleTestConnection = vi.hoisted(() => vi.fn())
const captured = vi.hoisted(() => ({
  grid: null as unknown,
  wall: null as unknown,
  preferences: null as unknown,
  aiSettings: null as unknown,
}))

vi.mock('../../hooks/useProfileSettings', () => ({
  useProfileSettings: mockUseProfileSettings,
}))
vi.mock('../../hooks/useAIConnectionTest', () => ({
  useAIConnectionTest: mockUseAIConnectionTest,
}))
vi.mock('@/shared/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'zh-CN',
    setLanguage: mockSetLanguage,
  }),
}))
vi.mock('../../components/ProfileStatsGrid', () => ({
  default: (props: unknown) => {
    captured.grid = props
    return <div data-testid="stats-grid" />
  },
}))
vi.mock('../../components/AchievementWall', () => ({
  default: (props: unknown) => {
    captured.wall = props
    return <div data-testid="achievement-wall" />
  },
}))
vi.mock('../../components/ProfilePreferencesSection', () => ({
  default: (props: unknown) => {
    captured.preferences = props
    return <div data-testid="preferences" />
  },
}))
vi.mock('../../components/ProfileAISettingsSection', () => ({
  default: (props: unknown) => {
    captured.aiSettings = props
    return <div data-testid="ai-settings" />
  },
}))
vi.mock('../../components/SessionSection', () => ({
  default: () => <div data-testid="session-section" />,
}))
vi.mock('../../components/TokenStatsPanel', () => ({
  default: () => <div data-testid="token-stats" />,
}))

import ProfilePage from '../ProfilePage'

const stats: ProfileStats = {
  totalReadCount: 12,
  totalWords: 320,
  totalDurationSec: 7500,
  totalMasteredWords: 45,
}

const achievements: Achievement[] = [
  {
    id: 'first-read',
    name: '初次阅读',
    description: '完成首次阅读',
    icon: '📖',
    unlockedAt: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
  },
]

function makeProfile(overrides: Partial<UseProfileSettingsResult> = {}): UseProfileSettingsResult {
  return {
    stats,
    achievements,
    loading: false,
    durationText: '2 小时 5 分钟',
    settings: {
      dailyReviewLimit: 50,
      dailyGoalArticles: 2,
      dailyGoalWords: 15,
      pronunciationSource: 'us',
      reminderTime: '20:00',
    },
    updateSettingsHandler: vi.fn(),
    notificationEnabled: false,
    notificationPermission: 'default',
    toggleNotification: vi.fn(),
    aiProviderType: 'deepseek',
    changeAIProvider: vi.fn(),
    aiApiKey: 'sk-key',
    apiKeyLoaded: true,
    changeApiKey: vi.fn(),
    blurApiKey: vi.fn(),
    aiModel: 'deepseek-v4-pro',
    changeAIModel: vi.fn(),
    customEndpoint: 'https://custom.example.com/v1',
    customModelId: 'custom-model-id',
    changeCustomConfig: vi.fn(),
    ...overrides,
  }
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProfileSettings.mockReturnValue(makeProfile())
    mockUseAIConnectionTest.mockReturnValue({
      testingConnection: false,
      testMessage: null,
      handleTestConnection: mockHandleTestConnection,
    })
  })

  it('渲染标题、副标题与各区块', () => {
    render(<ProfilePage />)

    expect(screen.getByRole('heading', { name: 'profile.title' })).toBeInTheDocument()
    expect(screen.getByText('profile.subtitle')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'profile.learning_stats' })).toBeInTheDocument()
    expect(screen.getByTestId('stats-grid')).toBeInTheDocument()
    expect(screen.getByTestId('achievement-wall')).toBeInTheDocument()
    expect(screen.getByTestId('token-stats')).toBeInTheDocument()
    expect(screen.getByTestId('preferences')).toBeInTheDocument()
    expect(screen.getByTestId('ai-settings')).toBeInTheDocument()
    expect(screen.getByTestId('session-section')).toBeInTheDocument()
  })

  it('统计与成就数据透传给子区块', () => {
    render(<ProfilePage />)

    const grid = captured.grid as {
      stats: ProfileStats
      loading: boolean
      durationText: string
      t: (key: string) => string
    }
    expect(grid.stats).toEqual(stats)
    expect(grid.loading).toBe(false)
    expect(grid.durationText).toBe('2 小时 5 分钟')
    expect(grid.t('x')).toBe('x')

    const wall = captured.wall as { unlockedAchievements: Achievement[]; loading: boolean }
    expect(wall.unlockedAchievements).toEqual(achievements)
    expect(wall.loading).toBe(false)
  })

  it('AI 配置区接收连接测试状态与回调', () => {
    render(<ProfilePage />)

    const ai = captured.aiSettings as {
      testingConnection: boolean
      testMessage: string | null
      onTestConnection: () => void
    }
    expect(ai.testingConnection).toBe(false)
    expect(ai.testMessage).toBeNull()
    expect(ai.onTestConnection).toBe(mockHandleTestConnection)
  })

  it('内置供应商：连接测试使用 aiModel', () => {
    render(<ProfilePage />)

    expect(mockUseAIConnectionTest).toHaveBeenCalledWith(
      'deepseek',
      'sk-key',
      'deepseek-v4-pro',
      'https://custom.example.com/v1',
    )
  })

  it('自定义供应商：连接测试使用 customModelId', () => {
    mockUseProfileSettings.mockReturnValue(makeProfile({ aiProviderType: 'custom' }))
    render(<ProfilePage />)

    expect(mockUseAIConnectionTest).toHaveBeenCalledWith(
      'custom',
      'sk-key',
      'custom-model-id',
      'https://custom.example.com/v1',
    )
  })

  it('语言下拉切换调用 setLanguage', () => {
    render(<ProfilePage />)

    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('zh-CN')
    fireEvent.change(select, { target: { value: 'en-US' } })

    expect(mockSetLanguage).toHaveBeenCalledWith('en-US')
  })
})
