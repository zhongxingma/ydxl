// LoginPage 登录页单元测试
//
// 覆盖场景：
// 1. 已登录用户访问登录页时重定向首页
// 2. 表单渲染、输入更新与提交（用户名去空格）
// 3. 登录失败：Error 透传消息 / 非 Error 使用兜底文案，按钮恢复
// 4. 提交中禁用按钮并阻止重复提交
//
// Mock 策略：mock authService 的 login / getToken；MemoryRouter 提供路由与重定向上下文
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { login, getToken, type CurrentUser } from '@/shared/services/authService'
import LoginPage from '../LoginPage'

vi.mock('@/shared/services/authService', () => ({
  login: vi.fn(),
  getToken: vi.fn(),
}))

const loginMock = vi.mocked(login)
const getTokenMock = vi.mocked(getToken)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>首页占位</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function fillAndSubmit(username = 'alice', password = 'secret') {
  fireEvent.change(screen.getByPlaceholderText('请输入用户名'), {
    target: { value: username },
  })
  fireEvent.change(screen.getByPlaceholderText('请输入密码'), {
    target: { value: password },
  })
  fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
}

describe('LoginPage 登录页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTokenMock.mockReturnValue(null)
    loginMock.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      displayName: 'Alice',
      role: 'student',
    })
  })

  it('已登录用户直接重定向首页且不渲染表单', () => {
    getTokenMock.mockReturnValue('existing-token')

    renderPage()

    expect(screen.getByText('首页占位')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('请输入用户名')).not.toBeInTheDocument()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('渲染标题、说明、输入框与登录按钮', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '英语学习' })).toBeInTheDocument()
    expect(screen.getByText('请使用老师分配的账号登录')).toBeInTheDocument()
    expect(screen.getByLabelText('用户名')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('输入用户名与密码会更新受控表单', () => {
    renderPage()

    const username = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement
    const password = screen.getByPlaceholderText('请输入密码') as HTMLInputElement
    fireEvent.change(username, { target: { value: 'alice' } })
    fireEvent.change(password, { target: { value: 'secret' } })

    expect(username).toHaveValue('alice')
    expect(password).toHaveValue('secret')
  })

  it('提交时用户名去除首尾空格并调用登录接口', async () => {
    renderPage()

    fillAndSubmit('  alice  ', 'secret')

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('alice', 'secret'))
    // 成功后保持提交中状态，等待整页跳转
    expect(screen.getByRole('button', { name: '登录中...' })).toBeDisabled()
  })

  it('登录失败（Error）展示服务端消息并恢复按钮', async () => {
    loginMock.mockRejectedValue(new Error('用户名或密码错误'))
    renderPage()

    fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误')
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
  })

  it('登录失败（非 Error）展示兜底文案', async () => {
    loginMock.mockRejectedValue('network down')
    renderPage()

    fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '登录失败，请检查用户名和密码'
    )
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
  })

  it('提交中按钮禁用且重复提交只调用一次登录接口', async () => {
    let resolveLogin: (value: CurrentUser) => void = () => {}
    loginMock.mockReturnValue(
      new Promise<CurrentUser>((resolve) => {
        resolveLogin = resolve
      })
    )
    renderPage()

    const form = screen.getByRole('button', { name: '登录' }).closest('form')!
    fireEvent.change(screen.getByPlaceholderText('请输入用户名'), {
      target: { value: 'alice' },
    })
    fireEvent.change(screen.getByPlaceholderText('请输入密码'), {
      target: { value: 'secret' },
    })
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(loginMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '登录中...' })).toBeDisabled()

    await act(async () => {
      resolveLogin({
        id: 'u1',
        username: 'alice',
        displayName: 'Alice',
        role: 'student',
      })
    })

    expect(loginMock).toHaveBeenCalledTimes(1)
  })
})
