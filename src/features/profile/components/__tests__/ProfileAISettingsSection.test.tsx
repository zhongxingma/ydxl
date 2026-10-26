// ProfileAISettingsSection 个人中心 AI 配置区单元测试
//
// 覆盖场景：
// 1. 供应商下拉、API Key、模型名与连接测试按钮渲染
// 2. vendor 切换与自定义端点 / 模型 ID 字段的条件展示与写回
// 3. API Key 输入、失焦回调与连接测试按钮启用条件
// 4. 测试中状态文案与禁用
// 5. 成功 / 失败提示样式
//
// Mock 策略：profile 以完整 UseProfileSettingsResult 结构构造，回调使用 vi.fn 断言。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { UseProfileSettingsResult } from '../../hooks/useProfileSettings'
import ProfileAISettingsSection from '../ProfileAISettingsSection'

const t = (key: string) => key

function makeProfile(
  overrides: Partial<UseProfileSettingsResult> = {}
): UseProfileSettingsResult {
  return {
    stats: { totalReadCount: 0, totalWords: 0, totalDurationSec: 0, totalMasteredWords: 0 },
    achievements: [],
    loading: false,
    durationText: '',
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

function renderSection(
  profile: UseProfileSettingsResult,
  options: {
    testingConnection?: boolean
    testMessage?: { type: 'success' | 'error'; text: string } | null
    onTestConnection?: () => void
  } = {}
) {
  const onTestConnection = options.onTestConnection ?? vi.fn()
  const view = render(
    <ProfileAISettingsSection
      profile={profile}
      t={t}
      testingConnection={options.testingConnection ?? false}
      testMessage={options.testMessage ?? null}
      onTestConnection={onTestConnection}
    />
  )
  return { ...view, onTestConnection }
}

describe('ProfileAISettingsSection AI 配置区', () => {
  it('渲染供应商、API Key、模型名与连接测试按钮', () => {
    renderSection(makeProfile())

    expect(screen.getByText('settings.ai_config')).toBeInTheDocument()
    expect(screen.getByText('settings.ai_config_desc')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('deepseek')
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('deepseek-v4-pro')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'settings.test_connection' })
    ).toBeDisabled()
  })

  it('切换供应商调用 changeAIProvider', () => {
    const profile = makeProfile()
    renderSection(profile)

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'qwen' },
    })

    expect(profile.changeAIProvider).toHaveBeenCalledWith('qwen')
  })

  it('供应商为 custom 时展示端点与模型 ID 并写回配置', () => {
    const profile = makeProfile({
      aiProviderType: 'custom',
      customEndpoint: 'https://api.example.com/v1',
      customModelId: 'gpt-4o',
    })
    renderSection(profile)

    expect(screen.getByText('settings.ai_custom_endpoint')).toBeInTheDocument()
    expect(screen.getByText('settings.ai_custom_model_id')).toBeInTheDocument()
    expect(screen.getByText('settings.ai_custom_endpoint_hint')).toBeInTheDocument()

    const endpoint = screen.getByDisplayValue('https://api.example.com/v1')
    const modelId = screen.getByDisplayValue('gpt-4o')

    fireEvent.change(endpoint, {
      target: { value: 'https://proxy.example.com/v1' },
    })
    expect(profile.changeCustomConfig).toHaveBeenLastCalledWith({
      endpoint: 'https://proxy.example.com/v1',
    })

    fireEvent.change(modelId, { target: { value: 'qwen-max' } })
    expect(profile.changeCustomConfig).toHaveBeenLastCalledWith({
      modelId: 'qwen-max',
    })
  })

  it('非 custom 供应商不展示自定义配置字段', () => {
    renderSection(makeProfile({ aiProviderType: 'openai' }))

    expect(
      screen.queryByText('settings.ai_custom_endpoint')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('settings.ai_custom_model_id')
    ).not.toBeInTheDocument()
  })

  it('API Key 输入、失焦与模型名变更分别调用对应回调', () => {
    const profile = makeProfile({ aiApiKey: 'sk-existing' })
    renderSection(profile)

    const keyInput = screen.getByPlaceholderText('sk-...')
    fireEvent.change(keyInput, { target: { value: 'sk-new' } })
    expect(profile.changeApiKey).toHaveBeenCalledWith('sk-new')

    fireEvent.blur(keyInput)
    expect(profile.blurApiKey).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText('deepseek-v4-pro'), {
      target: { value: 'deepseek-v4-flash' },
    })
    expect(profile.changeAIModel).toHaveBeenCalledWith('deepseek-v4-flash')
  })

  it('有 API Key 时可点击连接测试', () => {
    const profile = makeProfile({ aiApiKey: 'sk-test' })
    const { onTestConnection } = renderSection(profile)

    const button = screen.getByRole('button', { name: 'settings.test_connection' })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(onTestConnection).toHaveBeenCalledTimes(1)
  })

  it('测试中展示测试文案并禁用按钮', () => {
    renderSection(makeProfile({ aiApiKey: 'sk-test' }), {
      testingConnection: true,
    })

    const button = screen.getByRole('button', { name: 'button.testing' })
    expect(button).toBeDisabled()
  })

  it('成功与失败提示分别使用不同样式', () => {
    const profile = makeProfile({ aiApiKey: 'sk-test' })
    const { rerender } = renderSection(profile, {
      testMessage: { type: 'success', text: '连接成功' },
    })

    expect(screen.getByText('连接成功')).toHaveClass('text-emerald-600')

    rerender(
      <ProfileAISettingsSection
        profile={profile}
        t={t}
        testingConnection={false}
        testMessage={{ type: 'error', text: '连接失败' }}
        onTestConnection={vi.fn()}
      />
    )

    expect(screen.getByText('连接失败')).toHaveClass('text-rose-600')
  })

  it('未配置 API Key 时即使非测试中也禁用按钮', () => {
    renderSection(makeProfile({ aiApiKey: '' }))

    expect(
      screen.getByRole('button', { name: 'settings.test_connection' })
    ).toBeDisabled()
  })
})
