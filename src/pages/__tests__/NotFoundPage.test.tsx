// NotFoundPage（404 兜底页）单元测试
//
// 覆盖场景：
// 1. 渲染 404 视觉锚点、标题与说明文案
// 2. 提供「返回首页」链接且指向 /
// 3. 未知路径下 App 路由兜底生效：渲染 NotFoundPage 而非空白内容区

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotFoundPage from '../NotFoundPage'
import App from '@/App'

// jsdom 无原生 window.matchMedia（Layout 的 useDarkMode 依赖），安装最小 stub
const originalMatchMedia = window.matchMedia
beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }
  // 多用户（P0）：App 路由在 RequireAuth 守卫之后，测试注入模拟会话令牌通过守卫
  sessionStorage.setItem('ydxl-auth-token', 'test-token')
  sessionStorage.setItem(
    'ydxl-auth-user',
    JSON.stringify({ id: 'u1', username: 'test', displayName: '测试', role: 'student' }),
  )
})
afterAll(() => {
  if (originalMatchMedia) {
    window.matchMedia = originalMatchMedia
  }
  sessionStorage.removeItem('ydxl-auth-token')
  sessionStorage.removeItem('ydxl-auth-user')
})

describe('NotFoundPage', () => {
  it('渲染 404 锚点、标题与说明文案', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText('页面不存在或已被移动')).toBeInTheDocument()
    expect(screen.getByText(/您访问的地址可能输入有误/)).toBeInTheDocument()
  })

  it('提供指向首页的「返回首页」链接', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: /返回首页/ })
    expect(link).toHaveAttribute('href', '/')
  })

  it('App 路由兜底：未知路径渲染 404 页而非空白', async () => {
    // App 内部自带 BrowserRouter，测试中直接渲染（jsdom 默认路径为 /）
    window.history.replaceState({}, '', '/some/unknown/path')
    render(<App />)

    // 路由组件为 React.lazy 懒加载，使用 findByText 等待 Suspense 解析完成
    expect(await screen.findByText('页面不存在或已被移动', {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('App 路由：已知路径不受兜底影响，正常渲染首页', async () => {
    window.history.replaceState({}, '', '/')
    render(<App />)

    // 等待 Layout 渲染（Logo 文案）；Dashboard 数据异步加载中显示骨架屏属正常状态
    expect(await screen.findByText('英语学习', {}, { timeout: 3000 })).toBeInTheDocument()
    // 首页路由（含骨架屏阶段）不应出现 404 文案
    expect(screen.queryByText('页面不存在或已被移动')).not.toBeInTheDocument()
  })
})
