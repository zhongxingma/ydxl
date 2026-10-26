// AchievementWall 成就墙组件单元测试
//
// 覆盖场景：
// 1. loading 时展示与规则数量一致的骨架，不显示解锁统计
// 2. 全部未解锁时展示 0/N、规则名称 / 描述与锁图标
// 3. 部分解锁时展示对应图标、解锁日期与已解锁统计
// 4. unlockedAt 为 0 时仍视为已解锁卡片但状态显示未解锁
//
// 环境依赖：成就规则来自 achievementService 的 ACHIEVEMENT_RULES 常量
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ACHIEVEMENT_RULES } from '@/features/stats/services/achievementService'
import type { Achievement } from '@/shared/types'
import AchievementWall from '../AchievementWall'

const totalRules = ACHIEVEMENT_RULES.length

function makeAchievement(
  rule: (typeof ACHIEVEMENT_RULES)[number],
  unlockedAt: number
): Achievement {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    icon: rule.icon,
    unlockedAt,
    updated_at: unlockedAt,
  }
}

describe('AchievementWall 成就墙', () => {
  it('loading 时展示规则数量的骨架且不显示解锁统计', () => {
    const { container } = render(<AchievementWall unlockedAchievements={[]} loading />)

    expect(screen.getByRole('heading', { name: '成就墙' })).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(totalRules)
    expect(screen.queryByText(/已解锁 \d+ \//)).not.toBeInTheDocument()
    expect(screen.queryByText(ACHIEVEMENT_RULES[0].name)).not.toBeInTheDocument()
  })

  it('全部未解锁时展示 0/N、规则信息与锁图标', () => {
    render(<AchievementWall unlockedAchievements={[]} />)

    expect(screen.getByText(`已解锁 0 / ${totalRules}`)).toBeInTheDocument()
    expect(screen.getAllByText('🔒')).toHaveLength(totalRules)
    expect(screen.getAllByText('未解锁')).toHaveLength(totalRules)
    for (const rule of ACHIEVEMENT_RULES) {
      expect(screen.getByText(rule.name)).toBeInTheDocument()
      expect(screen.getByText(rule.description)).toBeInTheDocument()
    }
  })

  it('部分解锁时展示对应图标、解锁日期与统计', () => {
    const rule = ACHIEVEMENT_RULES[0]
    const unlockedAt = new Date(2026, 0, 5, 10, 30).getTime()
    render(
      <AchievementWall
        unlockedAchievements={[makeAchievement(rule, unlockedAt)]}
      />
    )

    expect(screen.getByText(`已解锁 1 / ${totalRules}`)).toBeInTheDocument()

    const card = screen.getByTitle(rule.description)
    expect(within(card).getByText(rule.icon)).toBeInTheDocument()
    expect(within(card).getByText(rule.name)).toBeInTheDocument()
    expect(within(card).getByText('2026-01-05')).toBeInTheDocument()
    expect(within(card).queryByText('未解锁')).not.toBeInTheDocument()

    // 其余规则仍为锁定状态
    expect(screen.getAllByText('🔒')).toHaveLength(totalRules - 1)
    expect(screen.getAllByText('未解锁')).toHaveLength(totalRules - 1)
  })

  it('unlockedAt 为 0 时卡片高亮但仍显示未解锁状态', () => {
    const rule = ACHIEVEMENT_RULES[1]
    render(
      <AchievementWall unlockedAchievements={[makeAchievement(rule, 0)]} />
    )

    const card = screen.getByTitle(rule.description)
    expect(within(card).getByText(rule.icon)).toBeInTheDocument()
    expect(within(card).getByText('未解锁')).toBeInTheDocument()

    expect(screen.getByText(`已解锁 1 / ${totalRules}`)).toBeInTheDocument()
    // 锁图标只在其余规则上出现
    expect(screen.getAllByText('🔒')).toHaveLength(totalRules - 1)
  })
})
