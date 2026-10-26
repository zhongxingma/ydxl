// 用户管理页（多用户 P1）
//
// 覆盖初始加载与失败、创建用户（成功 / 失败 / 处理中）、启用禁用、角色修改、
// 重置密码行内表单、操作提示自动消失与页面导航链接。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  createUser,
  listUsers,
  resetPassword,
  setUserRole,
  setUserStatus,
  type AdminUser,
} from '@/shared/services/adminService'
import AdminUsersPage from '../AdminUsersPage'

vi.mock('@/shared/services/adminService', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  setUserStatus: vi.fn(),
  setUserRole: vi.fn(),
  resetPassword: vi.fn(),
}))

const listMock = vi.mocked(listUsers)
const createMock = vi.mocked(createUser)
const statusMock = vi.mocked(setUserStatus)
const roleMock = vi.mocked(setUserRole)
const resetMock = vi.mocked(resetPassword)

const adminUser: AdminUser = {
  id: 'u1',
  username: 'admin',
  displayName: '管理员',
  role: 'admin',
  status: 'active',
  failedLogins: 0,
  lockedUntil: null,
  createdAt: 1_700_000_000_000,
}

const studentUser: AdminUser = {
  id: 'u2',
  username: 'stu',
  displayName: '小明',
  role: 'student',
  status: 'disabled',
  failedLogins: 3,
  lockedUntil: null,
  createdAt: null,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>,
  )
}

// 等待初始用户列表加载完成
async function renderLoaded() {
  const utils = renderPage()
  await screen.findByText('admin')
  return utils
}

