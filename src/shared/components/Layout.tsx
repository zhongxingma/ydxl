import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Layout as LayoutIcon,
  BookOpen,
  Bookmark,
  RefreshCw,
  BarChart3,
  Sun,
  Moon,
  BadgeIcon,
  LayersIcon,
  BookTextIcon,
} from '@/shared/components/icons'
import { useDarkMode } from '@/shared/hooks/useDarkMode'
import { getCurrentUser, logout } from '@/shared/services/authService'

// 顶部导航项配置（桌面端使用，含"我的"链接）
interface NavItem {
  to: string
  label: string
  icon?: typeof LayoutIcon
  end: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: '首页', icon: LayoutIcon, end: true },
  { to: '/reading', label: '每日阅读', icon: BookOpen, end: false },
  { to: '/wordbook', label: '生词本', icon: Bookmark, end: false },
  // Task 5.3: 主导航新增「已掌握」入口
  { to: '/mastered', label: '已掌握', icon: BadgeIcon, end: false },
  { to: '/review', label: '生词背诵', icon: RefreshCw, end: false },
  // 重点短语汇总：紧随生词背诵，按阅读时间整理翻转卡片
  { to: '/phrases', label: '重点短语', icon: LayersIcon, end: false },
  // 重点词汇汇总：紧随重点短语，按阅读时间整理翻转卡片（全部显示内容随文章持久化）
  { to: '/vocabulary', label: '重点词汇', icon: BookTextIcon, end: false },
  { to: '/stats', label: '学习统计', icon: BarChart3, end: false },
  // SubTask 25.2: 桌面端顶部导航新增"我的"链接（无对应 SVG 图标，仅文字）
  { to: '/profile', label: '我的', end: false },
]

// 管理员专属导航项（多用户 P1）：仅 admin 角色可见，非 admin 不渲染入口
// （服务端 requirePermission 为授权权威，此处仅作体验层隐藏）
const adminNavItem: NavItem = { to: '/admin', label: '管理', end: false }

// 教师导航项（多用户 P2/P3）：teacher 可查审计日志（logs:view）与班级学情（stats:class）
const teacherNavItems: NavItem[] = [
  { to: '/admin/class-stats', label: '学情', end: false },
  { to: '/admin/logs', label: '日志', end: false },
]

// 底部 Tab 导航项配置（移动端使用）
// 首页 | 阅读 | 单词本 | 背诵 | 我的
const bottomTabs: Array<{
  to: string
  label: string
  icon: string
  match: (path: string) => boolean
}> = [
  { to: '/', label: '首页', icon: '🏠', match: (path) => path === '/' },
  { to: '/reading', label: '阅读', icon: '📖', match: (path) => path.startsWith('/reading') },
  { to: '/wordbook', label: '单词本', icon: '📚', match: (path) => path.startsWith('/wordbook') },
  // Task 3.1: 移动端底部菜单新增「背诵」入口，对应 /review 路由
  { to: '/review', label: '背诵', icon: '🔄', match: (path) => path.startsWith('/review') },
  { to: '/profile', label: '我的', icon: '👤', match: (path) => path.startsWith('/profile') },
]

// 公共布局组件：桌面顶部导航 + 移动底部 Tab 导航 + 夜间模式切换
// 离线提示横幅由 App.tsx 中的 <OfflineBanner /> 组件统一渲染（基于 useOnlineStatus hook）
export default function Layout() {
  const { isDark, toggle } = useDarkMode()
  // SubTask 25.3: 通过 useLocation 获取当前路径以判断激活 Tab
  const location = useLocation()
  // 当前登录用户（多用户 P0）：用于顶栏显示与登出
  const currentUser = getCurrentUser()
  // 角色专属导航入口（多用户 P1/P2/P3）：admin 见「管理/学情/日志」，teacher 见「学情/日志」
  const roleNavItems: NavItem[] =
    currentUser?.role === 'admin' ? [adminNavItem, ...teacherNavItems] : currentUser?.role === 'teacher' ? teacherNavItems : []
  const visibleNavItems = [...navItems, ...roleNavItems]

  // 登出：吊销服务端会话 + 清空本地缓存后整页跳转登录页（彻底清空内存状态）
  async function handleLogout() {
    await logout()
    window.location.assign('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      {/* 顶部导航栏：桌面端显示导航链接，移动端仅显示 Logo 与操作区 */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-700 dark:bg-gray-800/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo 区域 */}
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">英语学习</span>
          </div>

          {/* 桌面端导航 - md 及以上显示（hidden md:flex） */}
          <nav className="hidden md:flex md:items-center md:gap-1">
            {visibleNavItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
                  }`
                }
              >
                {Icon && <Icon className="h-4 w-4" />}
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          {/* 右侧操作区：当前用户 + 登出 + 夜间模式切换（所有尺寸均显示） */}
          <div className="flex items-center gap-2">
            {currentUser && (
              <span className="hidden text-sm text-gray-600 dark:text-gray-300 sm:inline">
                {currentUser.displayName}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="退出登录"
              title="退出登录"
              className="rounded-md border border-gray-200 px-2 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              退出
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={isDark ? '切换到日间模式' : '切换到夜间模式'}
              className="rounded-md border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区域 - 移动端为底部导航预留空间（h-14 = 56px，使用 pb-20 预留余量） */}
      <main className="mx-auto max-w-7xl px-4 py-6 pb-20 sm:px-6 lg:px-8 md:pb-6">
        <Outlet />
      </main>

      {/* 底部 Tab 导航 - 移动端显示（md:hidden），桌面端隐藏 */}
      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 md:hidden">
        {/* Task 3.2: grid-cols-5 容纳 5 项；图标 text-lg / 文字 text-[10px] 适配 320px 窄屏 */}
        <div className="grid h-14 grid-cols-5">
          {bottomTabs.map(({ to, label, icon, match }) => {
            // SubTask 25.3: 根据当前路径判断激活状态
            const isActive = match(location.pathname)
            return (
              <Link
                key={to}
                to={to}
                className={`relative flex flex-col items-center justify-center gap-0.5 ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {/* 激活态顶部小圆点指示 */}
                {isActive && (
                  <span className="absolute top-1 h-1 w-1 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                )}
                <span className="text-lg">{icon}</span>
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-normal'}`}>{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
