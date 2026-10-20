import { useCallback, useEffect, useState } from 'react'

// 夜间模式存储 key
const DARK_MODE_STORAGE_KEY = 'ydxl-dark-mode'

// 检测系统偏好（用户未设置时跟随系统）
function getInitialDarkMode(): boolean {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem(DARK_MODE_STORAGE_KEY)
  if (stored !== null) return stored === 'true'
  // 跟随系统偏好
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 夜间模式 Hook
 * - 读写 localStorage 持久化用户偏好
 * - 切换 document.documentElement 上的 dark 类
 */
export function useDarkMode() {
  const [isDark, setIsDark] = useState<boolean>(getInitialDarkMode)

  // 同步 dark class 到 <html> 元素
  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    // 持久化用户偏好：捕获 QuotaExceededError（配额满）与 SecurityError（隐私模式）
    // 静默降级为内存模式，state 已更新，仅持久化失败
    try {
      localStorage.setItem(DARK_MODE_STORAGE_KEY, String(isDark))
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[useDarkMode] localStorage 写入失败，降级为内存模式', err)
      }
    }
  }, [isDark])

  const toggle = useCallback(() => {
    setIsDark((prev) => !prev)
  }, [])

  const enable = useCallback(() => setIsDark(true), [])
  const disable = useCallback(() => setIsDark(false), [])

  return { isDark, toggle, enable, disable } as const
}
