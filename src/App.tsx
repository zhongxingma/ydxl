import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from '@/shared/components/Layout'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { OfflineBanner } from '@/shared/components/OfflineBanner'
import RequireAuth from '@/features/auth/components/RequireAuth'
import RequireAdmin from '@/features/auth/components/RequireAdmin'

// 路由级代码分割：每个特性页面通过 React.lazy 懒加载
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const ReadingPage = lazy(() => import('@/features/reading/pages/ReadingPage'))
const HistoryPage = lazy(() => import('@/features/reading/pages/HistoryPage'))
const WordbookPage = lazy(() => import('@/features/wordbook/pages/WordbookPage'))
// Task 5.3: 已掌握单词模块懒加载
const MasteredPage = lazy(() => import('@/features/mastered/pages/MasteredPage'))
const ReviewPage = lazy(() => import('@/features/review/pages/ReviewPage'))
// 重点短语汇总模块懒加载
const PhrasesPage = lazy(() => import('@/features/phrases/pages/PhrasesPage'))
// 重点词汇汇总模块懒加载
const VocabularyPage = lazy(() => import('@/features/vocabulary/pages/VocabularyPage'))
const StatsPage = lazy(() => import('@/features/stats/pages/StatsPage'))
const ProfilePage = lazy(() => import('@/features/profile/pages/ProfilePage'))
// 登录页（多用户 P0）：独立全屏页，不经过 Layout 导航
const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage'))
// 用户管理页（多用户 P1）：仅 admin 角色可见（RequireAdmin 守卫）
const AdminUsersPage = lazy(() => import('@/features/admin/pages/AdminUsersPage'))
// 审计日志页（多用户 P2）：admin 与 teacher 可见（logs:view 权限对应角色）
const AuditLogsPage = lazy(() => import('@/features/admin/pages/AuditLogsPage'))
// 班级学情页（多用户 P3）：admin 与 teacher 可见（stats:class 权限对应角色）
const ClassStatsPage = lazy(() => import('@/features/admin/pages/ClassStatsPage'))
// 404 兜底页（BUG-003）：未知路径渲染友好提示而非空白内容区
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

// 加载占位组件
function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-gray-500 dark:text-gray-400">加载中...</div>
    </div>
  )
}

function App() {
  return (
    // 全局错误边界：作为最外层兜底，捕获所有未被子边界捕获的错误
    <ErrorBoundary>
      {/* 离线状态横幅：在所有路由之上渲染，断网时顶部显示黄色提示，联网后自动消失 */}
      <OfflineBanner />
      <BrowserRouter>
        <Routes>
          {/* 登录页：公开路由，无需会话 */}
          <Route
            path="/login"
            element={
              <Suspense fallback={<PageLoading />}>
                <ErrorBoundary>
                  <LoginPage />
                </ErrorBoundary>
              </Suspense>
            }
          />
          {/* 认证守卫（多用户 P0）：以下全部路由需要登录 */}
          <Route element={<RequireAuth />}>
            {/* 所有路由使用公共 Layout（顶部导航 + 内容出口） */}
            <Route
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <Layout />
                  </ErrorBoundary>
                </Suspense>
              }
            >
            <Route
              index
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <DashboardPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            <Route
              path="reading"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <ReadingPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            {/* 阅读历史页（Task 8.5）：分页展示所有已读文章 */}
            <Route
              path="history"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <HistoryPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            <Route
              path="wordbook"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <WordbookPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            {/* Task 5.3: 已掌握单词/短语模块路由 */}
            <Route
              path="mastered"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <MasteredPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            <Route
              path="review"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <ReviewPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            {/* 重点短语汇总：按阅读时间整理的翻转卡片，紧随生词背诵 */}
            <Route
              path="phrases"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <PhrasesPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            {/* 重点词汇汇总：按阅读时间整理的翻转卡片，紧随重点短语 */}
            <Route
              path="vocabulary"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <VocabularyPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            <Route
              path="stats"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <StatsPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            <Route
              path="profile"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <ProfilePage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            {/* 用户管理（多用户 P1）：仅 admin 角色可进入，非 admin 重定向首页 */}
            <Route element={<RequireAdmin />}>
              <Route
                path="admin"
                element={
                  <Suspense fallback={<PageLoading />}>
                    <ErrorBoundary>
                      <AdminUsersPage />
                    </ErrorBoundary>
                  </Suspense>
                }
              />
            </Route>
            {/* 审计日志（多用户 P2）与班级学情（P3）：admin 与 teacher 可进入（服务端权限强制授权） */}
            <Route element={<RequireAdmin roles={['admin', 'teacher']} />}>
              <Route
                path="admin/logs"
                element={
                  <Suspense fallback={<PageLoading />}>
                    <ErrorBoundary>
                      <AuditLogsPage />
                    </ErrorBoundary>
                  </Suspense>
                }
              />
              <Route
                path="admin/class-stats"
                element={
                  <Suspense fallback={<PageLoading />}>
                    <ErrorBoundary>
                      <ClassStatsPage />
                    </ErrorBoundary>
                  </Suspense>
                }
              />
            </Route>
            {/* 404 兜底：所有未匹配路径（含深层未知子路径）均渲染 404 页 */}
            <Route
              path="*"
              element={
                <Suspense fallback={<PageLoading />}>
                  <ErrorBoundary>
                    <NotFoundPage />
                  </ErrorBoundary>
                </Suspense>
              }
            />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
