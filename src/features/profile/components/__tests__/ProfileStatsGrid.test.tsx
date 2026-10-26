// ProfileStatsGrid 个人中心统计区单元测试
//
// 覆盖场景：
// 1. loading 时渲染 4 个骨架且不渲染统计卡片
// 2. stats 为 null 时四张卡片数值回退为 0
// 3. 统计数据与时长文案透传到卡片，单位文案正确
// 4. 加载完成但无数据时仍展示时长占位

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ProfileStats } from '../../hooks/useProfileSettings'
import ProfileStatsGrid from '../ProfileStatsGrid'

const t = (key: string) => key

const stats: ProfileStats = {
  totalReadCount: 12,
  totalWords: 320,
  totalDurationSec: 7500,
  totalMasteredWords: 45,
}

describe('ProfileStatsGrid', () => {
  it('loading 时渲染 4 个骨架且不显示统计卡片', () => {
    const { container } = render(
      <ProfileStatsGrid stats={null} loading durationText="--" t={t} />
    )

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    expect(screen.queryByText('profile.total_read_count')).not.toBeInTheDocument()
  })

  it('stats 为 null 时数值回退为 0', () => {
    render(<ProfileStatsGrid stats={null} loading={false} durationText="--" t={t} />)

    expect(screen.getByText('profile.total_read_count')).toBeInTheDocument()
    expect(screen.getByText('profile.total_words')).toBeInTheDocument()
    expect(screen.getByText('profile.total_duration')).toBeInTheDocument()
    expect(screen.getByText('profile.mastered_words')).toBeInTheDocument()
    // 三张数字卡片回退 0，时长显示占位
    expect(screen.getAllByText('0')).toHaveLength(3)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('统计数据与时长文案正确渲染', () => {
    render(
      <ProfileStatsGrid stats={stats} loading={false} durationText="2 小时 5 分钟" t={t} />
    )

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
    expect(screen.getByText('2 小时 5 分钟')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    // 阅读篇数单位 1 处，生词与掌握词单位各 1 处
    expect(screen.getAllByText('dashboard.unit.words')).toHaveLength(2)
    expect(screen.getByText('dashboard.unit.articles')).toBeInTheDocument()
  })
})
