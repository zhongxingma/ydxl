// RequireAdmin 角色守卫测试（多用户 P1/P2）
// 覆盖：未登录重定向首页、student 重定向首页、admin 渲染子路由、
//       roles prop 放宽（teacher 访问日志页通过 / student 仍拒绝）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RequireAdmin from '../RequireAdmin'

function renderAt(path: string, roles?: readonly string[]): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireAdmin roles={roles} />}>
          <Route path="/admin" element={<div>管理页面内容</div>} />
          <Route path="/admin/logs" element={<div>审计日志内容</div>} />
        </Route>
        <Route path="/" element={<div>首页内容</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function seedUser(role: string | null): void {
  if (role === null) return
  sessionStorage.setItem(
    'ydxl-auth-user',
    JSON.stringify({ id: 'u-1', username: 'u', displayName: '用户', role }),
  )
  sessionStorage.setItem('ydxl-auth-token', 'token-123')
}

describe('RequireAdmin', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('未登录：重定向首页', () => {
    renderAt('/admin')
    expect(screen.queryByText('管理页面内容')).toBeNull()
    expect(screen.getByText('首页内容')).toBeInTheDocument()
  })

  it('student 登录：重定向首页', () => {
    seedUser('student')
    renderAt('/admin')
    expect(screen.queryByText('管理页面内容')).toBeNull()
    expect(screen.getByText('首页内容')).toBeInTheDocument()
  })

  it('teacher 登录：重定向首页', () => {
    seedUser('teacher')
    renderAt('/admin')
    expect(screen.queryByText('管理页面内容')).toBeNull()
    expect(screen.getByText('首页内容')).toBeInTheDocument()
  })

  it('admin 登录：渲染子路由内容', () => {
    seedUser('admin')
    renderAt('/admin')
    expect(screen.getByText('管理页面内容')).toBeInTheDocument()
  })

  it('roles 放宽：teacher 访问日志页（roles=[admin,teacher]）渲染内容', () => {
    seedUser('teacher')
    renderAt('/admin/logs', ['admin', 'teacher'])
    expect(screen.getByText('审计日志内容')).toBeInTheDocument()
  })

  it('roles 放宽后 student 仍被拒绝', () => {
    seedUser('student')
    renderAt('/admin/logs', ['admin', 'teacher'])
    expect(screen.queryByText('审计日志内容')).toBeNull()
    expect(screen.getByText('首页内容')).toBeInTheDocument()
  })
})
