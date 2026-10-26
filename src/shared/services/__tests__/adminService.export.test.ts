// adminService 审计导出与网络异常测试
//
// 覆盖场景：
// 1. exportAuditLogs 成功下载：过滤参数、鉴权头、下载文件名与 URL 释放
// 2. 无过滤条件时不拼接 query string
// 3. 401 清会话并广播、403 统一文案、其他状态码导出失败文案
// 4. 网络异常转换为「网络错误」文案（导出与普通请求）
//
// Mock 策略：替换 global fetch 返回构造响应，并 stub URL.createObjectURL / revokeObjectURL。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportAuditLogs, listUsers } from '../adminService'

const TOKEN = 'admin-session-token'
const originalFetch = globalThis.fetch
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let anchorClick: ReturnType<typeof vi.spyOn>

function mockFetch(response: Response) {
  const fn = vi.fn(async () => response)
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

function mockFetchReject(message: string) {
  const fn = vi.fn(async () => {
    throw new Error(message)
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

function seedSession(): void {
  sessionStorage.setItem('ydxl-auth-token', TOKEN)
  sessionStorage.setItem(
    'ydxl-auth-user',
    JSON.stringify({ id: 'u-admin', username: 'boss', displayName: '管理员', role: 'admin' })
  )
}

describe('adminService 导出与网络异常', () => {
  beforeEach(() => {
    seedSession()
    createObjectURL = vi.fn(() => 'blob:mock-url')
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    })
    anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    sessionStorage.clear()
    anchorClick.mockRestore()
  })

  it('成功导出 CSV：携带过滤参数与鉴权头并触发下载', async () => {
    const fetchMock = mockFetch(
      new Response(new Blob(['id,action\n1,login'], { type: 'text/csv' }), { status: 200 })
    )

    await exportAuditLogs({
      userId: 'u-1',
      action: 'auth.login.success',
      from: 100,
      to: 200,
      limit: 20,
      offset: 40,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/admin/logs/export?')
    expect(url).toContain('userId=u-1')
    expect(url).toContain('action=auth.login.success')
    expect(url).toContain('from=100')
    expect(url).toContain('to=200')
    expect(url).toContain('limit=20')
    expect(url).toContain('offset=40')
    expect((init.headers as Record<string, string>)['x-user-token']).toBe(TOKEN)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('无过滤条件时导出 URL 不带查询串', async () => {
    const fetchMock = mockFetch(new Response(new Blob(['x']), { status: 200 }))

    await exportAuditLogs()

    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('/api/admin/logs/export')
    expect(url).not.toContain('?')
  })

  it('401 时清除会话并广播 unauthorized', async () => {
    mockFetch(new Response('{}', { status: 401 }))
    const listener = vi.fn()
    window.addEventListener('ydxl:unauthorized', listener)

    await expect(exportAuditLogs()).rejects.toThrow('会话已失效，请重新登录')

    expect(sessionStorage.getItem('ydxl-auth-token')).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('ydxl:unauthorized', listener)
  })

  it('403 时抛出统一无权限文案', async () => {
    mockFetch(new Response('{}', { status: 403 }))

    await expect(exportAuditLogs()).rejects.toThrow('无权限执行该操作')
  })

  it('其他状态码提示导出失败及状态码', async () => {
    mockFetch(new Response('{}', { status: 500 }))

    await expect(exportAuditLogs()).rejects.toThrow('导出失败（500）')
  })

  it('导出网络异常转换为网络错误文案', async () => {
    mockFetchReject('connection reset')

    await expect(exportAuditLogs()).rejects.toThrow('网络错误: connection reset')
  })

  it('普通请求网络异常转换为网络错误文案', async () => {
    mockFetchReject('dns failure')

    await expect(listUsers()).rejects.toThrow('网络错误: dns failure')
  })
})