describe('AdminUsersPage 用户管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([adminUser, studentUser])
    createMock.mockResolvedValue({
      ...studentUser,
      id: 'u3',
      username: 'newstudent',
      displayName: '张三',
      role: 'student',
      status: 'active',
    })
    statusMock.mockResolvedValue({ ...adminUser, status: 'disabled' })
    roleMock.mockResolvedValue({ ...studentUser, role: 'teacher' })
    resetMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始加载：展示加载态，完成后渲染用户表格与导航链接', async () => {
    let resolveUsers!: (value: AdminUser[]) => void
    listMock.mockReturnValue(
      new Promise<AdminUser[]>((resolve) => {
        resolveUsers = resolve
      }),
    )
    renderPage()

    expect(screen.getByText('加载中...')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '班级学情' })).toHaveAttribute(
      'href',
      '/admin/class-stats',
    )
    expect(screen.getByRole('link', { name: '审计日志' })).toHaveAttribute(
      'href',
      '/admin/logs',
    )

    resolveUsers([adminUser, studentUser])
    expect(await screen.findByText('admin')).toBeInTheDocument()
    expect(screen.getByText('stu')).toBeInTheDocument()
    // 状态标签与失败次数
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(screen.getByText('已禁用')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // 创建时间为 null 时显示占位
    expect(screen.getAllByText('-')).toHaveLength(1)
  })

  it('加载失败：展示错误信息；非 Error 时使用兜底文案', async () => {
    listMock.mockRejectedValueOnce(new Error('服务端不可用'))
    const { unmount } = renderPage()
    expect(await screen.findByText('服务端不可用')).toBeInTheDocument()
    unmount()

    listMock.mockRejectedValueOnce('oops')
    renderPage()
    expect(await screen.findByText('加载用户列表失败')).toBeInTheDocument()
  })

  it('创建用户成功：提交表单、展示提示、重置表单并刷新列表', async () => {
    await renderLoaded()

    const form = screen.getByRole('button', { name: '创建用户' }).closest('form')!
    fireEvent.change(screen.getByPlaceholderText('用户名（字母/数字/下划线）'), {
      target: { value: 'newstudent' },
    })
    fireEvent.change(screen.getByPlaceholderText('显示名（学生姓名）'), {
      target: { value: '张三' },
    })
    fireEvent.change(screen.getByPlaceholderText('初始密码（至少 6 位）'), {
      target: { value: '123456' },
    })
    fireEvent.change(within(form).getByRole('combobox'), { target: { value: 'teacher' } })
    fireEvent.submit(form)

    expect(await screen.findByText('已创建用户 张三（学生）')).toBeInTheDocument()
    expect(createMock).toHaveBeenCalledWith({
      username: 'newstudent',
      displayName: '张三',
      password: '123456',
      role: 'teacher',
    })
    expect(listMock).toHaveBeenCalledTimes(2)
    // 表单已重置
    expect(screen.getByPlaceholderText('用户名（字母/数字/下划线）')).toHaveValue('')
    expect(screen.getByPlaceholderText('显示名（学生姓名）')).toHaveValue('')
    expect(screen.getByPlaceholderText('初始密码（至少 6 位）')).toHaveValue('')
    expect(within(form).getByRole('combobox')).toHaveValue('student')
  })

  it('创建用户处理中：按钮禁用并显示创建中', async () => {
    let resolveCreate!: (value: AdminUser) => void
    createMock.mockReturnValue(
      new Promise<AdminUser>((resolve) => {
        resolveCreate = resolve
      }),
    )
    await renderLoaded()

    const submit = screen.getByRole('button', { name: '创建用户' })
    fireEvent.submit(submit.closest('form')!)

    const pending = await screen.findByRole('button', { name: '创建中...' })
    expect(pending).toBeDisabled()

    resolveCreate({ ...studentUser, displayName: '李四' })
    expect(await screen.findByText(/已创建用户 李四/)).toBeInTheDocument()
  })

  it('创建用户失败：展示错误并恢复按钮', async () => {
    createMock.mockRejectedValueOnce(new Error('用户名已存在'))
    await renderLoaded()

    fireEvent.change(screen.getByPlaceholderText('用户名（字母/数字/下划线）'), {
      target: { value: 'admin' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '创建用户' }).closest('form')!)

    expect(await screen.findByText('用户名已存在')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建用户' })).toBeEnabled()
  })

  it('创建用户非 Error 失败：使用兜底文案', async () => {
    createMock.mockRejectedValueOnce('bad')
    await renderLoaded()

    fireEvent.submit(screen.getByRole('button', { name: '创建用户' }).closest('form')!)

    expect(await screen.findByText('创建用户失败')).toBeInTheDocument()
  })

  it('禁用用户：调用状态接口、展示提示并刷新列表', async () => {
    await renderLoaded()
    const row = screen.getByText('admin').closest('tr')!

    fireEvent.click(within(row).getByRole('button', { name: '禁用' }))

    expect(await screen.findByText('已禁用 管理员')).toBeInTheDocument()
    expect(statusMock).toHaveBeenCalledWith('u1', 'disabled')
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('启用用户：对已禁用用户调用 active', async () => {
    await renderLoaded()
    const row = screen.getByText('stu').closest('tr')!

    fireEvent.click(within(row).getByRole('button', { name: '启用' }))

    expect(await screen.findByText('已启用 小明')).toBeInTheDocument()
    expect(statusMock).toHaveBeenCalledWith('u2', 'active')
  })

  it('状态操作失败：展示错误信息', async () => {
    statusMock.mockRejectedValueOnce(new Error('状态更新失败'))
    await renderLoaded()
    const row = screen.getByText('admin').closest('tr')!

    fireEvent.click(within(row).getByRole('button', { name: '禁用' }))

    expect(await screen.findByText('状态更新失败')).toBeInTheDocument()
  })

  it('修改角色：调用角色接口并提示登录态失效', async () => {
    await renderLoaded()
    const row = screen.getByText('stu').closest('tr')!

    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'teacher' } })

    expect(
      await screen.findByText('已将 小明 的角色改为 教师（其登录态已失效）'),
    ).toBeInTheDocument()
    expect(roleMock).toHaveBeenCalledWith('u2', 'teacher')
  })

  it('角色未变化时不发起请求', async () => {
    await renderLoaded()
    const row = screen.getByText('admin').closest('tr')!

    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'admin' } })

    expect(roleMock).not.toHaveBeenCalled()
  })

  it('修改角色失败：展示错误信息', async () => {
    roleMock.mockRejectedValueOnce(new Error('角色更新失败'))
    await renderLoaded()
    const row = screen.getByText('stu').closest('tr')!

    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'admin' } })

    expect(await screen.findByText('角色更新失败')).toBeInTheDocument()
  })

  it('重置密码：展开表单、校验长度并提交成功', async () => {
    await renderLoaded()
    const row = screen.getByText('admin').closest('tr')!

    fireEvent.click(within(row).getByRole('button', { name: '重置密码' }))
    const input = within(row).getByPlaceholderText('新密码（至少 6 位）')
    expect(within(row).getByRole('button', { name: '确认' })).toBeDisabled()

    fireEvent.change(input, { target: { value: '12345' } })
    expect(within(row).getByRole('button', { name: '确认' })).toBeDisabled()

    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(within(row).getByRole('button', { name: '确认' }))

    expect(
      await screen.findByText('已重置 管理员 的密码，其全部登录已下线'),
    ).toBeInTheDocument()
    expect(resetMock).toHaveBeenCalledWith('u1', '123456')
    expect(within(row).queryByPlaceholderText('新密码（至少 6 位）')).not.toBeInTheDocument()
  })

  it('重置密码取消：收起行内表单', async () => {
    await renderLoaded()
    const row = screen.getByText('admin').closest('tr')!

    fireEvent.click(within(row).getByRole('button', { name: '重置密码' }))
    expect(within(row).getByPlaceholderText('新密码（至少 6 位）')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: '取消' }))
    expect(within(row).queryByPlaceholderText('新密码（至少 6 位）')).not.toBeInTheDocument()
  })

  it('重置密码失败：展示错误信息', async () => {
    resetMock.mockRejectedValueOnce(new Error('重置失败'))
    await renderLoaded()
    const row = screen.getByText('admin').closest('tr')!

    fireEvent.click(within(row).getByRole('button', { name: '重置密码' }))
    fireEvent.change(within(row).getByPlaceholderText('新密码（至少 6 位）'), {
      target: { value: '123456' },
    })
    fireEvent.click(within(row).getByRole('button', { name: '确认' }))

    expect(await screen.findByText('重置失败')).toBeInTheDocument()
  })

  it('操作提示 5 秒后自动消失', async () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    await renderLoaded()

    const row = screen.getByText('admin').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '禁用' }))
    expect(await screen.findByText('已禁用 管理员')).toBeInTheDocument()

    // 找到提示自动消失的 5 秒定时器并手动触发（避免真实等待 5 秒）
    const entry = timeoutSpy.mock.calls.find(([, delay]) => delay === 5000)
    expect(entry).toBeDefined()
    act(() => {
      window.clearTimeout(entry![0] as unknown as number)
      ;(entry![0] as () => void)()
    })

    expect(screen.queryByText('已禁用 管理员')).not.toBeInTheDocument()
    timeoutSpy.mockRestore()
  })
})
