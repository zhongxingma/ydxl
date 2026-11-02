// 响应式列数 hook：与列表页栅格断点保持一致（<768px 1 列，768-1023px 2 列，>=1024px 3 列）
// 虚拟滚动需要知道当前列数才能把一维列表切分为「行」，因此不能只依赖 CSS 断点。
import { useEffect, useState } from 'react'

// Tailwind 默认断点：md = 768px，lg = 1024px
const TABLET_QUERY = '(min-width: 768px)'
const DESKTOP_QUERY = '(min-width: 1024px)'

export function getResponsiveColumns(): number {
  // jsdom / SSR 环境无 matchMedia：退化为单列，保证测试确定性
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 1
  if (window.matchMedia(DESKTOP_QUERY).matches) return 3
  if (window.matchMedia(TABLET_QUERY).matches) return 2
  return 1
}

export function useResponsiveColumns(): number {
  const [columns, setColumns] = useState(getResponsiveColumns)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const update = () => setColumns(getResponsiveColumns())
    const queries = [TABLET_QUERY, DESKTOP_QUERY].map((q) => window.matchMedia(q))
    for (const query of queries) {
      query.addEventListener?.('change', update)
    }
    // 兜底监听窗口尺寸变化（部分浏览器 matchMedia 不支持 addEventListener）
    window.addEventListener('resize', update)
    return () => {
      for (const query of queries) {
        query.removeEventListener?.('change', update)
      }
      window.removeEventListener('resize', update)
    }
  }, [])

  return columns
}
