// SessionSection 登录设备管理组件单元测试
//
// 覆盖场景：
// 1. 未登录时不请求会话列表，仍渲染区域标题与占位文案
// 2. 加载中展示加载提示，加载完成后渲染设备列表
// 3. 会话列表渲染脱敏指纹、当前设备徽章、IP 与 UA，当前设备按钮禁用
// 4. IP / UA 缺失时显示占位符且不拼接 UA
// 5. 加载失败（Error / 非 Error）展示错误文案
// 6. 移除设备：确认取消不调用服务、成功后重新加载、失败展示错误并恢复按钮
// 7. 全端下线：确认取消不调用服务、成功后按钮保持禁用、失败展示错误并恢复按钮
// 8. 请求进行中所有操作按钮均禁用
//
// 环境依赖：
// - authService 整体 mock，避免真实 fetch / sessionStorage
// - useTranslation 默认使用 zh-CN 字典（无需 mock）
// - jsdom 未实现导航，成功分支调用 location.assign 时会输出一条
//   "Not implemented: navigation" 提示，无法通过 spy 拦截（Location 属性不可重定义）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { SessionInfo } from '@/shared/services/authService'
import {
  getCurrentUser,
  listSessions,
  logoutAll,
  revokeSession,
} from '@/shared/services/authService'
import SessionSection from '../SessionSection'

vi.mock('@/shared/services/authService', () => ({
  getCurrentUser: vi.fn(),
  listSessions: vi.fn(),
  logoutAll: vi.fn(),
  revokeSession: vi.fn(),
}))

const getCurrentUserMock = vi.mocked(getCurrentUser)
const listSessionsMock = vi.mocked(listSessions)
const logoutAllMock = vi.mocked(logoutAll)
const revokeSessionMock = vi.mocked(revokeSession)

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 1,
    tokenFingerprint: 'abcd1234…wxyz',
    ip: '10.0.0.1',
    userAgent: 'Chrome/120',
    createdAt: 1_700_000_000,
    expiresAt: 1_800_000_000,
    current: false,
    ...overrides,
  }
}

