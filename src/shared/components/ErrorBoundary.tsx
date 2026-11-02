// 全局错误边界组件
// - 使用 React class component（hooks 无法捕获子组件渲染错误）
// - 通过 getDerivedStateFromError 在渲染阶段捕获错误并切换到恢复 UI
// - 通过 componentDidCatch 记录错误并回调 onError
// - 默认恢复 UI 提供「刷新页面」与「返回首页」两个恢复入口
//
// 用法：
//   <ErrorBoundary><App /></ErrorBoundary>                       // 全局兜底
//   <ErrorBoundary fallback={<CustomUI />}><Page /></ErrorBoundary>  // 局部隔离

import { logger } from '../utils/logger'
import { captureException } from '../services/sentry'
import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  // 需要被错误边界包裹的子树
  children: ReactNode
  // 可选自定义恢复 UI，提供时将替代默认恢复 UI
  fallback?: ReactNode
  // 可选错误回调，用于上报或副作用处理
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('[ErrorBoundary]', error, info)
    // 可选 Sentry 上报：未配置 VITE_SENTRY_DSN 时为 no-op（见 services/sentry.ts）
    captureException(error, { componentStack: info.componentStack })
    this.props.onError?.(error, info)
  }

  // 刷新当前页面
  private handleReload = (): void => {
    window.location.reload()
  }

  // 返回首页
  private handleGoHome = (): void => {
    window.location.href = '/'
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback } = this.props

    if (!hasError) {
      return children
    }

    // 提供了自定义 fallback 时优先使用
    if (fallback !== undefined) {
      return fallback
    }

    // 默认恢复 UI
    // 安全：生产环境不向用户展示原始错误消息与堆栈（可能泄露内部实现）
    // 开发环境保留完整信息便于调试
    const isDev = import.meta.env.DEV
    const message = isDev
      ? error?.message ?? '未知错误'
      : '页面渲染异常，请刷新或返回首页重试'
    const stack = isDev ? error?.stack ?? '' : ''

    return (
      <div className="flex min-h-[200px] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-indigo-200 bg-indigo-50 p-6 text-center dark:border-indigo-900/40 dark:bg-indigo-900/20">
          {/* 错误图标：红色感叹号圆圈 */}
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
            <svg
              className="h-7 w-7 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
          </div>

          <h2 className="mb-2 text-lg font-semibold text-indigo-700 dark:text-indigo-300">
            出错了
          </h2>
          <p className="mb-1 text-sm text-gray-600 dark:text-gray-300">页面渲染过程中发生错误</p>
          <p className="mb-4 break-words text-xs text-red-600 dark:text-red-400">{message}</p>

          {/* 错误堆栈，可折叠查看 */}
          {stack && (
            <details className="mb-4 text-left">
              <summary className="cursor-pointer text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">
                查看错误堆栈
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white/60 p-2 text-[10px] leading-relaxed text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                {stack}
              </pre>
            </details>
          )}

          {/* 恢复按钮 */}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              刷新页面
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="rounded-md border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-indigo-800 dark:bg-gray-800 dark:text-indigo-300 dark:hover:bg-gray-700"
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    )
  }
}
