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
import { useTranslation } from '@/shared/i18n/useTranslation'
import { getCurrentUser, logout } from '@/shared/services/authService'

// 顶部导航项配置（桌面端使用，含"我的"链接）
interface NavItem {
  to: string
  labelKey: string
  icon?: typeof LayoutIcon
  end: boolean
}

const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutIcon, end: true },
  { to: '/reading', labelKey: 'nav.reading', icon: BookOpen, end: false },
  { to: '/wordbook', labelKey: 'nav.wordbook', icon: Bookmark, end: false },
  { to: '/mastered', labelKey: 'nav.mastered', icon: BadgeIcon, end: false },
  { to: '/review', labelKey: 'nav.review', icon: RefreshCw, end: false },
  // 重点短语汇总：紧随生词背诵，按阅读时间整理翻转卡片
  { to: '/phrases', labelKey: 'nav.phrases', icon: LayersIcon, end: false },
  // 重点词汇汇总：紧随重点短语，按阅读时间整理翻转卡片（全部显示内容随文章持久化）
  { to: '/vocabulary', labelKey: 'nav.vocabulary', icon: BookTextIcon, end: false },
  { to: '/stats', labelKey: 'nav.stats', icon: BarChart3, end: false },
  { to: '/profile', labelKey: 'nav.profile', end: false },
]

// 管理员专属导航项：仅 admin 角色可见，非 admin 不渲染入口
// （服务端 requirePermission 为授权权威，此处仅作体验层隐藏）
const adminNavItem: NavItem = { to: '/admin', labelKey: 'nav.admin', end: false }

// 教师导航项（多用户 P2/P3）：teacher 可查审计日志（logs:view）与班级学情（stats:class）
const teacherNavItems: NavItem[] = [
  { to: '/admin/class-stats', labelKey: 'nav.admin_class_stats', end: false },
  { to: '/admin/logs', labelKey: 'nav.admin_logs', end: false },
  { to: '/admin/ai-usage', labelKey: 'nav.admin_ai_cost', end: false },
]

// 底部 Tab 导航项配置（移动端使用）
// 首页 | 阅读 | 单词本 | 背诵 | 我的
const bottomTabs: Array<{
  to: string
  labelKey: string
  icon: string
  match: (path: string) => boolean
}> = [
  { to: '/', labelKey: 'nav.dashboard_short', icon: '🏠', match: (path) => path === '/' },
  { to: '/reading', labelKey: 'nav.reading_short', icon: '📖', match: (path) => path.startsWith('/reading') },
  { to: '/wordbook', labelKey: 'nav.wordbook_short', icon: '📚', match: (path) => path.startsWith('/wordbook') },
  { to: '/review', labelKey: 'nav.review_short', icon: '🔄', match: (path) => path.startsWith('/review') },
  { to: '/profile', labelKey: 'nav.profile_short', icon: '👤', match: (path) => path.startsWith('/profile') },
]

// 公共布局组件：桌面顶部导航 + 移动底部 Tab 导航 + 夜间模式切换
// 离线提示横幅由 App.tsx 中的 <OfflineBanner /> 组件统一渲染（基于 useOnlineStatus hook）
export default function Layout() {
  const { isDark, toggle } = useDarkMode()
  const { t } = useTranslation()
  const location = useLocation()
  // 当前登录用户：用于顶栏显示与登出
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
      {/* 键盘无障碍：首个 Tab 停留入口，回车聚焦主内容区，跳过导航直达内容 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-700 focus:shadow-lg dark:focus:bg-gray-800 dark:focus:text-indigo-300"
      >
        {t('app.skip_to_content')}
      </a>
      {/* 顶部导航栏：桌面端显示导航链接，移动端仅显示 Logo 与操作区 */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-700 dark:bg-gray-800/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo 区域 */}
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">{t('app.title')}</span>
          </div>

          {/* 桌面端导航 - md 及以上显示（hidden md:flex） */}
          <nav aria-label={t('nav.aria_primary')} className="hidden md:flex md:items-center md:gap-1">
            {visibleNavItems.map(({ to, labelKey, icon: Icon, end }) => (
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
                <span>{t(labelKey)}</span>
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
              aria-label={t('auth.logout')}
              title={t('auth.logout')}
              className="rounded-md border border-gray-200 px-2 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t('nav.logout')}
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={isDark ? t('theme.toggle_to_light') : t('theme.toggle_to_dark')}
              className="rounded-md border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区域 - 移动端为底部导航预留空间（h-14 = 56px，使用 pb-20 预留余量） */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-4 py-6 pb-20 sm:px-6 lg:px-8 md:pb-6 focus:outline-none"
      >
        <Outlet />
      </main>

      {/* 底部 Tab 导航 - 移动端显示（md:hidden），桌面端隐藏 */}
      <nav
        aria-label={t('nav.aria_bottom')}
        className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 md:hidden"
      >
        {/* grid-cols-5 容纳 5 项；图标 text-lg / 文字 text-[10px] 适配 320px 窄屏 */}
        <div className="grid h-14 grid-cols-5">
          {bottomTabs.map(({ to, labelKey, icon, match }) => {
            const isActive = match(location.pathname)
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? 'page' : undefined}
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
                <span className="text-lg" aria-hidden="true">
                  {icon}
                </span>
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-normal'}`}>{t(labelKey)}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
