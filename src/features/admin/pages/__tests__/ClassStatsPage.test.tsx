// ClassStatsPage 班级学情页单元测试
//
// 覆盖场景：
// 1. 默认按近 30 天加载，渲染标题、说明、统计区间、汇总卡片与学员明细
// 2. 汇总数值格式化：正确率百分比四舍五入、阅读时长按小时 / 分钟展示
// 3. 学员明细表头与行数据，最近学习为空时显示占位符
// 4. 无学员时显示「暂无学员」空状态
// 5. 切换统计窗口（7 / 30 / 90 天）重新请求并展示加载态
// 6. 加载失败（Error / 非 Error）展示错误文案且不渲染表格
//
// 环境依赖：
// - adminService.getClassStats 整体 mock，避免真实 fetch
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { ClassStatsResult } from '@/shared/services/adminService'
import { getClassStats } from '@/shared/services/adminService'
import ClassStatsPage from '../ClassStatsPage'

vi.mock('@/shared/services/adminService', () => ({
  getClassStats: vi.fn(),
}))

const getClassStatsMock = vi.mocked(getClassStats)

function makeStats(overrides: Partial<ClassStatsResult> = {}): ClassStatsResult {
  return {
    days: 30,
    from: '2026-09-26',
    to: '2026-10-26',
    summary: {
      studentCount: 12,
      activeStudentCount: 8,
      totalArticlesRead: 40,
      totalWordsLearned: 120,
      totalWordsReviewed: 60,
      avgArticlesRead: 3.33,
      avgCorrectRate: 0.756,
      totalReadingDurationSec: 3661,
      totalSessions: 25,
    },
    students: [
      {
        userId: 'u1',
        username: 'alice',
        displayName: 'Alice',
        articlesRead: 5,
        wordsLearned: 20,
        wordsReviewed: 10,
        wordsMastered: 6,
        activeDays: 7,
        streak: 3,
        lastActiveDate: '2026-10-25',
        correctRate: 0.8,
      },
    ],
    ...overrides,
  }
}

describe('ClassStatsPage 班级学情', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getClassStatsMock.mockResolvedValue(makeStats())
  })

  it('默认按近 30 天加载并渲染标题、说明与统计区间', async () => {
    render(<ClassStatsPage />)

    expect(screen.getByRole('heading', { name: '班级学情' })).toBeInTheDocument()
    expect(
      screen.getByText(
        '汇总全班学员的学习数据，仅统计在用账号，不含任何学习内容。每次查看都会被记录。'
      )
    ).toBeInTheDocument()

    expect(await screen.findByText('统计区间：2026-09-26 至 2026-10-26')).toBeInTheDocument()
    expect(getClassStatsMock).toHaveBeenCalledTimes(1)
    expect(getClassStatsMock).toHaveBeenCalledWith(30)
  })

  it('渲染六个汇总卡片并按百分比与时长格式化数值', async () => {
    render(<ClassStatsPage />)

    await screen.findByText('统计区间：2026-09-26 至 2026-10-26')

    const cards: Array<[string, string]> = [
      ['学员总数', '12'],
      ['活跃学员', '8'],
      ['阅读篇数', '40'],
      ['生词学习', '120'],
      ['人均正确率', '76%'],
      ['累计阅读时长', '1 小时 1 分'],
    ]
    for (const [label, value] of cards) {
      // 「生词学习」等标签同时出现在汇总卡片与表头，故用 getAllByText 判断存在
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
      expect(screen.getByText(value)).toBeInTheDocument()
    }
  })

  it('阅读时长不足一小时时仅展示分钟', async () => {
    getClassStatsMock.mockResolvedValue(
      makeStats({
        summary: {
          ...makeStats().summary,
          totalReadingDurationSec: 2700,
        },
      })
    )

    render(<ClassStatsPage />)

    expect(await screen.findByText('45 分钟')).toBeInTheDocument()
  })

  it('渲染学员明细表头与行数据，空最近学习显示占位符', async () => {
    getClassStatsMock.mockResolvedValue(
      makeStats({
        students: [
          {
            userId: 'u1',
            username: 'alice',
            displayName: 'Alice',
            articlesRead: 5,
            wordsLearned: 20,
            wordsReviewed: 10,
            wordsMastered: 6,
            activeDays: 7,
            streak: 3,
            lastActiveDate: null,
            correctRate: 0.8,
          },
          {
            userId: 'u2',
            username: 'bob',
            displayName: 'Bob',
            articlesRead: 2,
            wordsLearned: 4,
            wordsReviewed: 1,
            wordsMastered: 0,
            activeDays: 2,
            streak: 0,
            lastActiveDate: '2026-10-20',
            correctRate: 0.995,
          },
        ],
      })
    )

    render(<ClassStatsPage />)

    const aliceRow = await screen.findByRole('row', { name: /Alice/ })
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual([
      '学员',
      '阅读',
      '生词学习',
      '复习',
      '已掌握',
      '正确率',
      '活跃天数',
      '连续打卡',
      '最近学习',
    ])

    const aliceCells = within(aliceRow).getAllByRole('cell')
    expect(aliceCells.map((cell) => cell.textContent)).toEqual([
      'Alice',
      '5',
      '20',
      '10',
      '6',
      '80%',
      '7',
      '3',
      '-',
    ])

    const bobRow = screen.getByRole('row', { name: /Bob/ })
    const bobCells = within(bobRow).getAllByRole('cell')
    // 0.995 四舍五入为 100%
    expect(bobCells[5].textContent).toBe('100%')
    expect(bobCells[8].textContent).toBe('2026-10-20')
  })

  it('无学员时显示「暂无学员」空状态', async () => {
    getClassStatsMock.mockResolvedValue(makeStats({ students: [] }))

    render(<ClassStatsPage />)

    expect(await screen.findByText('暂无学员')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('切换统计窗口为近 7 天后重新请求并展示加载态', async () => {
    let resolveSecond: (value: ClassStatsResult) => void = () => {}
    getClassStatsMock
      .mockResolvedValueOnce(makeStats())
      .mockReturnValueOnce(
        new Promise<ClassStatsResult>((resolve) => {
          resolveSecond = resolve
        })
      )

    render(<ClassStatsPage />)

    await screen.findByText('统计区间：2026-09-26 至 2026-10-26')

    const select = screen.getByRole('combobox')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '近 7 天',
      '近 30 天',
      '近 90 天',
    ])

    fireEvent.change(select, { target: { value: '7' } })

    expect(screen.getByText('加载中...')).toBeInTheDocument()
    await waitFor(() => expect(getClassStatsMock).toHaveBeenLastCalledWith(7))

    await act(async () => {
      resolveSecond(makeStats({ days: 7, from: '2026-10-19', to: '2026-10-26' }))
    })

    expect(await screen.findByText('统计区间：2026-10-19 至 2026-10-26')).toBeInTheDocument()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
  })

  it('加载失败时展示服务端错误消息且不渲染表格', async () => {
    getClassStatsMock.mockRejectedValue(new Error('无权限查看班级学情'))

    render(<ClassStatsPage />)

    expect(await screen.findByText('无权限查看班级学情')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
  })

  it('加载失败且错误非 Error 时展示兜底文案', async () => {
    getClassStatsMock.mockRejectedValue('boom')

    render(<ClassStatsPage />)

    expect(await screen.findByText('加载班级学情失败')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
