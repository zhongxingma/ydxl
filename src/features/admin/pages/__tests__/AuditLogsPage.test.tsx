// 审计日志页
//
// 覆盖加载态与空状态、日志表格字段、admin / teacher 入口差异、过滤查询、
// 分页边界、CSV 导出（成功 / 失败 / 导出中）与加载失败。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  exportAuditLogs,
  listAuditLogs,
  type AuditLogEntry,
} from '@/shared/services/adminService'
import { getCurrentUser } from '@/shared/services/authService'
import AuditLogsPage from '../AuditLogsPage'

vi.mock('@/shared/services/adminService', () => ({
  listAuditLogs: vi.fn(),
  exportAuditLogs: vi.fn(),
}))

vi.mock('@/shared/services/authService', () => ({
  getCurrentUser: vi.fn(),
}))

const listMock = vi.mocked(listAuditLogs)
const exportMock = vi.mocked(exportAuditLogs)
const userMock = vi.mocked(getCurrentUser)

const adminUser = {
  id: 'u1',
  username: 'admin',
  displayName: '管理员',
  role: 'admin',
}

function makeLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'log-1',
    userId: 'u1',
    username: 'admin',
    action: 'auth.login.success',
    resource: 'users',
    resourceId: 'u1',
    result: 'success',
    detail: 'ok',
    ip: '1.2.3.4',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditLogsPage />
    </MemoryRouter>,
  )
}

function pageResult(items: AuditLogEntry[], total = items.length) {
  return { items, total, limit: 50, offset: 0 }
}

describe('AuditLogsPage 审计日志页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userMock.mockReturnValue(adminUser)
    listMock.mockResolvedValue(pageResult([makeLog()]))
    exportMock.mockResolvedValue(undefined)
  })

  it('加载中展示占位，完成后渲染日志表格与 admin 入口', async () => {
    let resolveList!: (value: ReturnType<typeof pageResult>) => void
    listMock.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )
    renderPage()

    expect(screen.getByText('加载中...')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '班级学情' })).toHaveAttribute(
      'href',
      '/admin/class-stats',
    )
    expect(screen.getByRole('link', { name: '用户管理' })).toHaveAttribute(
      'href',
      '/admin',
    )

    resolveList(pageResult([makeLog()]))

    expect(await screen.findByText('auth.login.success')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('u1')).toBeInTheDocument()
    expect(screen.getByText('success')).toBeInTheDocument()
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.getByText('共 1 条')).toBeInTheDocument()
  })

  it('teacher 不展示用户管理入口；未登录同样不展示', async () => {
    userMock.mockReturnValue({ ...adminUser, role: 'teacher' })
    const { unmount } = renderPage()
    await screen.findByText('auth.login.success')
    expect(screen.queryByRole('link', { name: '用户管理' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '班级学情' })).toBeInTheDocument()
    unmount()

    userMock.mockReturnValue(null)
    renderPage()
    await screen.findByText('auth.login.success')
    expect(screen.queryByRole('link', { name: '用户管理' })).not.toBeInTheDocument()
  })

  it('空结果展示暂无日志', async () => {
    listMock.mockResolvedValue(pageResult([], 0))
    renderPage()

    expect(await screen.findByText('暂无日志')).toBeInTheDocument()
    expect(screen.getByText('共 0 条')).toBeInTheDocument()
  })

  it('空字段与未知结果：使用占位与默认样式', async () => {
    listMock.mockResolvedValue(
      pageResult(
        [
          makeLog({
            id: 'log-2',
            username: null,
            resource: null,
            resourceId: null,
            result: 'unknown',
            ip: null,
            detail: null,
            createdAt: null,
          }),
        ],
        1,
      ),
    )
    renderPage()

    expect(await screen.findByText('unknown')).toBeInTheDocument()
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(5)
  })

  it('加载失败：展示错误信息，非 Error 使用兜底文案', async () => {
    listMock.mockRejectedValueOnce(new Error('查询失败'))
    const { unmount } = renderPage()
    expect(await screen.findByText('查询失败')).toBeInTheDocument()
    unmount()

    listMock.mockRejectedValueOnce('oops')
    renderPage()
    expect(await screen.findByText('加载审计日志失败')).toBeInTheDocument()
  })

  it('过滤查询：提交后重置分页并携带过滤条件', async () => {
    renderPage()
    await screen.findByText('auth.login.success')

    fireEvent.change(screen.getByPlaceholderText('动作（如 auth.login.success）'), {
      target: { value: ' auth.login.success ' },
    })
    fireEvent.change(screen.getByPlaceholderText('操作者用户 ID'), {
      target: { value: ' u1 ' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '查询' }).closest('form')!)

    expect(await screen.findByText('共 1 条（已过滤）')).toBeInTheDocument()
    expect(listMock).toHaveBeenLastCalledWith({
      action: 'auth.login.success',
      userId: 'u1',
      limit: 50,
      offset: 0,
    })
  })

  it('分页：下一页与上一页按 50 条步进并正确禁用', async () => {
    listMock.mockResolvedValue(pageResult([makeLog()], 120))
    renderPage()
    await screen.findByText('auth.login.success')

    const prev = screen.getByRole('button', { name: '上一页' })
    const next = screen.getByRole('button', { name: '下一页' })
    expect(prev).toBeDisabled()
    expect(next).toBeEnabled()

    fireEvent.click(next)
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith({ limit: 50, offset: 50 }),
    )
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith({ limit: 50, offset: 0 }),
    )
  })

  it('末页时下一页禁用', async () => {
    listMock.mockResolvedValue(pageResult([makeLog()], 60))
    renderPage()
    await screen.findByText('auth.login.success')

    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled(),
    )
    expect(screen.getByText('共 60 条')).toBeInTheDocument()
  })

  it('导出 CSV：导出中禁用按钮，成功后恢复', async () => {
    let resolveExport!: () => void
    exportMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExport = resolve
      }),
    )
    renderPage()
    await screen.findByText('auth.login.success')

    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))

    const pending = await screen.findByRole('button', { name: '导出中...' })
    expect(pending).toBeDisabled()
    expect(exportMock).toHaveBeenCalledWith({})

    await act(async () => {
      resolveExport()
    })
    expect(await screen.findByRole('button', { name: '导出 CSV' })).toBeEnabled()
  })

  it('导出失败：展示错误，非 Error 使用兜底文案', async () => {
    exportMock.mockRejectedValueOnce(new Error('导出失败（500）'))
    const { unmount } = renderPage()
    await screen.findByText('auth.login.success')

    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    expect(await screen.findByText('导出失败（500）')).toBeInTheDocument()
    unmount()

    exportMock.mockRejectedValueOnce('oops')
    renderPage()
    await screen.findByText('auth.login.success')
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    expect(await screen.findByText('导出失败')).toBeInTheDocument()
  })

  it('结果标签按 success / denied / failed 区分', async () => {
    listMock.mockResolvedValue(
      pageResult(
        [
          makeLog({ id: 'l1', result: 'success' }),
          makeLog({ id: 'l2', result: 'denied' }),
          makeLog({ id: 'l3', result: 'failed' }),
        ],
        3,
      ),
    )
    renderPage()
    await screen.findAllByText('auth.login.success')

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('success')).toBeInTheDocument()
    expect(within(rows[2]).getByText('denied')).toBeInTheDocument()
    expect(within(rows[3]).getByText('failed')).toBeInTheDocument()
  })
})
