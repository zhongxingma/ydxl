// 阅读进度 hook：基于滚动位置计算阅读进度百分比与是否已滚动到底部
// - readingProgress：0-100，根据 articleAreaRef 滚动位置计算
// - reachedBottom：IntersectionObserver 监听 bottomSentinelRef 进入视口
// 仅在 view === 'reading' 时启用监听，避免答题/成绩单视图下误触发
//
// ready 参数：文章加载完成（status === 'success'）后哨兵 DOM 才会挂载，
// 此时 ref 对象本身不变（useRef 返回稳定对象），单纯依赖 [view, ref] 无法
// 在骨架屏 → 正文切换时重新触发 effect。传入 ready 标志作为额外依赖，
// 确保 DOM 挂载后 effect 重新运行并建立 IntersectionObserver。
import { useEffect, useState, type RefObject } from 'react'
import type { ReadingView } from '../store'

export interface UseReadingProgressResult {
  // 阅读进度百分比（0-100）
  readingProgress: number
  // 是否已滚动到底部
  reachedBottom: boolean
}

export function useReadingProgress(
  view: ReadingView,
  articleAreaRef: RefObject<HTMLDivElement>,
  bottomSentinelRef: RefObject<HTMLDivElement>,
  // 文章是否已加载完成：哨兵 DOM 挂载后才能建立 IntersectionObserver
  ready: boolean = true,
): UseReadingProgressResult {
  const [readingProgress, setReadingProgress] = useState(0)
  const [reachedBottom, setReachedBottom] = useState(false)

  // 阅读进度：监听滚动，更新进度条百分比
  useEffect(() => {
    if (view !== 'reading') return
    const handleScroll = () => {
      const el = articleAreaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const totalHeight = el.scrollHeight - window.innerHeight
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(totalHeight, 1))
      const percent = totalHeight > 0 ? Math.round((scrolled / totalHeight) * 100) : 0
      setReadingProgress(Math.min(100, Math.max(0, percent)))
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [view, articleAreaRef])

  // 底部哨兵：IntersectionObserver 监听是否已滚动到底部
  // 依赖 ready：骨架屏阶段哨兵未挂载（ref.current === null），
  // ready 变为 true 时 effect 重新运行，此时哨兵 DOM 已挂载可建立观察者
  useEffect(() => {
    if (view !== 'reading') return
    if (!ready) return
    const sentinel = bottomSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry && entry.isIntersecting) {
          setReachedBottom(true)
        }
      },
      // 哨兵进入视口即视为到底部
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [view, bottomSentinelRef, ready])

  return { readingProgress, reachedBottom }
}
