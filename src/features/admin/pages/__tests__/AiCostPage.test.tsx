// AiCostPage AI 成本页单元测试
//
// 覆盖：
// 1. 默认按近 30 天加载，渲染标题、说明、统计区间与预算使用率
// 2. 今日 / 本月调用次数与估算成本格式化
// 3. 按日 / 模型 / 用户明细表渲染
// 4. 无用量时显示空状态
// 5. 切换统计窗口（7 天）重新请求；加载失败展示错误文案
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AiCostReport } from '@/shared/services/adminService'
import { getAiUsageReport } from '@/shared/services/adminService'
import AiCostPage from '../AiCostPage'

vi.mock('@/shared/services/adminService', () => ({
  getAiUsageReport: vi.fn(),
}))

const getAiUsageReportMock = vi.mocked(getAiUsageReport)

function makeReport(overrides: Partial<AiCostReport> = {}): AiCostReport {
  return {
    days: 30,
    from: '2026-10-03',
    to: '2026-11-01',
    totals: {
      today: { tokens: 1200, costCny: 0.03, calls: 2 },
      month: { tokens: 3000, costCny: 0.075, calls: 5 },
      window: { tokens: 3000, costCny: 0.075, calls: 5 },
    },
    budgets: { daily: 10000, monthly: 100000 },
    daily: [{ date: '2026-11-01', tokens: 1200, costCny: 0.03, calls: 2 }],
    byModel: [
      { model: 'deepseek-v4-pro', provider: 'deepseek', tokens: 3000, costCny: 0.075, calls: 5 },
    ],
    byUser: [{ userId: 'u-1', username: 'alice', tokens: 3000, costCny: 0.075, calls: 5 }],
    ...overrides,
  }
}

describe('AiCostPage AI 成本', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAiUsageReportMock.mockResolvedValue(makeReport())
  })

  it('默认按近 30 天加载并渲染预算使用率与统计区间', async () => {
    render(<AiCostPage />)

    expect(screen.getByRole('heading', { name: 'AI 成本' })).toBeInTheDocument()
    expect(await screen.findByText('统计区间：2026-10-03 至 2026-11-01')).toBeInTheDocument()
    expect(getAiUsageReportMock).toHaveBeenCalledTimes(1)
    expect(getAiUsageReportMock).toHaveBeenCalledWith(30)
    // 1200 / 10000 = 12%；3000 / 100000 = 3%
    expect(screen.getByText('12%')).toBeInTheDocument()
    expect(screen.getByText('3%')).toBeInTheDocument()
    expect(screen.getByText('1,200 / 10,000')).toBeInTheDocument()
  })

  it('今日 / 本月调用次数与估算成本按格式展示', async () => {
    render(<AiCostPage />)
    expect(await screen.findByText('2 次')).toBeInTheDocument()
    expect(screen.getByText('5 次')).toBeInTheDocument()
    expect(screen.getAllByText('¥0.0300').length).toBeGreaterThan(0)
    expect(screen.getAllByText('¥0.0750').length).toBeGreaterThan(0)
  })

  it('按日 / 模型 / 用户明细表渲染对应行', async () => {
    render(<AiCostPage />)
    expect(await screen.findByText('2026-11-01')).toBeInTheDocument()
    expect(screen.getByText('deepseek-v4-pro')).toBeInTheDocument()
    expect(screen.getByText('deepseek')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('无用量时展示「暂无调用记录」空状态', async () => {
    getAiUsageReportMock.mockResolvedValue(
      makeReport({
        daily: [],
        byModel: [],
        byUser: [],
        totals: {
          today: { tokens: 0, costCny: 0, calls: 0 },
          month: { tokens: 0, costCny: 0, calls: 0 },
          window: { tokens: 0, costCny: 0, calls: 0 },
        },
      }),
    )
    render(<AiCostPage />)
    expect((await screen.findAllByText('暂无调用记录')).length).toBe(3)
  })

  it('切换统计窗口为 7 天后重新请求', async () => {
    render(<AiCostPage />)
    await screen.findByText('统计区间：2026-10-03 至 2026-11-01')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } })
    await waitFor(() => expect(getAiUsageReportMock).toHaveBeenLastCalledWith(7))
  })

  it('加载失败展示错误文案', async () => {
    getAiUsageReportMock.mockRejectedValue(new Error('无权限执行该操作'))
    render(<AiCostPage />)
    expect(await screen.findByText('无权限执行该操作')).toBeInTheDocument()
  })
})