describe('SessionSection 登录设备管理', () => {
  let confirmMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUserMock.mockReturnValue({
      id: 'u1',
      username: 'alice',
      displayName: 'Alice',
      role: 'student',
    })
    listSessionsMock.mockResolvedValue([makeSession({ current: true })])
    logoutAllMock.mockResolvedValue()
    revokeSessionMock.mockResolvedValue()
    confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('未登录时不请求会话列表，渲染标题与占位文案', () => {
    getCurrentUserMock.mockReturnValue(null)

    render(<SessionSection />)

    expect(screen.getByText('登录设备')).toBeInTheDocument()
    expect(
      screen.getByText('管理你的登录会话，移除陌生设备或一键全端下线')
    ).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
    expect(listSessionsMock).not.toHaveBeenCalled()
  })

  it('加载中展示提示，完成后渲染设备列表', async () => {
    let resolveSessions: (items: SessionInfo[]) => void = () => {}
    listSessionsMock.mockReturnValue(
      new Promise<SessionInfo[]>((resolve) => {
        resolveSessions = resolve
      })
    )

    render(<SessionSection />)

    expect(screen.getByText('加载中…')).toBeInTheDocument()

    await act(async () => {
      resolveSessions([makeSession()])
    })

    expect(await screen.findByText('abcd1234…wxyz')).toBeInTheDocument()
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument()
  })

  it('渲染当前设备徽章、IP 与 UA，并禁用当前设备的移除按钮', async () => {
    listSessionsMock.mockResolvedValue([
      makeSession({ sessionId: 7, current: true, userAgent: 'Chrome/120' }),
      makeSession({
        sessionId: 9,
        tokenFingerprint: 'efgh5678…mnop',
        ip: '192.168.1.8',
        userAgent: 'Safari/17',
        current: false,
      }),
    ])

    render(<SessionSection />)

    expect(await screen.findByText('efgh5678…mnop')).toBeInTheDocument()
    expect(screen.getByText('当前设备')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1 · Chrome/120')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.8 · Safari/17')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button', { name: '移除' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toBeDisabled()
    expect(buttons[1]).toBeEnabled()
    expect(screen.getByRole('button', { name: '全端下线' })).toBeEnabled()
  })

  it('IP 与 UA 缺失时显示占位符且不拼接 UA', async () => {
    listSessionsMock.mockResolvedValue([
      makeSession({ ip: null, userAgent: null }),
    ])

    render(<SessionSection />)

    expect(await screen.findByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
  })

  it('加载失败时展示服务端错误消息', async () => {
    listSessionsMock.mockRejectedValue(new Error('会话已过期'))

    render(<SessionSection />)

    expect(await screen.findByText('会话已过期')).toBeInTheDocument()
  })

  it('加载失败且错误非 Error 时展示「操作失败」', async () => {
    listSessionsMock.mockRejectedValue('boom')

    render(<SessionSection />)

    expect(await screen.findByText('操作失败')).toBeInTheDocument()
  })

  it('移除设备确认取消时不调用服务', async () => {
    listSessionsMock.mockResolvedValue([makeSession({ current: false })])
    confirmMock.mockReturnValue(false)

    render(<SessionSection />)

    const button = await screen.findByRole('button', { name: '移除' })
    fireEvent.click(button)

    expect(confirmMock).toHaveBeenCalledWith(
      '确认移除该登录设备？该设备将立即失效。'
    )
    expect(revokeSessionMock).not.toHaveBeenCalled()
  })

  it('移除设备成功后重新加载列表，请求期间按钮禁用', async () => {
    const active = makeSession({ sessionId: 3, current: false })
    listSessionsMock
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([
        makeSession({
          sessionId: 4,
          tokenFingerprint: 'zzzz9999…qqqq',
          current: true,
        }),
      ])

    let resolveRevoke: () => void = () => {}
    revokeSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRevoke = resolve
      })
    )

    render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '移除' }))

    await waitFor(() => expect(revokeSessionMock).toHaveBeenCalledWith(3))
    expect(screen.getByRole('button', { name: '移除' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '全端下线' })).toBeDisabled()

    await act(async () => {
      resolveRevoke()
    })

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('zzzz9999…qqqq')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全端下线' })).toBeEnabled()
  })

  it('移除设备失败时展示错误消息并恢复按钮', async () => {
    listSessionsMock.mockResolvedValue([makeSession({ current: false })])
    revokeSessionMock.mockRejectedValue(new Error('设备不存在'))

    render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '移除' }))

    expect(await screen.findByText('设备不存在')).toBeInTheDocument()
    expect(revokeSessionMock).toHaveBeenCalledWith(1)
    expect(screen.getByRole('button', { name: '移除' })).toBeEnabled()
  })

  it('移除设备失败且错误非 Error 时展示「操作失败」', async () => {
    listSessionsMock.mockResolvedValue([makeSession({ current: false })])
    revokeSessionMock.mockRejectedValue('boom')

    render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '移除' }))

    expect(await screen.findByText('操作失败')).toBeInTheDocument()
  })

  it('全端下线确认取消时不调用服务', async () => {
    confirmMock.mockReturnValue(false)

    render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '全端下线' }))

    expect(confirmMock).toHaveBeenCalledWith(
      '确认退出全部设备？你的所有登录会话（含当前）都会被强制下线。'
    )
    expect(logoutAllMock).not.toHaveBeenCalled()
  })

  it('全端下线成功后不展示错误，按钮在跳转前保持禁用', async () => {
    const { unmount } = render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '全端下线' }))

    await waitFor(() => expect(logoutAllMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('操作失败')).not.toBeInTheDocument()
    // 成功分支不重置 pending，跳转前按钮保持禁用
    expect(screen.getByRole('button', { name: '全端下线' })).toBeDisabled()
    unmount()
  })

  it('全端下线失败时展示错误消息且恢复按钮', async () => {
    logoutAllMock.mockRejectedValue(new Error('网络异常'))

    render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '全端下线' }))

    expect(await screen.findByText('网络异常')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全端下线' })).toBeEnabled()
  })

  it('全端下线失败且错误非 Error 时展示「操作失败」', async () => {
    logoutAllMock.mockRejectedValue('boom')

    render(<SessionSection />)

    fireEvent.click(await screen.findByRole('button', { name: '全端下线' }))

    expect(await screen.findByText('操作失败')).toBeInTheDocument()
  })
})
